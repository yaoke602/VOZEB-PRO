import { nanoid } from "nanoid";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyRemake, parseRemakeAnalysis, remakeBusy, remakeShotPrompt, remakeSubjectDescription, type RemakeProject, type RemakeMedia, type RemakeJob } from "@/lib/remake-contract";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { getAuthSettings } from "@/lib/auth/store";
import { createDramaProjectForUser, DramaProjectServiceError } from "./drama-project-service";
import { getDramaProject, updateDramaProject } from "./drama-project-store";
import { getCreativeAsset, getCreativeAssetsByIds } from "./creative-runtime-store";
import { getAgentRunByClientRequestId } from "./agent-run-store";
import { getTextTask, createTextTask } from "./text-task-store";
import { getDramaRenderTask } from "./drama-render-store";
import { scheduleGenerationTask } from "./generation-task-scheduler";
import { resolveLogicalModelCandidates } from "./logical-model-router";
import { toSystemGenerationChannel } from "./generation-channel";
import { fetchInternalApi } from "./internal-origin";
import { prepareRemakeAnalysis } from "./remake-analysis";

export function remakeMedia(asset: CreativeAsset): RemakeMedia {
    const url = asset.serverUrl || "";
    if (!url.startsWith("/api/reference-assets/") && !url.startsWith("/api/generation-log-assets/")) throw new DramaProjectServiceError("素材必须先保存到服务器", 400);
    return { assetId: asset.id, url, storageKey: asset.storageKey, title: asset.title };
}

export async function createRemakeProject(userId: string, title: string) {
    const project = await createDramaProjectForUser(userId, { title: title || "未命名复刻任务", summary: "", style: "忠实复刻原视频", ratio: "9:16" });
    return saveRemake(userId, { ...project, remake: emptyRemake() } as RemakeProject);
}

export async function getRemakeProject(userId: string, id: string): Promise<RemakeProject> {
    const project = await getDramaProject(id, userId);
    if (!project?.remake) throw new DramaProjectServiceError("复刻任务不存在", 404);
    return project as RemakeProject;
}

export function saveRemake(userId: string, project: RemakeProject) {
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(project.updatedAt) + 1)).toISOString();
    return updateDramaProject(userId, { ...project, updatedAt }, project.updatedAt) as Promise<RemakeProject>;
}

export async function refreshRemake(userId: string, id: string) {
    const project = await getRemakeProject(userId, id);
    const before = JSON.stringify(project.remake);
    const state = project.remake;
    if (state.analysis?.status === "running" && state.analysis.taskId) {
        const task = await getTextTask(state.analysis.taskId);
        if (task?.userId === userId && task.status === "success") {
            try {
                Object.assign(state, parseRemakeAnalysis(task.result?.content || "", state.frames, state.duration!));
                state.analysis.status = "success";
                state.step = 1;
            } catch {
                state.analysis = { ...state.analysis, status: "error", error: "视频分析未返回有效结构，请重新解析或检查默认文本模型的看图能力" };
            }
        } else if (task?.userId === userId && ["error", "cancelled"].includes(task.status)) state.analysis = { ...state.analysis, status: "error", error: task.error || "视频分析失败" };
    }
    for (const target of [...state.subjects, ...state.shots]) {
        const job = target.job;
        if (!job || !["pending", "running"].includes(job.status)) continue;
        const run = await getAgentRunByClientRequestId(userId, job.requestId);
        if (!run) continue; // Submission uncertainty keeps its identity; never auto-submit again.
        job.runId = run.id;
        job.status = run.status === "completed" ? "success" : ["failed", "cancelled"].includes(run.status) ? "error" : "running";
        job.error =
            run.tasks
                .map((t) => t.error)
                .filter(Boolean)
                .join("；") || (job.status === "error" ? "任务失败，请在任务详情查看原因" : undefined);
        // Reflect the actual rewritten shot, not the internal planning brief. Only
        // update the draft this job planned; never overwrite subsequent edits.
        const snapshot = job.request?.snapshot as { workflow?: string; shots?: Array<{ description?: string }> } | undefined;
        const videos = run.tasks.filter((task) => task.type === "video");
        if (
            !("type" in target) &&
            snapshot?.workflow === "remake" &&
            videos.length === 1 &&
            videos[0].optimizedPrompt?.trim() &&
            target.description === snapshot.shots?.[0]?.description &&
            state.subjects.some((subject) => target.subjectIds.includes(subject.id) && subject.replacement)
        ) {
            target.description = videos[0].optimizedPrompt.trim();
        }
        const kind = "type" in target ? "image" : "video";
        const results = (await getCreativeAssetsByIds(run.assetIds, userId)).filter((a) => a.type === kind && a.status === "ready").map(remakeMedia);
        job.results = [...job.results.filter((old) => !results.some((r) => r.assetId === old.assetId)), ...results];
        if (job.status === "success" && !results.length) {
            job.status = "error";
            job.error = "任务未返回可用媒体，请检查任务详情";
        }
        if (job.status === "success") {
            if ("type" in target) target.replacement = results[0];
            else {
                target.selected = results[0];
                const seconds = run.tasks.find((t) => t.type === "video")?.seconds;
                if (seconds && seconds > 0) target.duration = seconds;
            }
        }
    }
    if (state.render?.id && ["pending", "running"].includes(state.render.status)) {
        const render = await getDramaRenderTask(state.render.id);
        if (render?.userId === userId) state.render = { id: render.id, status: render.status, url: render.result?.url, error: render.error };
    }
    if (before === JSON.stringify(state)) return project;
    try {
        return await saveRemake(userId, project);
    } catch (e) {
        if (e instanceof Error && "status" in e && e.status === 409) return getRemakeProject(userId, id);
        throw e;
    }
}

const editSchema = z.object({
    title: z.string().trim().min(1),
    ratio: z.enum(["9:16", "16:9", "1:1"]),
    language: z.string().trim().min(1),
    resolution: z.enum(["720", "1080"]),
    step: z.number().int().min(0).max(3),
    subjects: z.array(z.object({ id: z.string().min(1), type: z.enum(["person", "scene", "product"]), name: z.string().trim().min(1), description: z.string(), replacementAssetId: z.string().optional() })),
    shots: z.array(
        z.object({
            id: z.string().min(1),
            title: z.string().trim().min(1),
            description: z.string(),
            dialogue: z.string(),
            duration: z.number().positive(),
            start: z.number().nonnegative(),
            subjectIds: z.array(z.string()),
            selectedAssetId: z.string().optional(),
        }),
    ),
});

export async function editRemake(userId: string, project: RemakeProject, value: unknown) {
    if (remakeBusy(project.remake)) throw new DramaProjectServiceError("任务执行中，请结束后再编辑", 409);
    const edit = editSchema.parse(value);
    if (new Set(edit.subjects.map((s) => s.id)).size !== edit.subjects.length || new Set(edit.shots.map((s) => s.id)).size !== edit.shots.length) throw new DramaProjectServiceError("主体或分镜 ID 重复", 400);
    if (edit.subjects.some((s) => edit.shots.some((shot) => shot.id === s.id))) throw new DramaProjectServiceError("主体与分镜 ID 不能相同", 400);
    if (edit.shots.some((s) => s.subjectIds.some((id) => !edit.subjects.some((subject) => subject.id === id)))) throw new DramaProjectServiceError("分镜引用了不存在的主体", 400);
    const subjects = await Promise.all(
        edit.subjects.map(async ({ replacementAssetId, ...s }) => ({ ...project.remake.subjects.find((old) => old.id === s.id), ...s, replacement: replacementAssetId ? await ownedMedia(userId, replacementAssetId, "image") : undefined })),
    );
    const shots = await Promise.all(
        edit.shots.map(async ({ selectedAssetId, ...s }) => {
            const old = project.remake.shots.find((old) => old.id === s.id);
            if (selectedAssetId && !old?.job?.results.some((r) => r.assetId === selectedAssetId)) throw new DramaProjectServiceError("请选择本镜头生成的版本", 400);
            return { ...old, ...s, selected: selectedAssetId ? await ownedMedia(userId, selectedAssetId, "video") : undefined };
        }),
    );
    if (edit.step > 0 && !project.remake.source) throw new DramaProjectServiceError("请先选择原视频", 400);
    if (edit.step > 1 && !shots.length) throw new DramaProjectServiceError("请先完成分镜解析", 400);
    const renderInput = (items: RemakeProject["remake"]["shots"]) => items.map((s) => ({ url: s.selected?.url, duration: s.duration }));
    const renderChanged = project.ratio !== edit.ratio || JSON.stringify(renderInput(shots)) !== JSON.stringify(renderInput(project.remake.shots));
    return saveRemake(userId, { ...project, title: edit.title, ratio: edit.ratio, remake: { ...project.remake, ...edit, subjects, shots, render: renderChanged ? undefined : project.remake.render } });
}

export async function ownedMedia(userId: string, id: string, type: "image" | "video") {
    const asset = await getCreativeAsset(id, userId);
    if (!asset || asset.type !== type || asset.status !== "ready") throw new DramaProjectServiceError("素材不存在或无权引用", 400);
    return remakeMedia(asset);
}

export async function startRemakeAnalysis(userId: string, project: RemakeProject, interval: number, origin: string, cookie: string) {
    if (remakeBusy(project.remake)) throw new DramaProjectServiceError("已有任务正在执行", 409);
    const settings = await getAuthSettings();
    const candidates = resolveLogicalModelCandidates(settings, "text", settings.defaultModels.textModel).map(toSystemGenerationChannel);
    if (!candidates.length) throw new DramaProjectServiceError("请在后台配置支持看图的默认文本模型", 400);
    project = await saveRemake(userId, { ...project, remake: { ...project.remake, analysis: { status: "running" } } });
    try {
        const input = await prepareRemakeAnalysis(project, userId, interval, origin, cookie);
        const taskId = randomUUID();
        project.remake = { ...project.remake, frames: input.frames, duration: input.duration, analysis: { status: "running", taskId } };
        project = await saveRemake(userId, project);
        const task = await createTextTask({ userId, config: candidates[0], candidateConfigs: candidates.slice(1), messages: input.messages }, taskId);
        await scheduleGenerationTask("text", task.id, { executionPhase: "created", nextPollAt: Date.now(), channelId: candidates[0].channelId });
        return project;
    } catch (error) {
        if (project.remake.analysis?.taskId && (await getTextTask(project.remake.analysis.taskId))) return project;
        await saveRemake(userId, { ...project, remake: { ...project.remake, analysis: { ...project.remake.analysis, status: "error", error: error instanceof Error ? error.message : "视频解析失败" } } }).catch(() => undefined);
        throw error;
    }
}

export async function startRemakeGeneration(userId: string, project: RemakeProject, targetId: string, origin: string, cookie: string) {
    if (project.remake.analysis?.status === "running" || ["pending", "running", "submitting"].includes(project.remake.render?.status || "")) throw new DramaProjectServiceError("请等待解析或合成结束", 409);
    const subject = project.remake.subjects.find((s) => s.id === targetId);
    const shot = project.remake.shots.find((s) => s.id === targetId);
    if (!subject && !shot) throw new DramaProjectServiceError("请选择主体或分镜", 400);
    if (["pending", "running"].includes((subject || shot)!.job?.status || "")) return refreshRemake(userId, project.id);
    const planningSubjects = shot ? project.remake.subjects.filter((s) => shot.subjectIds.includes(s.id)).map((s) => ({ ...s, description: remakeSubjectDescription(s) })) : project.remake.subjects;
    const references = subject
        ? [subject.replacement || subject.original].filter(Boolean)
        : project.remake.subjects
              .filter((s) => shot!.subjectIds.includes(s.id))
              .map((s) => s.replacement || s.original)
              .filter(Boolean);
    const job: RemakeJob = { requestId: `remake-${nanoid()}`, status: "pending", results: (subject || shot)!.job?.results || [] };
    job.request = {
        clientRequestId: job.requestId,
        surface: "drama",
        projectId: project.id,
        conversationId: project.creativeConversationId,
        publicPrompt: subject ? `生成主体参考图：${subject.name}。${subject.description}` : `生成分镜：${shot!.title}。${shot!.description}`,
        snapshot: {
            ...(shot ? { workflow: "remake" } : {}),
            project: { title: project.title, ratio: project.ratio, style: project.style },
            currentStage: "镜头生成",
            shots: shot ? [{ title: shot.title, description: shot.description, descriptionSource: "original-video", duration: shot.duration }] : [],
            characters: planningSubjects.filter((s) => s.type === "person").map(({ id, name, description }) => ({ id, name, description })),
            scenes: planningSubjects.filter((s) => s.type === "scene").map(({ id, name, description }) => ({ id, name, description })),
            props: planningSubjects.filter((s) => s.type === "product").map(({ id, name, description }) => ({ id, name, description })),
        },
        prompt: subject ? `生成一张主体参考图：${subject.name}。${subject.description}。保持主体清晰完整，用于视频主体替换。` : remakeShotPrompt(shot!, project.remake.subjects, project.remake.language),
        assetIds: [...new Set(references.map((r) => r!.assetId))],
        skillIds: [],
        modelIds: [],
        preferences: subject
            ? { mode: "image", image: { count: 1, quality: "auto" } }
            : { mode: "video", video: { size: project.ratio, quality: project.remake.resolution, seconds: shot!.duration, count: 1, generateAudio: true, referenceMode: "reference" } },
    };
    (subject || shot)!.job = job;
    project.remake.render = undefined;
    project = await saveRemake(userId, project);
    try {
        await internalJson(origin, cookie, "/api/agent/runs", job.request);
    } catch (error) {
        // Keep a stable request identity when HTTP submission outcome is uncertain.
        const existing = await getAgentRunByClientRequestId(userId, job.requestId);
        if (!existing) {
            job.error = error instanceof Error ? error.message : "提交响应中断，请查看 Agent 任务记录";
            if (error instanceof DramaProjectServiceError && error.status < 500) job.status = "error";
            await saveRemake(userId, project);
        }
    }
    return refreshRemake(userId, project.id);
}

export async function internalJson(origin: string, cookie: string, path: string, body: unknown) {
    const response = await fetchInternalApi(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new DramaProjectServiceError(data.msg || data.error || "请求失败", response.status);
    return data;
}

export async function recoverRemakeSubmissions(userId: string, id: string, origin: string, cookie: string) {
    let project = await getRemakeProject(userId, id);
    for (const target of [...project.remake.subjects, ...project.remake.shots]) {
        const job = target.job;
        if (job?.status !== "pending" || !job.request || (await getAgentRunByClientRequestId(userId, job.requestId))) continue;
        try {
            await internalJson(origin, cookie, "/api/agent/runs", job.request);
        } catch (e) {
            if (e instanceof DramaProjectServiceError && e.status < 500) {
                job.status = "error";
                job.error = e.message;
                project = await saveRemake(userId, project);
            }
        }
    }
}

export function publicRemakeProject(project: RemakeProject) {
    const copy = structuredClone(project);
    for (const target of [...copy.remake.subjects, ...copy.remake.shots]) if (target.job) delete target.job.request;
    return copy;
}
