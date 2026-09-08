import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/auth/request";
import { getAuthSettings } from "@/lib/auth/store";
import { editRemake, getRemakeProject, ownedMedia, refreshRemake, saveRemake, startRemakeAnalysis, startRemakeGeneration, recoverRemakeSubmissions, publicRemakeProject } from "@/lib/server/remake-service";
import type { RemakeProject } from "@/lib/remake-contract";
import { createDramaRenderTask, getDramaRenderTask } from "@/lib/server/drama-render-store";
import { renderDrama } from "@/lib/server/drama-render-runtime";
import { normalizeDramaRenderShots } from "@/lib/server/drama-render-input";
import { ffmpegAvailable } from "@/lib/server/ffmpeg";
import { emptyRemake, remakeBusy } from "@/lib/remake-contract";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { checkRateLimit } from "@/lib/server/security";

export const runtime = "nodejs";
export const maxDuration = 2400;
type Context = { params: Promise<{ id: string }> };
const bodySchema = z.object({
    action: z.enum(["edit", "source", "analyze", "cancel-preparation", "generate", "generate-all", "render"]),
    updatedAt: z.string(),
    input: z.unknown().optional(),
    assetId: z.string().optional(),
    targetId: z.string().optional(),
    interval: z.number().min(1).optional(),
});

export async function GET(request: Request, context: Context) {
    return handle(request, context, async (userId, id) => {
        const project = await refreshRemake(userId, id);
        if ([...project.remake.subjects, ...project.remake.shots].some((s) => s.job?.status === "pending")) after(() => recoverRemakeSubmissions(userId, id, resolveInternalOrigin(new URL(request.url).origin), request.headers.get("cookie") || ""));
        if (project.remake.render?.status === "pending") {
            const render = await getDramaRenderTask(project.remake.render.id);
            if (render?.userId === userId && render.status === "pending")
                after(() =>
                    renderDrama(
                        render,
                        normalizeDramaRenderShots(project.remake.shots.map((s) => ({ videoUrl: s.selected?.url, duration: s.duration, audioMode: "source" }))),
                        project.ratio,
                        resolveInternalOrigin(new URL(request.url).origin),
                        request.headers.get("cookie") || "",
                    ),
                );
        }
        const taskIds = [project.remake.analysis?.status === "running" ? project.remake.analysis.taskId : undefined, ...[...project.remake.subjects, ...project.remake.shots].filter((t) => t.job?.status === "running").map((t) => t.job?.runId)].filter(
            (id): id is string => Boolean(id),
        );
        if (taskIds.length) after(() => runGenerationTaskRecoveryBatch({ origin: resolveInternalOrigin(new URL(request.url).origin), cookie: request.headers.get("cookie") || "", limit: taskIds.length, taskIds }));
        return project;
    });
}

export async function POST(request: Request, context: Context) {
    return handle(request, context, async (userId, id) => {
        const body = bodySchema.parse(await readJsonBody(request));
        let project = await getRemakeProject(userId, id);
        if (body.updatedAt !== project.updatedAt) throw Object.assign(new Error("任务已更新，请刷新后重试"), { status: 409 });
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        const cookie = request.headers.get("cookie") || "";
        if (body.action === "cancel-preparation") {
            if (project.remake.analysis?.status !== "running" || project.remake.analysis.taskId) throw new Error("模型任务已经提交，不能取消准备阶段");
            project.remake.analysis = { status: "error", error: "已停止画面准备，可重新解析" };
            return saveRemake(userId, project);
        }
        if (body.action === "edit") return editRemake(userId, project, body.input);
        if (body.action === "source") {
            if (remakeBusy(project.remake)) throw new Error("请等待当前任务结束");
            const source = await ownedMedia(userId, body.assetId || "", "video");
            return saveRemake(userId, { ...project, remake: { ...emptyRemake(), language: project.remake.language, resolution: project.remake.resolution, source } });
        }
        if (!(await checkRateLimit(`remake:${userId}`, { maxRequests: 10, windowMs: 60_000 })).allowed) throw Object.assign(new Error("操作过于频繁，请稍后重试"), { status: 429 });
        if (body.action === "analyze") {
            const settings = await getAuthSettings();
            const result = await withGenerationConcurrencyLimit(userId, "text", 5 * 60_000, settings.generationConcurrency.text, () => startRemakeAnalysis(userId, project, body.interval || settings.generationDefaults.videoSeconds, origin, cookie));
            if (!result) throw new Error("文本任务已达到并发上限");
            if (result.remake.analysis?.taskId) after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [result.remake.analysis!.taskId!] }));
            return result;
        }
        if (body.action === "generate") return startRemakeGeneration(userId, project, body.targetId || "", origin, cookie);
        if (body.action === "generate-all") {
            for (const shot of project.remake.shots) {
                if (shot.selected || ["pending", "running"].includes(shot.job?.status || "")) continue;
                project = await startRemakeGeneration(userId, project, shot.id, origin, cookie);
            }
            return project;
        }
        if (remakeBusy(project.remake) || project.remake.render?.status === "submitting") throw new Error("已有任务正在执行");
        if (!project.remake.shots.length || project.remake.shots.some((s) => !s.selected)) throw new Error("请先完成全部分镜视频");
        if (!(await ffmpegAvailable())) throw new Error("服务器未安装 FFmpeg，无法合成成片");
        const settings = await getAuthSettings();
        const result = await withGenerationConcurrencyLimit(userId, "render", 60 * 60_000, settings.generationConcurrency.render, async () => {
            const task = await createDramaRenderTask({ userId, projectId: id, conversationId: project.creativeConversationId, title: project.title });
            project.remake.render = { id: task.id, status: task.status };
            project.remake.step = 3;
            const saved = await saveRemake(userId, project);
            after(() => renderDrama(task, normalizeDramaRenderShots(saved.remake.shots.map((s) => ({ videoUrl: s.selected!.url, duration: s.duration, audioMode: "source" }))), saved.ratio, origin, cookie));
            return saved;
        });
        if (!result) throw new Error("成片合成任务已达到并发上限");
        return result;
    });
}

async function handle(request: Request, context: Context, action: (userId: string, id: string) => Promise<unknown>) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const project = await action(user.id, (await context.params).id);
        return NextResponse.json({ code: 0, data: { project: publicRemakeProject(project as RemakeProject) }, msg: "OK" });
    } catch (error) {
        const status = error instanceof z.ZodError ? 400 : Number((error as { status?: number })?.status) || 400;
        return NextResponse.json({ code: status, data: null, msg: error instanceof z.ZodError ? "复刻参数格式不正确" : error instanceof Error ? error.message : "操作失败" }, { status });
    }
}
