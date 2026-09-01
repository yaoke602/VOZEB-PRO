import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasNodeType } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/lib/canvas-project-contract";

const mocks = vi.hoisted(() => ({
    createCanvasProjectForUser: vi.fn(),
    getCanvasProjectForUser: vi.fn(),
    updateCanvasProjectForUser: vi.fn(),
    listCreativeRunEvents: vi.fn(),
}));

vi.mock("@/lib/server/canvas-project-service", () => ({
    createCanvasProjectForUser: mocks.createCanvasProjectForUser,
    getCanvasProjectForUser: mocks.getCanvasProjectForUser,
    updateCanvasProjectForUser: mocks.updateCanvasProjectForUser,
}));
vi.mock("@/lib/server/creative-runtime-store", () => ({ CREATIVE_RUN_EVENT_BATCH_SIZE: 500, listCreativeRunEvents: mocks.listCreativeRunEvents }));

import { mcpCanvasRunSnapshot, syncMcpCanvasRunProject } from "./mcp-canvas-service";

describe("MCP Canvas service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCanvasProjectForUser.mockResolvedValue(project());
        mocks.listCreativeRunEvents.mockResolvedValue([]);
        mocks.updateCanvasProjectForUser.mockImplementation(async (_userId, _projectId, value) => ({ ...value.project, updatedAt: "2026-09-01T00:00:01.000Z" }));
    });

    it("builds the existing compact Canvas Agent snapshot from a stored project", () => {
        const snapshot = mcpCanvasRunSnapshot(project(), ["text-one", "missing-node"]);
        expect(snapshot).toMatchObject({ projectId: "canvas-one", title: "产品画布", imageSize: "2048x2048", selectedNodeIds: ["text-one"] });
        expect(snapshot.nodes.map((node) => node.id)).toEqual(["config-one", "text-one"]);
    });

    it("replays Canvas Agent event operations and saves them to the real project", async () => {
        mocks.listCreativeRunEvents.mockResolvedValue([
            {
                id: "1",
                runId: "agent-canvas",
                type: "canvas.ops",
                data: {
                    ops: [
                        { type: "add_node", id: "output-one", nodeType: "image", title: "生成结果", position: { x: 800, y: 96 }, metadata: { agentRunId: "agent-canvas", status: "loading" } },
                        { type: "connect_nodes", id: "connection-one", fromNodeId: "text-one", toNodeId: "output-one" },
                    ],
                },
                createdAt: 1,
            },
        ]);

        const result = await syncMcpCanvasRunProject("user-one", canvasRun());
        expect(mocks.updateCanvasProjectForUser).toHaveBeenCalledWith(
            "user-one",
            "canvas-one",
            expect.objectContaining({
                expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
                project: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ id: "output-one", type: "image" })]), connections: expect.arrayContaining([expect.objectContaining({ id: "connection-one" })]) }),
            }),
        );
        expect(result).toMatchObject({ appliedOps: 2, project: { id: "canvas-one", updatedAt: "2026-09-01T00:00:01.000Z" } });
    });

    it("does not rewrite the project when the run has no new canvas operations", async () => {
        const result = await syncMcpCanvasRunProject("user-one", canvasRun());
        expect(mocks.updateCanvasProjectForUser).not.toHaveBeenCalled();
        expect(result).toMatchObject({ appliedOps: 0, project: { id: "canvas-one" } });
    });
});

function project(): CanvasProject {
    return {
        id: "canvas-one",
        title: "产品画布",
        nodes: [
            { id: "config-one", type: CanvasNodeType.Config, title: "生成配置", position: { x: 0, y: 0 }, width: 340, height: 180, metadata: { size: "2048x2048" } },
            { id: "text-one", type: CanvasNodeType.Text, title: "文案", position: { x: 400, y: 96 }, width: 340, height: 240, metadata: { content: "新品上市" } },
        ],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines" as const,
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
    };
}

function canvasRun() {
    return {
        id: "agent-canvas",
        userId: "user-one",
        conversationId: "conversation-one",
        clientRequestId: "request-one",
        surface: "canvas" as const,
        projectId: "canvas-one",
        inputMessageId: "message-input",
        assistantMessageId: "message-output",
        prompt: "制作产品海报",
        snapshot: {},
        referencedAssetIds: [],
        assetIds: [],
        status: "completed" as const,
        tasks: [],
        reviewed: true,
        timings: { requestAcceptedAt: 1 },
        createdAt: 1,
        updatedAt: 2,
    };
}
