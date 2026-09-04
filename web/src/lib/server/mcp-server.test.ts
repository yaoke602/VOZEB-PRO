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
    createMcpCanvasProject: vi.fn(),
    getMcpCanvasProject: vi.fn(),
    mcpCanvasRunSnapshot: vi.fn(),
    syncMcpCanvasRunProject: vi.fn(),
    qianchuanStatus: vi.fn(),
    readQianchuanPage: vi.fn(),
    syncQianchuan: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./qianchuan-service", () => ({ qianchuanStatus: mocks.qianchuanStatus, readQianchuanPage: mocks.readQianchuanPage, syncQianchuan: mocks.syncQianchuan }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/security", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: mocks.withGenerationConcurrencyLimit }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.runGenerationTaskRecoveryBatch }));
vi.mock("@/lib/server/agent-run-store", () => ({ createAgentRun: mocks.createAgentRun, getAgentRun: mocks.getAgentRun, getAgentRunByClientRequestId: mocks.getAgentRunByClientRequestId }));
vi.mock("@/lib/server/creative-runtime-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/creative-runtime-store")>()), getCreativeAssetsByIds: mocks.getCreativeAssetsByIds }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://internal:3000") }));
vi.mock("@/lib/server/public-request-origin", () => ({ resolvePublicRequestOrigin: vi.fn(() => "https://aigc.example.com") }));
vi.mock("@/lib/server/site-metadata", () => ({ getPublicSiteSettings: mocks.getPublicSiteSettings }));
vi.mock("@/lib/server/mcp-canvas-service", () => ({
    createMcpCanvasProject: mocks.createMcpCanvasProject,
    getMcpCanvasProject: mocks.getMcpCanvasProject,
    mcpCanvasRunSnapshot: mocks.mcpCanvasRunSnapshot,
    syncMcpCanvasRunProject: mocks.syncMcpCanvasRunProject,
}));

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
        mocks.createMcpCanvasProject.mockResolvedValue(canvasProject());
        mocks.getMcpCanvasProject.mockResolvedValue(canvasProject());
        mocks.mcpCanvasRunSnapshot.mockReturnValue({ projectId: "canvas-one", title: "产品画布", nodes: [], connections: [], selectedNodeIds: [] });
        mocks.syncMcpCanvasRunProject.mockResolvedValue({ project: canvasProject(), appliedOps: 4 });
    });

    it("publishes the minimal create and query tools", async () => {
        const payload = await call("tools/list", {});
        expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["agent_run_create", "agent_run_get", "canvas_project_create", "canvas_agent_execute", "canvas_agent_get", "qianchuan_accounts", "qianchuan_query", "qianchuan_sync"]);
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
        expect(listed.result.tools.map((tool: { title?: string }) => tool.title)).toEqual([
            "创建 测试品牌 Agent 任务",
            "查询 测试品牌 Agent 任务",
            "创建 测试品牌 画布",
            "使用 测试品牌 Agent 操作画布",
            "查询 测试品牌 画布 Agent 任务",
            "查询 测试品牌 千川账户",
            "查询 测试品牌 千川数据",
            "同步 测试品牌 千川数据",
        ]);
    });

    it("exposes only account identities and scopes reads/syncs to the MCP owner", async () => {
        mocks.qianchuanStatus.mockResolvedValue({ configured: true, postgres: true, accounts: [{ id: "123", name: "账户", connectionId: "private" }], settings: { secret: "hidden" } });
        const accounts = await call("tools/call", { name: "qianchuan_accounts", arguments: {} });
        expect(accounts.result.structuredContent).toMatchObject({ accounts: [{ id: "123", name: "账户" }] });
        expect(JSON.stringify(accounts)).not.toContain("hidden");
        expect(JSON.stringify(accounts)).not.toContain("private");
        const query = { accountId: "123", kind: "plans", startDate: "2026-09-01", endDate: "2026-09-04", page: 1, pageSize: 20, keyword: "", sort: "cost" };
        mocks.readQianchuanPage.mockResolvedValue({ items: [], total: 30 });
        const page = await call("tools/call", { name: "qianchuan_query", arguments: query });
        expect(page.result.structuredContent).toMatchObject({ hasMore: true });
        expect(mocks.readQianchuanPage).toHaveBeenCalledWith("user-one", query);
        expect(mocks.syncQianchuan).not.toHaveBeenCalled();
        mocks.syncQianchuan.mockResolvedValue({ items: [], total: 0 });
        await call("tools/call", { name: "qianchuan_sync", arguments: query });
        expect(mocks.syncQianchuan).toHaveBeenCalledWith("user-one", query);
    });

    it("rejects invalid query arguments and sanitizes unexpected Qianchuan failures", async () => {
        await call("tools/call", { name: "qianchuan_query", arguments: { accountId: "123", kind: "sql" } });
        expect(mocks.readQianchuanPage).not.toHaveBeenCalled();
        mocks.qianchuanStatus.mockRejectedValue(new Error("secret upstream credentials"));
        const failure = await call("tools/call", { name: "qianchuan_accounts", arguments: {} });
        expect(JSON.stringify(failure)).not.toContain("secret upstream");
        expect(failure.result).toMatchObject({ isError: true });
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

    it("creates a canvas project and returns its browser URL", async () => {
        const payload = await call("tools/call", { name: "canvas_project_create", arguments: { title: "新品海报" } });
        expect(mocks.createMcpCanvasProject).toHaveBeenCalledWith("user-one", "新品海报");
        expect(payload.result.structuredContent).toMatchObject({ project: { id: "canvas-one", title: "产品画布" }, canvasUrl: "https://aigc.example.com/canvas/canvas-one" });
    });

    it("submits a real Canvas Agent run with the stored project snapshot", async () => {
        const run = agentRun({ id: "agent-canvas", surface: "canvas", projectId: "canvas-one" });
        mocks.createAgentRun.mockResolvedValue({ run, conversation: { id: "conversation-canvas" }, created: true });

        const payload = await call("tools/call", {
            name: "canvas_agent_execute",
            arguments: { projectId: "canvas-one", prompt: "制作蓝色产品海报", requestId: "canvas-request", selectedNodeIds: ["node-one"] },
        });
        expect(mocks.mcpCanvasRunSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: "canvas-one" }), ["node-one"]);
        expect(mocks.createAgentRun).toHaveBeenCalledWith(
            "user-one",
            expect.objectContaining({ clientRequestId: "canvas-request", surface: "canvas", projectId: "canvas-one", prompt: "制作蓝色产品海报", snapshot: expect.objectContaining({ projectId: "canvas-one" }) }),
        );
        expect(payload.result.structuredContent).toMatchObject({ run: { id: "agent-canvas" }, canvasUrl: "https://aigc.example.com/canvas/canvas-one" });
    });

    it("rejects a request id already used by another Canvas project", async () => {
        mocks.getAgentRunByClientRequestId.mockResolvedValue(agentRun({ id: "agent-existing", surface: "canvas", projectId: "canvas-other", clientRequestId: "canvas-request" }));

        const payload = await call("tools/call", {
            name: "canvas_agent_execute",
            arguments: { projectId: "canvas-one", prompt: "制作蓝色产品海报", requestId: "canvas-request" },
        });

        expect(payload.result.structuredContent).toEqual({ error: "请求标识已被其他创作入口或画布项目使用，请更换 requestId" });
        expect(mocks.createAgentRun).not.toHaveBeenCalled();
    });

    it("queries a Canvas Agent run and persists its operations", async () => {
        const run = agentRun({ id: "agent-canvas", surface: "canvas", projectId: "canvas-one", status: "completed" });
        mocks.getAgentRun.mockResolvedValue(run);

        const payload = await call("tools/call", { name: "canvas_agent_get", arguments: { runId: "agent-canvas" } });
        expect(mocks.syncMcpCanvasRunProject).toHaveBeenCalledWith("user-one", run);
        expect(payload.result.structuredContent).toMatchObject({ run: { id: "agent-canvas", status: "completed" }, appliedOps: 4, canvasUrl: "https://aigc.example.com/canvas/canvas-one" });
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

function canvasProject() {
    return {
        id: "canvas-one",
        title: "产品画布",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
    };
}
