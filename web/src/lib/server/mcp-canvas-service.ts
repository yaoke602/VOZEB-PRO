import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/app/(user)/canvas/utils/canvas-agent-ops";
import { applyCanvasAgentOps } from "@/app/(user)/canvas/utils/canvas-agent-ops";
import type { CanvasProject } from "@/lib/canvas-project-contract";
import type { AgentRun } from "@/lib/server/agent-run-store";
import { normalizeAgentRunCanvasSnapshot } from "@/lib/server/agent-run-canvas-snapshot";
import { createCanvasProjectForUser, getCanvasProjectForUser, updateCanvasProjectForUser } from "@/lib/server/canvas-project-service";
import { CREATIVE_RUN_EVENT_BATCH_SIZE, listCreativeRunEvents } from "@/lib/server/creative-runtime-store";

const CANVAS_OP_TYPES = new Set(["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes"]);

export function createMcpCanvasProject(userId: string, title: string) {
    return createCanvasProjectForUser(userId, { title });
}

export function getMcpCanvasProject(userId: string, projectId: string) {
    return getCanvasProjectForUser(userId, projectId);
}

export function mcpCanvasRunSnapshot(project: CanvasProject, selectedNodeIds: string[]) {
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const selected = Array.from(new Set(selectedNodeIds.filter((id) => nodeIds.has(id))));
    const imageSize = project.nodes.find((node) => node.type === "config")?.metadata?.size;
    return normalizeAgentRunCanvasSnapshot({ title: project.title, imageSize, selectedNodeIds: selected, nodes: project.nodes, connections: project.connections }, project.id);
}

export async function syncMcpCanvasRunProject(userId: string, run: AgentRun) {
    if (run.surface !== "canvas" || !run.projectId) throw new Error("当前任务不是画布 Agent 任务");
    const project = await getCanvasProjectForUser(userId, run.projectId);
    const ops = await canvasRunOps(run.id);
    if (!ops.length) return { project, appliedOps: 0 };

    const before: CanvasAgentSnapshot = {
        projectId: project.id,
        title: project.title,
        imageSize: project.nodes.find((node) => node.type === "config")?.metadata?.size,
        nodes: project.nodes,
        connections: project.connections,
        selectedNodeIds: [],
        viewport: project.viewport,
    };
    const next = applyCanvasAgentOps(before, ops);
    if (JSON.stringify([next.nodes, next.connections, next.viewport]) === JSON.stringify([project.nodes, project.connections, project.viewport])) return { project, appliedOps: ops.length };

    const saved = await updateCanvasProjectForUser(userId, project.id, {
        expectedUpdatedAt: project.updatedAt,
        project: { ...project, nodes: next.nodes, connections: next.connections, viewport: next.viewport },
    });
    return { project: saved as CanvasProject, appliedOps: ops.length };
}

async function canvasRunOps(runId: string) {
    const ops: CanvasAgentOp[] = [];
    let cursor = "";
    while (true) {
        const events = await listCreativeRunEvents(runId, cursor);
        for (const event of events) {
            const data = record(event.data);
            for (const value of Array.isArray(data.ops) ? data.ops : []) {
                if (isCanvasOp(value)) ops.push(value);
            }
        }
        if (events.length < CREATIVE_RUN_EVENT_BATCH_SIZE) return ops;
        cursor = events[events.length - 1]?.id || cursor;
    }
}

function isCanvasOp(value: unknown): value is CanvasAgentOp {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && CANVAS_OP_TYPES.has(String((value as { type?: unknown }).type || "")));
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
