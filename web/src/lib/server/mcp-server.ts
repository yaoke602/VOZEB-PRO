import { after } from "next/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getAuthSettings } from "@/lib/auth/store";
import { CreativeRuntimeInputError, normalizeCreativeRunRequest } from "@/lib/creative-runtime-contract";
import { resolveSiteTitle } from "@/lib/site-brand";
import { publicAgentRun } from "@/lib/server/agent-run-public";
import { createAgentRun, getAgentRun, getAgentRunByClientRequestId } from "@/lib/server/agent-run-store";
import { CreativeStoreConflict, getCreativeAssetsByIds } from "@/lib/server/creative-runtime-store";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolvePublicRequestOrigin } from "@/lib/server/public-request-origin";
import { checkRateLimit } from "@/lib/server/security";
import { getPublicSiteSettings } from "@/lib/server/site-metadata";

function createRunInput(siteTitle: string) {
    return z.object({
        prompt: z.string().min(1).max(4000).describe("创作要求"),
        mode: z.enum(["agent", "image", "video", "audio"]).default("agent").describe("创作类型"),
        requestId: z.string().min(1).max(120).optional().describe("调用方幂等请求标识"),
        conversationId: z.string().min(1).max(160).optional().describe(`继续已有 ${siteTitle} 会话时填写`),
        assetIds: z.array(z.string().min(1).max(160)).max(10).default([]).describe("当前绑定用户已有素材 ID"),
    });
}

const getRunInput = z.object({ runId: z.string().min(1).max(160).describe("agent_run_create 返回的任务 ID") });

export const vozebMcpHandler = createMcpHandler(async ({ authInfo }) => {
    const siteTitle = resolveSiteTitle((await getPublicSiteSettings()).title);
    return createVozebMcpServer(authInfo?.clientId || "", siteTitle);
});

function createVozebMcpServer(userId: string, siteTitle: string) {
    const server = new McpServer({ name: siteTitle, version: "0.0.6" });

    server.registerTool(
        "agent_run_create",
        {
            title: `创建 ${siteTitle} Agent 任务`,
            description: `向 ${siteTitle} 提交文本、图片、视频或音频创作任务。任务异步执行，随后使用 agent_run_get 查询状态和结果。`,
            inputSchema: createRunInput(siteTitle),
        },
        async (value, context) => {
            try {
                const input = normalizeCreativeRunRequest({
                    clientRequestId: value.requestId || `mcp-${nanoid()}`,
                    surface: "chat",
                    conversationId: value.conversationId,
                    prompt: value.prompt,
                    assetIds: value.assetIds,
                    skillIds: [],
                    modelIds: [],
                    ...(value.mode === "agent" ? {} : { preferences: { mode: value.mode } }),
                });
                const existing = await getAgentRunByClientRequestId(userId, input.clientRequestId);
                if (existing) return result({ run: publicAgentRun(existing), created: false });

                const rate = await checkRateLimit(`agent-run:${userId}`, { maxRequests: 10, windowMs: 60 * 1000 });
                if (!rate.allowed) return failure("Agent 请求过于频繁，请稍后重试");

                const settings = await getAuthSettings();
                const created = await withGenerationConcurrencyLimit(userId, "agent", 10 * 60 * 1000, settings.generationConcurrency.agent, () => createAgentRun(userId, input));
                if (!created) return failure(`当前最多同时运行 ${settings.generationConcurrency.agent} 个 Agent 任务`);

                if (created.created) scheduleRecovery(context.http?.req, created.run.id);
                return result({ run: publicAgentRun(created.run), created: created.created });
            } catch (error) {
                if (error instanceof CreativeRuntimeInputError || error instanceof CreativeStoreConflict) return failure(error.message);
                console.error("MCP Agent run creation failed", error);
                return failure("Agent 任务创建失败");
            }
        },
    );

    server.registerTool(
        "agent_run_get",
        {
            title: `查询 ${siteTitle} Agent 任务`,
            description: `查询 ${siteTitle} Agent 任务的状态、子任务、生成结果素材和可访问地址。planning 或 running 时请稍后再次查询。`,
            inputSchema: getRunInput,
        },
        async ({ runId }, context) => {
            const run = await getAgentRun(runId);
            if (!run || run.userId !== userId) return failure("Agent 任务不存在");
            if (run.status === "planning" || run.status === "running") scheduleRecovery(context.http?.req, run.id);
            const request = context.http?.req;
            const publicOrigin = request ? resolvePublicRequestOrigin(request) : process.env.NEXT_PUBLIC_SITE_URL || "";
            const assets = await getCreativeAssetsByIds(run.assetIds, userId);
            return result({
                run: publicAgentRun(run),
                assets: assets.map((asset) => ({
                    id: asset.id,
                    title: asset.title,
                    type: asset.type,
                    status: asset.status,
                    url: absoluteUrl(asset.serverUrl || asset.remoteUrl || "", publicOrigin),
                    mimeType: asset.mimeType,
                    width: asset.width,
                    height: asset.height,
                    durationMs: asset.durationMs,
                    bytes: asset.bytes,
                })),
            });
        },
    );

    return server;
}

function scheduleRecovery(request: Request | undefined, runId: string) {
    if (!request) return;
    const requestOrigin = new URL(request.url).origin;
    after(() =>
        runGenerationTaskRecoveryBatch({
            origin: resolveInternalOrigin(requestOrigin),
            publicOrigin: resolvePublicRequestOrigin(request),
            limit: 1,
            taskIds: [runId],
        }),
    );
}

function absoluteUrl(value: string, origin: string) {
    if (!value || !origin || /^https?:\/\//i.test(value)) return value;
    try {
        return new URL(value, origin).toString();
    } catch {
        return value;
    }
}

function result(data: Record<string, unknown>) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}

function failure(message: string) {
    const data = { error: message };
    return { ...result(data), isError: true };
}
