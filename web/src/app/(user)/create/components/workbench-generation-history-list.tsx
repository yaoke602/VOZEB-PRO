"use client";

import { Modal, Tooltip } from "antd";
import { Download, ImageIcon, Play, Video } from "lucide-react";
import { useMemo, useState } from "react";

import { imagePreviewUrl } from "@/lib/media-image-url";
import type { CreativeAsset, CreativeMessage } from "@/lib/creative-runtime-contract";
import { cn } from "@/lib/utils";
import type { CreativeAgentRun } from "@/services/api/creative";

type WorkbenchGenerationHistoryListProps = {
    kind: "image" | "video";
    assets: CreativeAsset[];
    runs: Record<string, CreativeAgentRun>;
    messages: CreativeMessage[];
    onUseAsReference: (asset: CreativeAsset) => void;
};

export function WorkbenchGenerationHistoryList({ kind, assets, runs, messages, onUseAsReference }: WorkbenchGenerationHistoryListProps) {
    const [previewAsset, setPreviewAsset] = useState<CreativeAsset>();
    const messagePromptByRunId = useMemo(() => Object.fromEntries(messages.filter((message) => message.role === "user" && message.runId).map((message) => [message.runId as string, message.content])), [messages]);

    return (
        <>
            <div className="hide-scrollbar max-h-[calc(100dvh-240px)] space-y-3 overflow-y-auto overscroll-contain pr-1" data-testid="workbench-generation-history-list">
                {assets.map((asset) => {
                    const run = asset.sourceRunId ? runs[asset.sourceRunId] : undefined;
                    const task = run?.tasks.find((item) => item.id === asset.sourceTaskId) || run?.tasks.find((item) => item.type === kind);
                    const prompt = task?.optimizedPrompt || run?.prompt || (run ? messagePromptByRunId[run.id] : "") || asset.title;
                    const url = assetUrl(asset);

                    return (
                        <article
                            key={asset.id}
                            className={cn(
                                "group flex min-w-0 gap-3 rounded-2xl border bg-[#f8fafc] p-2.5 transition hover:-translate-y-px hover:bg-white hover:shadow-[0_10px_28px_rgba(37,50,76,0.10)] dark:bg-[#191e24] dark:hover:bg-[#1d232a]",
                                kind === "image" ? "border-[#e0e6ee] hover:border-[#d7b9fa] dark:border-[#303741]" : "border-[#dce5e9] hover:border-[#9fd5d1] dark:border-[#2e393e]",
                            )}
                        >
                            <button
                                type="button"
                                className="relative aspect-video w-[112px] shrink-0 overflow-hidden rounded-xl bg-[#e9eef3] text-left sm:w-[128px] dark:bg-[#101519]"
                                onClick={() => setPreviewAsset(asset)}
                                aria-label={`预览${asset.title || (kind === "image" ? "生成图片" : "生成视频")}`}
                            >
                                {kind === "image" ? (
                                    <img src={imagePreviewUrl(url, 480)} alt={asset.title || "生成图片"} className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                                ) : (
                                    <>
                                        <video src={url} poster={assetCover(asset) ? imagePreviewUrl(assetCover(asset), 480) : undefined} muted playsInline preload="metadata" className="size-full object-cover" />
                                        <span className="absolute inset-0 grid place-items-center bg-black/10 transition group-hover:bg-black/20">
                                            <span className="grid size-8 place-items-center rounded-full bg-white/90 text-[#163c43] shadow-sm backdrop-blur">
                                                <Play className="ml-0.5 size-3.5 fill-current" />
                                            </span>
                                        </span>
                                    </>
                                )}
                            </button>

                            <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
                                <p className={cn("truncate text-xs font-bold sm:text-[13px]", kind === "image" ? "text-[#3d3153] dark:text-[#e5d8f5]" : "text-[#294852] dark:text-[#d7e5e8]")}>
                                    {asset.title || (kind === "image" ? "AI 生成图片" : "AI 生成视频")}
                                </p>
                                <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-[#8d9bb0] dark:text-[#8f9ca7]">{prompt || "生成任务已完成"}</p>
                                <div className="mt-2 flex min-w-0 items-center gap-2 text-[10px] font-medium text-[#65758b] dark:text-[#9ca8b3]">
                                    <span>{assetMeta(asset, kind, task)}</span>
                                    <button type="button" className={cn("truncate font-semibold transition", kind === "image" ? "text-[#9a35e9] hover:text-[#7a1dbc]" : "text-[#168a83] hover:text-[#0d6e68]")} onClick={() => onUseAsReference(asset)}>
                                        设为参考 →
                                    </button>
                                </div>
                            </div>

                            <div className="flex shrink-0 flex-col items-end justify-between py-0.5">
                                <span
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold",
                                        kind === "image" ? "border-[#eddcff] bg-[#fbf7ff] text-[#9637df] dark:border-[#48335c] dark:bg-[#271d32]" : "border-[#d8efed] bg-[#f2fbfa] text-[#16847e] dark:border-[#284844] dark:bg-[#19302e]",
                                    )}
                                >
                                    {kind === "image" ? <ImageIcon className="size-3" /> : <Video className="size-3" />}
                                    {kind === "image" ? "图片" : "视频"}
                                </span>
                                <Tooltip title={kind === "image" ? "下载原图" : "下载视频"}>
                                    <a
                                        className="grid size-7 place-items-center rounded-full border border-[#dbe3eb] bg-white text-[#6e7d8f] transition hover:border-[#b9c7d6] hover:text-[#273a50] dark:border-[#37414b] dark:bg-[#242b32] dark:text-[#a7b1bc]"
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        download
                                        aria-label={kind === "image" ? "下载原图" : "下载视频"}
                                    >
                                        <Download className="size-3.5" />
                                    </a>
                                </Tooltip>
                            </div>
                        </article>
                    );
                })}
            </div>

            <Modal open={Boolean(previewAsset)} footer={null} centered width={kind === "image" ? 920 : 980} destroyOnHidden onCancel={() => setPreviewAsset(undefined)} title={previewAsset?.title || (kind === "image" ? "图片预览" : "视频预览")}>
                {previewAsset && kind === "image" ? (
                    <div className="grid max-h-[76dvh] place-items-center overflow-hidden rounded-xl bg-[#f3f5f7] dark:bg-[#101418]">
                        <img src={imagePreviewUrl(assetUrl(previewAsset), 1920)} alt={previewAsset.title || "生成图片"} className="max-h-[76dvh] max-w-full object-contain" />
                    </div>
                ) : previewAsset ? (
                    <video src={assetUrl(previewAsset)} poster={assetCover(previewAsset) || undefined} controls autoPlay playsInline className="max-h-[76dvh] w-full rounded-xl bg-black object-contain" />
                ) : null}
            </Modal>
        </>
    );
}

function assetMeta(asset: CreativeAsset, kind: "image" | "video", task?: CreativeAgentRun["tasks"][number]) {
    const items: string[] = [];
    if (kind === "video") {
        const seconds = asset.durationMs ? Math.round(asset.durationMs / 1000) : task?.seconds;
        if (seconds) items.push(`${seconds}s`);
    }
    if (asset.width && asset.height) items.push(`${asset.width} × ${asset.height}`);
    else if (task?.ratio || metadataText(asset, "ratio")) items.push(task?.ratio || metadataText(asset, "ratio"));
    const quality = task?.quality || metadataText(asset, "resolution");
    if (quality && quality !== "auto") items.push(normalizeQuality(quality));
    return items.join(" · ") || (kind === "image" ? "图片生成完成" : "视频生成完成");
}

function metadataText(asset: CreativeAsset, key: string) {
    return typeof asset.metadata?.[key] === "string" ? asset.metadata[key] : "";
}

function normalizeQuality(quality: string) {
    return /^\d+$/.test(quality) ? `${quality}P` : quality.toUpperCase();
}

function assetUrl(asset: CreativeAsset) {
    return asset.serverUrl || asset.remoteUrl || "";
}

function assetCover(asset: CreativeAsset) {
    return typeof asset.metadata?.coverUrl === "string" ? asset.metadata.coverUrl : typeof asset.metadata?.posterUrl === "string" ? asset.metadata.posterUrl : "";
}
