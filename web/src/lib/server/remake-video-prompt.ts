import type { CreativeAsset, CreativeSurface } from "@/lib/creative-runtime-contract";
import { creativeAssetReferenceAliases } from "@/lib/creative-asset-references";
import { assetAccessUrl } from "./agent-run-surface-policy";

export function isRemakeVideoPlanning(surface: CreativeSurface, snapshot: unknown) {
    return surface === "drama" && !!snapshot && typeof snapshot === "object" && "workflow" in snapshot && snapshot.workflow === "remake";
}

export const REMAKE_VIDEO_PLANNER_INSTRUCTION =
    "本轮为爆款复刻分镜视频。先用本轮已选主体设定改写原分镜：原分镜只提供动作、构图、叙事和节奏；替换人物、场景的外观与风格由新参考图决定，不能复制旧发型、服装、体型、装修等冲突描述。替换商品时采用新图商品及包装，不得把可能来自原视频的卡片名称当成新商品品名；未确认新图品名时只用图片别名指定商品，不生成旧商品名称字幕或臆测品牌。没有实际看图能力时不臆测新图细节，只用图片别名绑定对应主体。未配置替换的主体保留原设定；未选中的主体或历史任务产物不能自动加入。所有本轮参考图片均需保留在视频任务 assetIds 中。deliverables 中的视频 prompt 只写改写完成后的画面、动作、镜头、声音、必要对白和参考关系，不要复述原版与新版两套设定或添加用户未要求的情节。参考素材只用图片1、图片2等引用别名说明用途；资产 ID 只放 assetIds 字段，禁止在 prompt 写资产 ID、文件名、媒体地址、内部项目阶段、规划理由或重复的约束清单。foundation 等规划字段继续正常输出用于内部规划，不要复制进 prompt。";

// Keep the planner's visual instructions; remove only known asset identifiers,
// and remap aliases to the actual attachment order without changing references.
export function remakeVideoPrompt(prompt: string, selectedAssets: CreativeAsset[], originalAliases: Map<string, string>) {
    const aliases = creativeAssetReferenceAliases(
        selectedAssets,
        selectedAssets.map((asset) => asset.id),
    );
    const replacements = new Map<string, string>();
    for (const asset of selectedAssets) {
        const alias = aliases.get(asset.id)!;
        replacements.set(asset.id, alias);
        const url = assetAccessUrl(asset);
        if (url) replacements.set(url, alias);
        const original = originalAliases.get(asset.id);
        if (original) {
            replacements.set(original, alias);
            replacements.set(`@${original}`, alias);
        }
    }
    if (!replacements.size) return prompt.trim();
    const tokens = [...replacements.keys()].sort((a, b) => b.length - a.length);
    const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return prompt.replace(new RegExp(`(?<![\\w-])(?:${pattern})(?![\\w-])`, "g"), (token) => replacements.get(token)!).trim();
}
