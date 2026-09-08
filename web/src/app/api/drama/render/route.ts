import { renderDrama } from "@/lib/server/drama-render-runtime";
import { after, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { createDramaRenderTask, type DramaRenderTask } from "@/lib/server/drama-render-store";
import { normalizeDramaRenderShots } from "@/lib/server/drama-render-input";
import { ffmpegAvailable } from "@/lib/server/ffmpeg";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { normalizeDramaImageSize } from "@/lib/drama-image-size";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const rate = await checkGenerationRateLimit(user.id, request, "render");
    if (!rate.allowed) return NextResponse.json({ code: 429, data: null, msg: "成片合成请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const renderLimit = (await getAuthSettings()).generationConcurrency.render;
    const response = await withGenerationConcurrencyLimit(user.id, "render", 60 * 60_000, renderLimit, async () => {
        if (!(await ffmpegAvailable())) return NextResponse.json({ code: 503, data: null, msg: "当前服务器未安装 FFmpeg" }, { status: 503 });
        let body: { projectId?: unknown; conversationId?: unknown; title?: unknown; ratio?: unknown; shots?: unknown[] };
        try {
            body = await readJsonBody(request);
        } catch (error) {
            if (isAuthInputError(error)) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
            throw error;
        }
        const projectId = text(body.projectId);
        const title = text(body.title) || "短剧成片";
        const shots = normalizeDramaRenderShots(body.shots);
        if (!projectId || !shots.length || shots.some((shot) => !shot.videoUrl)) return NextResponse.json({ code: 400, data: null, msg: "请先完成全部镜头视频" }, { status: 400 });
        if (shots.some((shot) => shot.audioMode === "voiceover" && !shot.audioUrl)) return NextResponse.json({ code: 400, data: null, msg: "部分镜头选择了 AI 配音，但配音尚未完成" }, { status: 400 });
        const size = normalizeDramaImageSize(body.ratio);
        if (!size) return NextResponse.json({ code: 400, data: null, msg: "短剧尺寸无效" }, { status: 400 });
        const task = await createDramaRenderTask({ userId: user.id, projectId, conversationId: text(body.conversationId) || undefined, title });
        after(() => renderDrama(task, shots, size, resolveInternalOrigin(new URL(request.url).origin), request.headers.get("cookie") || ""));
        return NextResponse.json({ code: 0, data: publicTask(task), msg: "合成任务已创建" });
    });
    return response || NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${renderLimit} 个整集合成任务` }, { status: 429 });
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
function publicTask(task: DramaRenderTask) {
    return { id: task.id, status: task.status, result: task.result, error: task.error };
}
