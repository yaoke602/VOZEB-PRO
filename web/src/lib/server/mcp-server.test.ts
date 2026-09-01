import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    getAuthSettings: vi.fn(),
    checkRateLimit: vi.fn(),
    withGenerationConcurrencyLimit: vi.fn(),
    runGenerationTaskRecoveryBatch: vi.fn(),
    createAgentRun: vi.fn(),
    getAgentRun: vi.fn(),
    getAgentRunByClientRequestId: vi.fn(),
    getCreativeAssetsByIds: vi.fn(),
    getPublicSiteSettings: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.runGenerationTaskRecoveryBatch }));
vi.mock("@/lib/server/agent-run-store", () => ({ createAgentRun: mocks.createAgentRun, getAgentRun: mocks.getAgentRun, getAgentRunByClientRequestId: mocks.getAgentRunByClientRequestId }));
vi.mock("@/lib/server/creative-runtime-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/creative-runtime-store")>()), getCreativeAssetsByIds: mocks.getCreativeAssetsByIds }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://internal:3000") }));
vi.mock("@/lib/server/public-request-origin", () => ({ resolvePublicRequestOrigin: vi.fn(() => "https://aigc.example.com") }));
vi.mock("@/lib/server/site-metadata", () => ({ getPublicSiteSettings: mocks.getPublicSiteSettings }));

import { vozebMcpHandler } from "./mcp-server";

const authInfo = { token: "configured", clientId: "user-one", scopes: ["mcp"] };

describe("VOZEB MCP server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { agent: 2 } });
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "梦畅AIGC" });
        mocks.checkRateLimit.mockResolvedValue({ allowed: true });
        mocks.withGenerationConcurrencyLimit.mockImplementation(async (_userId, _type, _staleMs, _limit, handler) => handler());
        mocks.getAgentRunByClientRequestId.mockResolvedValue(null);
        mocks.getCreativeAssetsByIds.mockResolvedValue([]);
    });

    it("publishes the minimal create and query tools", async () => {
        const payload = await call("tools/list", {});
        expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["agent_run_create", "agent_run_get"]);
    });

    it("uses the configured site title for the MCP service and tool display names", async () => {
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "测试品牌" });
        const initialized = await call("initialize", {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
        });
        expect(initialized.result.serverInfo).toMatchObject({ name: "测试品牌", version: "0.0.6" });

        const listed = await call("tools/list", {});
        expect(listed.result.tools.map((tool: { title?: string }) => tool.title)).toEqual(["创建 测试品牌 Agent 任务", "查询 测试品牌 Agent 任务"]);
    });

    it("creates an image Agent run for the configured MCP user", async () => {
        const run = agentRun({ id: "agent-one", status: "planning", generationPreferences: { mode: "image" } });
        mocks.createAgentRun.mockResolvedValue({ run, conversation: { id: "conversation-one" }, created: true });

        const payload = await call("tools/call", { name: "agent_run_create", arguments: { prompt: "生成一张产品图", mode: "image", requestId: "request-one" } });
        expect(payload.result.structuredContent).toMatchObject({ run: { id: "agent-one", status: "planning" }, created: true });
        expect(mocks.createAgentRun).toHaveBeenCalledWith("user-one", expect.objectContaining({ clientRequestId: "request-one", surface: "chat", prompt: "生成一张产品图", preferences: { mode: "image" } }));
        expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    });

    it("returns stable absolute result URLs owned by the configured user", async () => {
        mocks.getAgentRun.mockResolvedValue(agentRun({ id: "agent-done", status: "completed", assetIds: ["asset-one"] }));
        mocks.getCreativeAssetsByIds.mockResolvedValue([{ id: "asset-one", title: "结果图", type: "image", status: "ready", serverUrl: "/api/generation-log-assets/permanent/result.png", mimeType: "image/png" }]);

        const payload = await call("tools/call", { name: "agent_run_get", arguments: { runId: "agent-done" } });
        expect(payload.result.structuredContent).toMatchObject({
            run: { id: "agent-done", status: "completed" },
            assets: [{ id: "asset-one", url: "https://aigc.example.com/api/generation-log-assets/permanent/result.png" }],
        });
        expect(mocks.getCreativeAssetsByIds).toHaveBeenCalledWith(["asset-one"], "user-one");
    });
});

async function call(method: string, params: Record<string, unknown>) {
    const response = await vozebMcpHandler.fetch(
        new Request("http://localhost/api/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
        { authInfo },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = response.headers.get("content-type")?.includes("text/event-stream")
        ? text
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6) || "{}"
        : text;
    return JSON.parse(data) as {
        result: {
            serverInfo?: { name: string; version: string };
            tools: { name: string; title?: string }[];
            structuredContent: Record<string, unknown>;
        };
    };
}

function agentRun(overrides: Record<string, unknown>) {
    return {
        id: "agent-one",
        userId: "user-one",
        conversationId: "conversation-one",
        clientRequestId: "request-one",
        surface: "chat",
        inputMessageId: "message-input",
        assistantMessageId: "message-output",
        prompt: "生成内容",
        referencedAssetIds: [],
        assetIds: [],
        status: "planning",
        tasks: [],
        reviewed: false,
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}
