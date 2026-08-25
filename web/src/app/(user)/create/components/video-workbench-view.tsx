"use client";

import { Button, Empty, Input, Popover, Spin, Switch, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Check, Clapperboard, Film, FolderOpen, History, ImagePlus, LoaderCircle, Orbit, Plus, RefreshCw, Settings2, Sparkles, Upload, WandSparkles, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { imagePreviewUrl } from "@/lib/media-image-url";
import type { CreativeAsset, CreativeGenerationPreferences, CreativeMessage } from "@/lib/creative-runtime-contract";
import type { CreativeVideoReferenceMode } from "@/lib/video-reference-contract";
import { cn } from "@/lib/utils";
import type { CreativeAgentRun } from "@/services/api/creative";

import type { CreativeModelOption } from "./creative-generation-controls";
import { WorkbenchGenerationHistoryList } from "./workbench-generation-history-list";

type FrameRole = "first_frame" | "last_frame";

const videoRatios = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const videoQualities = ["auto", "480", "720", "1080"] as const;

export function VideoWorkbenchView({
    inputRef,
    prompt,
    busy,
    uploading,
    optimizing,
    references,
    assets,
    messages,
    runs,
    historyLoading,
    models,
    selectedModels,
    smartPlanning,
    preferences,
    estimatedPoints,
    onPromptChange,
    onOptimize,
    onSubmit,
    onCancel,
    onUpload,
    onOpenAssets,
    onOpenHistory,
    onNew,
    onRemoveReference,
    onUseAsReference,
    onToggleModel,
    onClearModels,
    onToggleSmartPlanning,
    onPreferenceChange,
    onSelectFrame,
    onUploadFrame,
    onRemoveFrame,
    onRetry,
}: {
    inputRef: RefObject<TextAreaRef | null>;
    prompt: string;
    busy: boolean;
    uploading: boolean;
    optimizing: boolean;
    references: CreativeAsset[];
    assets: CreativeAsset[];
    messages: CreativeMessage[];
    runs: Record<string, CreativeAgentRun>;
    historyLoading: boolean;
    models: CreativeModelOption[];
    selectedModels: CreativeModelOption[];
    smartPlanning: boolean;
    preferences: CreativeGenerationPreferences;
    estimatedPoints: number;
    onPromptChange: (value: string) => void;
    onOptimize: () => void;
    onSubmit: () => void;
    onCancel: () => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    onOpenHistory: () => void;
    onNew: () => void;
    onRemoveReference: (id: string) => void;
    onUseAsReference: (asset: CreativeAsset) => void;
    onToggleModel: (model: CreativeModelOption) => void;
    onClearModels: () => void;
    onToggleSmartPlanning: () => void;
    onPreferenceChange: (patch: Record<string, string | number | boolean>) => void;
    onSelectFrame: (role: FrameRole, assetId: string) => void;
    onUploadFrame: (role: FrameRole) => void;
    onRemoveFrame: (role: FrameRole) => void;
    onRetry: (run: CreativeAgentRun) => void;
}) {
    const videoPreferences = preferences.video || {};
    const referenceMode = videoPreferences.referenceMode || "reference";
    const generatedAssets = assets.filter((asset) => asset.type === "video" && asset.status === "ready" && Boolean(asset.sourceRunId && asset.sourceTaskId) && Boolean(assetUrl(asset))).sort((left, right) => right.createdAt - left.createdAt);
    const videoRuns = Object.values(runs)
        .filter((run) => run.generationPreferences?.mode === "video" || run.tasks.some((task) => task.type === "video"))
        .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    const unresolvedRuns = videoRuns.filter((run) => !generatedAssets.some((asset) => asset.sourceRunId === run.id) && run.status !== "completed");
    const imageReferences = references.filter((asset) => asset.type === "image");

    return (
        <main data-testid="video-workbench-view" className="h-full min-h-0 overflow-y-auto bg-[#f3f6f8] text-[#152231] dark:bg-[#0e1215] dark:text-[#f2f5f6]">
            <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-7">
                <header className="flex min-h-12 items-start justify-between gap-4 border-b border-[#d9e2e7] pb-5 dark:border-[#293238]">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold tracking-[-0.025em] text-[#132231] dark:text-white">AI 视频生成</h1>
                        <span className="rounded-md border border-[#cde9e7] bg-[#eaf8f6] px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#137f78] dark:border-[#285a56] dark:bg-[#162d2b] dark:text-[#79d2cb]">MOTION STUDIO</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Tooltip title="新建创作">
                            <Button type="text" shape="circle" icon={<Plus className="size-4" />} onClick={onNew} aria-label="新建创作" />
                        </Tooltip>
                        <Tooltip title="创作历史">
                            <Button type="text" shape="circle" icon={<History className="size-4" />} onClick={onOpenHistory} aria-label="创作历史" />
                        </Tooltip>
                        <Tooltip title="我的素材">
                            <Button type="text" shape="circle" icon={<FolderOpen className="size-4" />} onClick={onOpenAssets} aria-label="我的素材" />
                        </Tooltip>
                    </div>
                </header>

                <div className="mt-6 grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(560px,1.08fr)_minmax(420px,.92fr)]">
                    <section className="flex min-w-0 flex-col gap-5">
                        <WorkbenchCard className="p-5">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold text-[#3c5969] dark:text-[#c8d8de]">镜头内容设想 / Motion Scene Prompt</h2>
                                <span className="text-[10px] font-medium text-[#8ba0ad]">{prompt.length}/2000</span>
                            </div>
                            <div className="rounded-2xl border border-[#d5e1e7] bg-[#f7fafb] p-2 transition focus-within:border-[#68aaa5] focus-within:ring-2 focus-within:ring-[#2c9890]/10 dark:border-[#303b41] dark:bg-[#151b1e]">
                                <Input.TextArea
                                    ref={inputRef}
                                    value={prompt}
                                    maxLength={2000}
                                    autoSize={{ minRows: 6, maxRows: 11 }}
                                    variant="borderless"
                                    className="!resize-none !bg-transparent !px-3 !py-2 !text-[14px] !leading-6"
                                    placeholder="描述主体、动作、镜头运动、环境、光线与节奏，例如：清晨草地上的金毛犬向镜头奔跑，低机位跟拍，阳光穿过毛发，镜头平稳推进……"
                                    onChange={(event) => onPromptChange(event.target.value)}
                                />
                                <div className="flex justify-end px-1 pb-1">
                                    <Button
                                        loading={optimizing}
                                        disabled={!prompt.trim()}
                                        icon={<WandSparkles className="size-4" />}
                                        className="!h-9 !rounded-full !border-[#cee8e5] !bg-[#edf9f7] !px-4 !text-xs !font-semibold !text-[#147d77] hover:!border-[#82bdb8] hover:!bg-[#e4f5f3] dark:!border-[#285a56] dark:!bg-[#162d2b] dark:!text-[#79d2cb]"
                                        onClick={onOptimize}
                                    >
                                        AI 优化分镜提示词
                                    </Button>
                                </div>
                            </div>
                        </WorkbenchCard>

                        <WorkbenchCard className="p-5">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-sm font-semibold text-[#2e4655] dark:text-[#d9e5e9]">参考素材与首尾帧</h2>
                                    <p className="mt-1 text-[11px] text-[#91a1ab]">按模型能力使用图片、视频、音频或首尾帧控制生成</p>
                                </div>
                                <div className="flex rounded-xl bg-[#eef3f5] p-1 dark:bg-[#20282c]">
                                    {(["reference", "first_frame", "first_last"] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            className={cn(
                                                "h-8 rounded-lg px-3 text-xs font-medium transition",
                                                referenceMode === mode ? "bg-white text-[#147d77] shadow-sm dark:bg-[#344047] dark:text-[#80d3cd]" : "text-[#758791] hover:text-[#324b58] dark:text-[#8fa0a8]",
                                            )}
                                            onClick={() => onPreferenceChange({ referenceMode: mode })}
                                        >
                                            {referenceModeLabel(mode)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {referenceMode === "reference" ? (
                                <div className="flex min-h-36 flex-wrap gap-3">
                                    {references.slice(0, 9).map((asset) => (
                                        <ReferenceTile key={asset.id} asset={asset} onRemove={() => onRemoveReference(asset.id)} />
                                    ))}
                                    {references.length < 9 ? (
                                        <button
                                            type="button"
                                            className="flex size-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#c7d7de] bg-[#f8fbfc] text-[#829ca7] transition hover:border-[#55a49e] hover:bg-[#f0faf8] hover:text-[#147d77] dark:border-[#354249] dark:bg-[#171e22]"
                                            onClick={onUpload}
                                            disabled={uploading}
                                        >
                                            {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <Upload className="size-5" />}
                                            <span className="text-xs">{uploading ? "上传中" : "添加参考素材"}</span>
                                        </button>
                                    ) : null}
                                    {!references.length ? (
                                        <button type="button" className="flex min-w-[210px] flex-1 items-center px-2 text-left text-xs leading-5 text-[#94a5ae] hover:text-[#147d77]" onClick={onOpenAssets}>
                                            可添加参考图片、视频或音频，也可以从我的素材中选择。
                                        </button>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                                    <FrameSlot label="首帧" role="first_frame" assetId={videoPreferences.firstFrameAssetId} images={imageReferences} uploading={uploading} onSelect={onSelectFrame} onUpload={onUploadFrame} onRemove={onRemoveFrame} />
                                    <div className="hidden items-center gap-2 text-[#9aabb3] sm:flex">
                                        <span className="h-px w-8 bg-current" />
                                        <Clapperboard className="size-4" />
                                        <span className="h-px w-8 bg-current" />
                                    </div>
                                    {referenceMode === "first_last" ? (
                                        <FrameSlot label="尾帧" role="last_frame" assetId={videoPreferences.lastFrameAssetId} images={imageReferences} uploading={uploading} onSelect={onSelectFrame} onUpload={onUploadFrame} onRemove={onRemoveFrame} />
                                    ) : (
                                        <div className="rounded-2xl border border-dashed border-[#d4e0e5] bg-[#fafcfd] p-5 text-xs leading-5 text-[#91a2ab] dark:border-[#344047] dark:bg-[#171d21]">当前使用首帧生成。模型会从首帧画面继续演绎后续动作。</div>
                                    )}
                                </div>
                            )}
                        </WorkbenchCard>

                        <WorkbenchCard className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 p-3 shadow-[0_16px_38px_rgba(39,60,67,0.10)] sm:flex-nowrap">
                            <ModelPicker models={models} selectedModels={selectedModels} smartPlanning={smartPlanning} onToggleModel={onToggleModel} onClearModels={onClearModels} onToggleSmartPlanning={onToggleSmartPlanning} />
                            <GenerationSettings preferences={preferences} onPreferenceChange={onPreferenceChange} />
                            <div className="min-w-0 flex-1" />
                            <Button
                                type="primary"
                                danger={busy}
                                icon={busy ? <X className="size-4" /> : <Film className="size-4" />}
                                className={cn("!h-12 !min-w-[220px] !rounded-2xl !border-0 !px-6 !text-sm !font-bold !shadow-[0_10px_25px_rgba(20,125,119,0.22)]", !busy && "!bg-[linear-gradient(100deg,#116e6a,#28a89e)] hover:!brightness-105")}
                                onClick={busy ? onCancel : onSubmit}
                            >
                                {busy ? "停止当前任务" : <>立即生成视频 {estimatedPoints > 0 ? <span className="ml-1 font-semibold text-[#d9ffb3]">预计 {estimatedPoints} 积分</span> : null}</>}
                            </Button>
                        </WorkbenchCard>
                    </section>

                    <section className="min-h-[460px] min-w-0">
                        <WorkbenchCard className="flex min-h-full flex-col overflow-hidden p-0">
                            <div className="flex items-center justify-between border-b border-[#e2e9ec] px-5 py-4 dark:border-[#2b353a]">
                                <div>
                                    <h2 className="text-sm font-bold text-[#253d4a] dark:text-[#e5edef]">历史视频生成结果</h2>
                                    <p className="mt-1 text-[11px] text-[#94a4ad]">最近创作的视频结果，无需切换会话</p>
                                </div>
                                <span className="rounded-full bg-[#e9f7f5] px-2.5 py-1 text-[10px] font-semibold text-[#147d77] dark:bg-[#17312f] dark:text-[#7bd0ca]">{generatedAssets.length} 条</span>
                            </div>
                            <div className="min-h-0 flex-1 p-4 sm:p-5">
                                {historyLoading && !generatedAssets.length && !unresolvedRuns.length ? (
                                    <div className="grid min-h-[380px] place-items-center">
                                        <Spin size="small" tip="正在读取历史视频" />
                                    </div>
                                ) : !generatedAssets.length && !unresolvedRuns.length ? (
                                    <div className="grid min-h-[380px] place-items-center">
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-[#94a4ad]">生成视频会显示在这里</span>} />
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {unresolvedRuns.map((run) => (
                                            <RunStatusCard key={run.id} run={run} prompt={runPrompt(run, messages)} onRetry={() => onRetry(run)} />
                                        ))}
                                        <WorkbenchGenerationHistoryList kind="video" assets={generatedAssets} runs={runs} messages={messages} onUseAsReference={onUseAsReference} />
                                    </div>
                                )}
                            </div>
                        </WorkbenchCard>
                    </section>
                </div>
            </div>
        </main>
    );
}

function WorkbenchCard({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cn("rounded-[22px] border border-[#d8e2e7] bg-white shadow-[0_2px_5px_rgba(31,50,60,0.03)] dark:border-[#2b353a] dark:bg-[#141a1d]", className)}>{children}</div>;
}

function ReferenceTile({ asset, onRemove }: { asset: CreativeAsset; onRemove: () => void }) {
    const url = assetUrl(asset);
    return (
        <div className="group relative size-36 overflow-hidden rounded-2xl border border-[#d7e2e7] bg-[#edf3f5] shadow-sm dark:border-[#334047] dark:bg-[#1b2327]">
            {asset.type === "image" ? (
                <img src={imagePreviewUrl(url, 384)} alt={asset.title || "参考图"} className="size-full object-cover" />
            ) : asset.type === "video" ? (
                <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
            ) : (
                <span className="grid size-full place-items-center">
                    <span className="text-center text-xs text-[#718892]">
                        <Sparkles className="mx-auto mb-2 size-5" />
                        音频参考
                    </span>
                </span>
            )}
            <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur">{asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"}</span>
            <button
                type="button"
                aria-label={`移除参考素材 ${asset.title}`}
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/70 group-hover:opacity-100"
                onClick={onRemove}
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}

function FrameSlot({
    label,
    role,
    assetId,
    images,
    uploading,
    onSelect,
    onUpload,
    onRemove,
}: {
    label: string;
    role: FrameRole;
    assetId?: string;
    images: CreativeAsset[];
    uploading: boolean;
    onSelect: (role: FrameRole, assetId: string) => void;
    onUpload: (role: FrameRole) => void;
    onRemove: (role: FrameRole) => void;
}) {
    const asset = images.find((item) => item.id === assetId);
    return (
        <div className="group relative">
            <Popover
                trigger="click"
                arrow={false}
                content={
                    <div className="w-[min(340px,calc(100vw-48px))] py-1">
                        <p className="mb-2 text-xs font-semibold">选择{label}图片</p>
                        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
                            {images.map((image) => (
                                <button
                                    key={image.id}
                                    type="button"
                                    className={cn("aspect-square overflow-hidden rounded-xl border", image.id === assetId ? "border-[#218f88] ring-2 ring-[#218f88]/20" : "border-[#dce4e8]")}
                                    onClick={() => onSelect(role, image.id)}
                                >
                                    <img src={imagePreviewUrl(assetUrl(image), 320)} alt={image.title || label} className="size-full object-cover" />
                                </button>
                            ))}
                        </div>
                        {!images.length ? <p className="py-5 text-center text-xs text-[#91a2ab]">请先上传一张图片</p> : null}
                        <Button type="text" block icon={<Upload className="size-4" />} loading={uploading} className="mt-2 !justify-start" onClick={() => onUpload(role)}>
                            上传新图片
                        </Button>
                    </div>
                }
            >
                <button
                    type="button"
                    className="relative aspect-video w-full overflow-hidden rounded-2xl border border-dashed border-[#c9d8de] bg-[#f5f9fa] text-[#78929d] transition hover:border-[#5ba7a1] hover:text-[#147d77] dark:border-[#36434a] dark:bg-[#171e22]"
                >
                    {asset ? (
                        <img src={imagePreviewUrl(assetUrl(asset), 640)} alt={asset.title || label} className="size-full object-cover" />
                    ) : (
                        <span className="absolute inset-0 grid place-items-center">
                            <span className="text-center">
                                <ImagePlus className="mx-auto mb-2 size-6" />
                                <span className="text-xs">添加{label}</span>
                            </span>
                        </span>
                    )}
                    <span className="absolute bottom-2 left-2 rounded-lg bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">{label}</span>
                </button>
            </Popover>
            {asset ? (
                <button
                    type="button"
                    aria-label={`移除${label}`}
                    className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition hover:bg-black/75 group-hover:opacity-100"
                    onClick={() => onRemove(role)}
                >
                    <X className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}

function ModelPicker({
    models,
    selectedModels,
    smartPlanning,
    onToggleModel,
    onClearModels,
    onToggleSmartPlanning,
}: Pick<Parameters<typeof VideoWorkbenchView>[0], "models" | "selectedModels" | "smartPlanning" | "onToggleModel" | "onClearModels" | "onToggleSmartPlanning">) {
    const summary = selectedModels.length ? (selectedModels.length === 1 ? selectedModels[0].name : `${selectedModels[0].name} +${selectedModels.length - 1}`) : smartPlanning ? "智能视频模型" : "选择模型";
    return (
        <Popover
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={
                <div className="w-[min(360px,calc(100vw-48px))] py-1">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold">选择视频模型</p>
                            <p className="mt-1 text-[11px] text-[#8999a2]">支持多模型生成，最多 6 个</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={smartPlanning}
                            className={cn("rounded-full px-3 py-1.5 text-xs font-medium", smartPlanning ? "bg-[#e6f5f3] text-[#147d77]" : "bg-[#eef2f4] text-[#647882]")}
                            onClick={onToggleSmartPlanning}
                        >
                            {smartPlanning ? "智能规划" : "手动选择"}
                        </button>
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                        {models.map((model) => {
                            const selected = selectedModels.some((item) => item.id === model.id);
                            return (
                                <button
                                    key={model.id}
                                    type="button"
                                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", selected ? "bg-[#eaf7f5] text-[#146f6a] dark:bg-[#193431] dark:text-[#86d6d0]" : "hover:bg-[#f4f7f8] dark:hover:bg-[#242c30]")}
                                    onClick={() => onToggleModel(model)}
                                >
                                    <span className="grid size-8 place-items-center rounded-lg bg-white shadow-sm dark:bg-[#344047]">
                                        <Orbit className="size-4" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{model.name}</span>
                                    <span className={cn("grid size-4 place-items-center rounded border", selected ? "border-[#218f88] bg-[#218f88] text-white" : "border-[#c8d3d8] text-transparent")}>
                                        <Check className="size-3" />
                                    </span>
                                </button>
                            );
                        })}
                        {!models.length ? <p className="py-8 text-center text-xs text-[#91a2ab]">管理后台尚未配置可用的视频模型</p> : null}
                    </div>
                    {!smartPlanning && selectedModels.length ? (
                        <button type="button" className="mt-2 w-full rounded-lg py-2 text-xs text-[#758891] hover:bg-[#f2f6f7]" onClick={onClearModels}>
                            清除选择并恢复智能规划
                        </button>
                    ) : null}
                </div>
            }
        >
            <Button icon={<Orbit className="size-4 text-[#218f88]" />} className="!h-11 !max-w-[230px] !rounded-xl !border-[#d8e2e7] !px-4">
                <span className="truncate text-xs font-medium">{summary}</span>
            </Button>
        </Popover>
    );
}

function GenerationSettings({ preferences, onPreferenceChange }: Pick<Parameters<typeof VideoWorkbenchView>[0], "preferences" | "onPreferenceChange">) {
    const video = preferences.video || {};
    const size = video.size || "auto";
    const quality = video.quality || "720";
    const seconds = video.seconds || 5;
    const count = video.count || 1;
    return (
        <Popover
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={
                <div className="w-[min(400px,calc(100vw-48px))] py-1">
                    <SettingGroup title="画面比例">
                        {videoRatios.map((item) => (
                            <SettingChip key={item} active={size === item} onClick={() => onPreferenceChange({ size: item })}>
                                {item === "auto" ? "智能" : item}
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <SettingGroup title="清晰度">
                        {videoQualities.map((item) => (
                            <SettingChip key={item} active={quality === item} onClick={() => onPreferenceChange({ quality: item })}>
                                {item === "auto" ? "智能" : `${item}P`}
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <SettingGroup title="视频时长">
                        {[5, 10].map((item) => (
                            <SettingChip key={item} active={seconds === item} onClick={() => onPreferenceChange({ seconds: item })}>
                                {item} 秒
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <SettingGroup title="生成数量">
                        {[1, 2, 3, 4].map((item) => (
                            <SettingChip key={item} active={count === item} onClick={() => onPreferenceChange({ count: item })}>
                                {item} 条
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#dfe7ea] bg-[#f8fafb] p-3 dark:border-[#354047] dark:bg-[#1d2529]">
                        <SwitchRow label="生成声音" checked={video.generateAudio ?? true} onChange={(checked) => onPreferenceChange({ generateAudio: checked })} />
                        <SwitchRow label="添加水印" checked={video.watermark ?? false} onChange={(checked) => onPreferenceChange({ watermark: checked })} />
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-[#93a3ab]">实际支持的比例、清晰度、时长和声音能力由所选上游模型决定。</p>
                </div>
            }
        >
            <Button icon={<Settings2 className="size-4 text-[#78909b]" />} className="!h-11 !rounded-xl !border-[#d8e2e7] !px-4">
                <span className="text-xs font-medium text-[#147d77]">{size === "auto" ? "智能比例" : size}</span>
                <span className="text-[#c3cfd4]">|</span>
                <span className="text-xs font-medium text-[#147d77]">{quality === "auto" ? "智能" : `${quality}P`}</span>
                <span className="text-[#c3cfd4]">|</span>
                <span className="text-xs font-medium text-[#147d77]">{seconds} 秒</span>
            </Button>
        </Popover>
    );
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="mb-4">
            <p className="mb-2 text-xs font-semibold text-[#445965] dark:text-[#d6e1e5]">{title}</p>
            <div className="flex flex-wrap gap-2">{children}</div>
        </div>
    );
}
function SettingChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className={cn(
                "h-8 rounded-lg border px-3 text-xs font-medium transition",
                active ? "border-[#3d9d96] bg-[#e9f7f5] text-[#147d77] dark:bg-[#17332f] dark:text-[#80d3cd]" : "border-[#dce4e8] text-[#657984] hover:border-[#8dbbb7] dark:border-[#374249] dark:text-[#9babb2]",
            )}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center justify-between gap-2 text-xs font-medium text-[#596e78] dark:text-[#b7c4ca]">
            <span>{label}</span>
            <Switch size="small" checked={checked} onChange={onChange} />
        </label>
    );
}

function RunStatusCard({ run, prompt, onRetry }: { run: CreativeAgentRun; prompt: string; onRetry: () => void }) {
    const failed = run.status === "failed";
    const cancelled = run.status === "cancelled";
    return (
        <div className={cn("flex items-center gap-3 rounded-2xl border p-4", failed ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20" : "border-[#dce5e9] bg-[#f8fafb] dark:border-[#2e393e] dark:bg-[#171e21]")}>
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", failed ? "bg-red-100 text-red-500 dark:bg-red-950" : "bg-[#e7f5f3] text-[#218f88] dark:bg-[#18312f]")}>
                {failed || cancelled ? <Film className="size-5" /> : <Spin size="small" />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[#405761] dark:text-[#d7e1e5]">{prompt || "AI 视频生成任务"}</p>
                <p className={cn("mt-1 line-clamp-2 text-[11px]", failed ? "text-red-500" : "text-[#91a2aa]")}>{failed ? run.tasks.find((task) => task.error)?.error || "生成失败" : cancelled ? "任务已取消" : "正在生成视频，任务可离开页面继续运行……"}</p>
            </div>
            {failed || cancelled ? (
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
                    重试
                </Button>
            ) : null}
        </div>
    );
}

function referenceModeLabel(mode: CreativeVideoReferenceMode) {
    return mode === "reference" ? "智能参考" : mode === "first_frame" ? "首帧" : "首尾帧";
}
function runPrompt(run: CreativeAgentRun, messages: CreativeMessage[]) {
    return run.prompt || messages.find((message) => message.runId === run.id && message.role === "user")?.content || "";
}
function assetUrl(asset: CreativeAsset) {
    return asset.serverUrl || asset.remoteUrl || "";
}
