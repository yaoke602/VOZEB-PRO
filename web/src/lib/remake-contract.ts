import { z } from "zod";
import type { DramaProject } from "./drama-project-contract";

export const remakeSteps = ["原视频", "主体设定", "分镜", "视频成片"] as const;
export const subjectLabels = { person: "角色", scene: "场景", product: "商品与道具" } as const;
export type RemakeMedia = { assetId: string; url: string; storageKey?: string; title: string };
export type RemakeJob = { request?: import("./creative-runtime-contract").CreativeRunRequest; requestId: string; runId?: string; status: "pending" | "running" | "success" | "error"; error?: string; results: RemakeMedia[] };
export type RemakeSubject = { id: string; type: keyof typeof subjectLabels; name: string; description: string; original?: RemakeMedia; replacement?: RemakeMedia; job?: RemakeJob };
export type RemakeShot = { id: string; title: string; description: string; dialogue: string; duration: number; start: number; subjectIds: string[]; job?: RemakeJob; selected?: RemakeMedia };
export type RemakeState = {
    step: number;
    language: string;
    resolution: string;
    source?: RemakeMedia;
    duration?: number;
    frames: Array<RemakeMedia & { time: number }>;
    analysis?: { taskId?: string; status: "running" | "success" | "error"; error?: string };
    subjects: RemakeSubject[];
    shots: RemakeShot[];
    render?: { id: string; status: string; url?: string; error?: string };
};
export type RemakeProject = DramaProject & { remake: RemakeState };
export const emptyRemake = (): RemakeState => ({ step: 0, language: "中文", resolution: "720", frames: [], subjects: [], shots: [] });

export const remakeAnalysisSchema = z.object({
    subjects: z.array(z.object({ id: z.string().min(1), type: z.enum(["person", "scene", "product"]), name: z.string().min(1), description: z.string(), frameIndex: z.number().int().nonnegative() })),
    shots: z.array(z.object({ title: z.string().min(1), description: z.string().min(1), dialogue: z.string(), start: z.number().nonnegative(), duration: z.number().positive(), subjectIds: z.array(z.string()) })).min(1),
});

export function parseRemakeAnalysis(text: string, frames: RemakeState["frames"], duration: number) {
    const result = remakeAnalysisSchema.parse(
        JSON.parse(
            text
                .trim()
                .replace(/^```(?:json)?\s*/i, "")
                .replace(/\s*```$/, ""),
        ),
    );
    const ids = new Set(result.subjects.map((s) => s.id));
    if (ids.size !== result.subjects.length) throw new Error("分析结果中有重复主体，请重新解析");
    if (result.subjects.some((s) => !frames[s.frameIndex]) || result.shots.some((s) => s.start >= duration || s.subjectIds.some((id) => !ids.has(id)))) throw new Error("分析结果包含无效画面或主体引用，请重新解析");
    return {
        subjects: result.subjects.map(({ frameIndex, ...subject }) => ({ ...subject, id: `subject-${subject.id}`, original: frames[frameIndex] })),
        shots: result.shots.sort((a, b) => a.start - b.start).map((shot, i) => ({ ...shot, subjectIds: shot.subjectIds.map((id) => `subject-${id}`), id: `shot-${i + 1}` })),
    };
}

export function remakeShotPrompt(shot: RemakeShot, subjects: RemakeSubject[], language: string) {
    const references = subjects.filter((s) => shot.subjectIds.includes(s.id));
    const ids = [...new Set(references.map((s) => (s.replacement || s.original)?.assetId).filter(Boolean))];
    return `生成一个视频镜头。请先依据本轮主体设定改写原分镜，再输出用于视频生成的画面描述。\n原分镜（动作、构图和节奏参考，不代表替换后的主体外观）：${shot.description}\n对白/旁白：${shot.dialogue || "无"}\n目标语言：${language}。只改写本镜头已选且配置了替换图的主体；未选中的主体不自动加入。替换主体的外观不得沿用原分镜或历史生成中的旧设定。商品替换时，画面商品、包装、液体表现及相关商品名称字幕应与当前商品一致，不得继续要求旧商品；无关字幕和用户对白保持原意。\n本镜头当前主体设定：\n${references.map((s) => `${s.replacement || s.original ? `图片${ids.indexOf((s.replacement || s.original)!.assetId) + 1}` : "文字设定"}：${s.name}，${remakeSubjectDescription(s)}`).join("\n")}`;
}

export function remakeSubjectDescription(subject: RemakeSubject) {
    if (!subject.replacement) return `${subject.description}（沿用原内容；参考图可能是全景帧，仅识别对应主体）`;
    if (subject.type === "product") return `商品/道具的品名、外形、包装、材质、颜色及风格以本轮替换图片为准；卡片名称“${subject.name}”仅用于定位主体，可能仍来自原视频，不得据此强制沿用旧品名。未确认新图品名时用图片别名指定商品，不臆测品牌，不添加旧商品名称字幕。`;
    return `${subject.type === "person" ? "人物外观、服装、发型、体型及画面风格" : "场景外观、陈设、材质、色彩及画面风格"}以本轮替换图片为准；原主体描述和原分镜中的旧外观不再作为约束。不臆测图片中未确认的细节，用引用别名指定新主体，保留本镜头动作和构图。`;
}

export function remakeBusy(state: RemakeState) {
    return state.analysis?.status === "running" || [...state.subjects, ...state.shots].some((s) => s.job?.status === "pending" || s.job?.status === "running") || ["pending", "running"].includes(state.render?.status || "");
}
