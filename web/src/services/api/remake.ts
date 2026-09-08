import type { RemakeProject } from "@/lib/remake-contract";
import type { DramaProjectSummaryPage } from "@/lib/drama-project-contract";

async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/remake/projects${path}`, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.msg || "复刻任务请求失败");
    return payload.data;
}
export const listRemakeProjects = (page = 1) => request<DramaProjectSummaryPage>(`?page=${page}`);
export const createRemakeProject = (title: string) => request<{ project: RemakeProject }>("", { title }).then((r) => r.project);
export const getRemakeProject = (id: string) => request<{ project: RemakeProject }>(`/${encodeURIComponent(id)}`).then((r) => r.project);
export const remakeAction = (project: RemakeProject, action: string, extra: Record<string, unknown> = {}) =>
    request<{ project: RemakeProject }>(`/${encodeURIComponent(project.id)}`, { action, updatedAt: project.updatedAt, ...extra }).then((r) => r.project);
export function saveRemakeProject(project: RemakeProject) {
    return remakeAction(project, "edit", {
        input: {
            title: project.title,
            ratio: project.ratio,
            language: project.remake.language,
            resolution: project.remake.resolution,
            step: project.remake.step,
            subjects: project.remake.subjects.map((s) => ({ ...s, replacementAssetId: s.replacement?.assetId })),
            shots: project.remake.shots.map((s) => ({ ...s, selectedAssetId: s.selected?.assetId })),
        },
    });
}
