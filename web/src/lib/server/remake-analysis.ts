import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { RemakeProject } from "@/lib/remake-contract";
import { remakeAnalysisSchema } from "@/lib/remake-contract";
import type { AiTextMessage } from "@/types/ai";
import { downloadMediaToFile } from "./media-download";
import { runFfmpeg, runFfprobe } from "./ffmpeg";
import { writePersistentMediaDataUrl } from "./reference-asset-store";
import { registerCreativeAssets } from "./creative-runtime-store";

// Sampling interval is a visible user setting, not a task timeout or retry limit.
export async function prepareRemakeAnalysis(project: RemakeProject, userId: string, interval: number, origin: string, cookie: string) {
    if (!project.remake.source) throw new Error("请先选择原视频");
    const dir = await mkdtemp(join(tmpdir(), "vozeb-remake-"));
    try {
        const video = join(dir, "source.mp4");
        await downloadMediaToFile(project.remake.source.url, video, { origin, cookie, maxBytes: 200 * 1024 * 1024 });
        const probe = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "json", video]);
        const duration = Number(JSON.parse(probe.stdout).format?.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长");
        await runFfmpeg(["-y", "-i", video, "-vf", `fps=1/${interval},scale=768:-2`, join(dir, "frame-%06d.jpg")]);
        let names = (await readdir(dir)).filter((name) => name.startsWith("frame-")).sort();
        if (!names.length) {
            await runFfmpeg(["-y", "-i", video, "-frames:v", "1", "-vf", "scale=768:-2", join(dir, "frame-000001.jpg")]);
            names = ["frame-000001.jpg"];
        }
        const frames: RemakeProject["remake"]["frames"] = [];
        const content: Exclude<AiTextMessage["content"], string> = [];
        const extractionId = `remake-frames-${nanoid()}`;
        for (const [index, name] of names.entries()) {
            const data = `data:image/jpeg;base64,${(await readFile(join(dir, name))).toString("base64")}`;
            const stored = await writePersistentMediaDataUrl(data, "image", { ownerUserId: userId, source: "drama", projectId: project.id, conversationId: project.creativeConversationId, originalName: name });
            const url = `/api/reference-assets/${stored.token}`;
            const [asset] = await registerCreativeAssets([
                {
                    userId,
                    conversationId: project.creativeConversationId!,
                    sourceRunId: extractionId,
                    sourceTaskId: extractionId,
                    ordinal: index,
                    type: "image",
                    title: `原视频画面 ${index + 1}`,
                    storageKey: stored.token,
                    serverUrl: url,
                    mimeType: "image/jpeg",
                    metadata: {},
                },
            ]);
            frames.push({ assetId: asset.id, url, storageKey: stored.token, title: asset.title, time: Math.min(index * interval, duration) });
            content.push({ type: "text", text: `frameIndex=${index}，约 ${index * interval} 秒` }, { type: "image_url", image_url: { url: data } });
        }
        const messages: AiTextMessage[] = [
            {
                role: "system",
                content: `你是视频复刻导演。根据按时间排序的真实视频采样帧识别角色、场景、商品与道具，拆解镜头并写出可直接生成视频的动作、构图、镜头语言。只陈述画面可证实的事实，采样帧没有音频，禁止捏造对白，dialogue 留空；镜头边界是采样估计值，不声称逐帧精确识别。每个主体用唯一 id，frameIndex 指向最清晰的真实采样帧。shots 中 subjectIds 只能引用 subjects 中的 id。只返回以下 JSON Schema 对应的 JSON，不要 Markdown：${JSON.stringify(z.toJSONSchema(remakeAnalysisSchema))}`,
            },
            { role: "user", content: [{ type: "text", text: `视频总长 ${duration} 秒。目标语言 ${project.remake.language}。请分析整个采样序列。` }, ...content] },
        ];
        return { duration, frames, messages };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
