"use client";

import { Button, Empty, Input, Popover, Spin, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Check, FolderOpen, History, ImageIcon, ImagePlus, LoaderCircle, Orbit, Plus, RefreshCw, Settings2, Sparkles, WandSparkles, X } from "lucide-react";
import type { RefObject } from "react";

import { imagePreviewUrl } from "@/lib/media-image-url";
import type { CreativeAsset, CreativeGenerationPreferences, CreativeMessage } from "@/lib/creative-runtime-contract";
import { cn } from "@/lib/utils";
import type { CreativeAgentRun } from "@/services/api/creative";

import type { CreativeModelOption } from "./creative-generation-controls";
import { WorkbenchGenerationHistoryList } from "./workbench-generation-history-list";
import { imageWorkbenchRatios, imageWorkbenchResolutions, imageWorkbenchSizeLabel, type ImageWorkbenchRatio, type ImageWorkbenchResolution } from "../image-workbench-resolution";

type ImageQuality = NonNullable<CreativeGenerationPreferences["image"]>["quality"];

export function ImageWorkbenchView({
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
    ratio,
    resolution,
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
    onRatioChange,
    onResolutionChange,
    onPreferenceChange,
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
    ratio: ImageWorkbenchRatio;
    resolution: ImageWorkbenchResolution;
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
    onRatioChange: (ratio: ImageWorkbenchRatio) => void;
    onResolutionChange: (resolution: ImageWorkbenchResolution) => void;
    onPreferenceChange: (patch: Record<string, string | number | boolean>) => void;
    onRetry: (run: CreativeAgentRun) => void;
}) {
    const imagePreferences = preferences.image || {};
    const count = imagePreferences.count || 1;
    const quality = imagePreferences.quality || "auto";
    const generatedAssets = assets.filter((asset) => asset.type === "image" && asset.status === "ready" && Boolean(asset.sourceRunId && asset.sourceTaskId) && Boolean(assetUrl(asset))).sort((left, right) => right.createdAt - left.createdAt);
    const imageRuns = Object.values(runs)
        .filter((run) => run.generationPreferences?.mode === "image" || run.tasks.some((task) => task.type === "image"))
        .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    const unresolvedRuns = imageRuns.filter((run) => !generatedAssets.some((asset) => asset.sourceRunId === run.id) && run.status !== "completed");

    return (
        <main data-testid="image-workbench-view" className="h-full min-h-0 overflow-y-auto bg-[#f4f7fb] text-[#172033] dark:bg-[#101318] dark:text-[#f3f5f7]">
            <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-7">
                <header className="flex min-h-12 items-start justify-between gap-4 border-b border-[#dce3ed] pb-5 dark:border-[#2b313a]">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold tracking-[-0.025em] text-[#13203a] dark:text-white">AI 图片生成</h1>
                        <span className="rounded-md border border-[#e7d9ff] bg-[#f8f0ff] px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-[#922bff] dark:border-[#513269] dark:bg-[#291d34] dark:text-[#d3a1ff]">IMAGE STUDIO</span>
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
                                <h2 className="text-sm font-semibold text-[#48607f] dark:text-[#cad4e2]">画面内容设想 / Product Scene Prompt</h2>
                                <span className="text-[10px] font-medium text-[#8ea0ba]">{prompt.length}/2000</span>
                            </div>
                            <div className="rounded-2xl border border-[#d9e2ef] bg-[#f7f9fc] p-2 transition focus-within:border-[#bd9cff] focus-within:ring-2 focus-within:ring-[#a94bff]/10 dark:border-[#323946] dark:bg-[#171b21]">
                                <Input.TextArea
                                    ref={inputRef}
                                    value={prompt}
                                    maxLength={2000}
                                    autoSize={{ minRows: 6, maxRows: 11 }}
                                    variant="borderless"
                                    className="!resize-none !bg-transparent !px-3 !py-2 !text-[14px] !leading-6"
                                    placeholder="在此输入您的创意画面或产品设定，例如：一只带有金属微光的智能运动手表，置于极简暗色赛博底座，环绕圆形淡紫色冷光环，微距质感宣传海报……"
                                    onChange={(event) => onPromptChange(event.target.value)}
                                />
                                <div className="flex justify-end px-1 pb-1">
                                    <Button
                                        loading={optimizing}
                                        disabled={!prompt.trim()}
                                        icon={<WandSparkles className="size-4" />}
                                        className="!h-9 !rounded-full !border-[#eadcff] !bg-[#fbf6ff] !px-4 !text-xs !font-semibold !text-[#922bff] hover:!border-[#cda5ff] hover:!bg-[#f8efff] dark:!border-[#513269] dark:!bg-[#291d34] dark:!text-[#d3a1ff]"
                                        onClick={onOptimize}
                                    >
                                        AI 优化提示词
                                    </Button>
                                </div>
                            </div>
                        </WorkbenchCard>

                        <WorkbenchCard className="p-5">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                <h2 className="text-sm font-semibold text-[#30435f] dark:text-[#dbe3ee]">
                                    上传参考图 / Subjects（最多9张） <span className="text-[#8da0b8]">({references.length}/9)</span>
                                </h2>
                                <button type="button" className="text-xs font-medium text-[#8999af] transition hover:text-[#8d2dff]" onClick={onOpenAssets}>
                                    支持上传或从资产库导入
                                </button>
                            </div>
                            <div className="flex min-h-36 flex-wrap gap-3">
                                {references.map((asset) => (
                                    <div key={asset.id} className="group relative size-36 overflow-hidden rounded-2xl border border-[#dce4ef] bg-[#f7f9fc] shadow-sm dark:border-[#343b46] dark:bg-[#1b2027]">
                                        <img src={imagePreviewUrl(assetUrl(asset), 384)} alt={asset.title || "参考图"} className="size-full object-cover" />
                                        <button
                                            type="button"
                                            aria-label={`移除参考图 ${asset.title}`}
                                            className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/70 group-hover:opacity-100"
                                            onClick={() => onRemoveReference(asset.id)}
                                        >
                                            <X className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {references.length < 9 ? (
                                    <button
                                        type="button"
                                        className="flex size-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#ccd7e5] bg-[#f8fafc] text-[#8ba0ba] transition hover:border-[#b76dff] hover:bg-[#fbf7ff] hover:text-[#922bff] dark:border-[#3a424e] dark:bg-[#181d23]"
                                        onClick={onUpload}
                                        disabled={uploading}
                                    >
                                        {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
                                        <span className="text-xs">{uploading ? "上传中" : "添加参考"}</span>
                                    </button>
                                ) : null}
                                {!references.length ? <div className="flex min-w-[210px] flex-1 items-center px-2 text-xs leading-5 text-[#9aa9bb]">参考图会随本次请求提交，可用于保持人物、商品或画面风格一致。</div> : null}
                            </div>
                        </WorkbenchCard>

                        <WorkbenchCard className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 p-3 shadow-[0_16px_38px_rgba(46,59,88,0.10)] sm:flex-nowrap">
                            <ModelPicker models={models} selectedModels={selectedModels} smartPlanning={smartPlanning} onToggleModel={onToggleModel} onClearModels={onClearModels} onToggleSmartPlanning={onToggleSmartPlanning} />
                            <GenerationSettings ratio={ratio} resolution={resolution} quality={quality} count={count} onRatioChange={onRatioChange} onResolutionChange={onResolutionChange} onPreferenceChange={onPreferenceChange} />
                            <div className="min-w-0 flex-1" />
                            <Button
                                type="primary"
                                danger={busy}
                                icon={busy ? <X className="size-4" /> : <Sparkles className="size-4" />}
                                className={cn("!h-12 !min-w-[220px] !rounded-2xl !border-0 !px-6 !text-sm !font-bold !shadow-[0_10px_25px_rgba(156,39,255,0.24)]", !busy && "!bg-[linear-gradient(100deg,#8c22f5,#f32d9e)] hover:!brightness-105")}
                                onClick={busy ? onCancel : onSubmit}
                            >
                                {busy ? "停止当前任务" : <>立即生成图片 {estimatedPoints > 0 ? <span className="ml-1 font-semibold text-[#fff0a8]">预计 {estimatedPoints} 积分</span> : null}</>}
                            </Button>
                        </WorkbenchCard>
                    </section>

                    <section className="min-h-[420px] min-w-0">
                        <WorkbenchCard className="flex min-h-full flex-col overflow-hidden p-0">
                            <div className="flex items-center justify-between border-b border-[#e5eaf1] px-5 py-4 dark:border-[#2d333c]">
                                <div>
                                    <h2 className="text-sm font-bold text-[#263750] dark:text-[#e7edf5]">历史绘图生成结果</h2>
                                    <p className="mt-1 text-[11px] text-[#97a5b6]">最近创作的图片结果，无需切换会话</p>
                                </div>
                                <span className="rounded-full bg-[#f4efff] px-2.5 py-1 text-[10px] font-semibold text-[#8c2cec] dark:bg-[#2b2038] dark:text-[#d2a2ff]">{generatedAssets.length} 张</span>
                            </div>
                            <div className="min-h-0 flex-1 p-4 sm:p-5">
                                {historyLoading && !generatedAssets.length && !unresolvedRuns.length ? (
                                    <div className="grid min-h-[360px] place-items-center">
                                        <Spin size="small" tip="正在读取历史图片" />
                                    </div>
                                ) : !generatedAssets.length && !unresolvedRuns.length ? (
                                    <div className="grid min-h-[360px] place-items-center">
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-[#97a5b6]">生成结果会显示在这里</span>} />
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {unresolvedRuns.map((run) => (
                                            <RunStatusCard key={run.id} run={run} prompt={runPrompt(run, messages)} onRetry={() => onRetry(run)} />
                                        ))}
                                        <WorkbenchGenerationHistoryList kind="image" assets={generatedAssets} runs={runs} messages={messages} onUseAsReference={onUseAsReference} />
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

function WorkbenchCard({ className, children }: { className?: string; children: React.ReactNode }) {
    return <div className={cn("rounded-[22px] border border-[#dce3ec] bg-white shadow-[0_2px_5px_rgba(36,50,75,0.03)] dark:border-[#2d343e] dark:bg-[#161a20]", className)}>{children}</div>;
}

function ModelPicker({
    models,
    selectedModels,
    smartPlanning,
    onToggleModel,
    onClearModels,
    onToggleSmartPlanning,
}: Pick<Parameters<typeof ImageWorkbenchView>[0], "models" | "selectedModels" | "smartPlanning" | "onToggleModel" | "onClearModels" | "onToggleSmartPlanning">) {
    const summary = selectedModels.length ? (selectedModels.length === 1 ? selectedModels[0].name : `${selectedModels[0].name} +${selectedModels.length - 1}`) : smartPlanning ? "智能模型" : "选择模型";
    return (
        <Popover
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={
                <div className="w-[min(360px,calc(100vw-48px))] py-1">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold">选择生图模型</p>
                            <p className="mt-1 text-[11px] text-[#8b96a5]">支持多模型同时生成，最多 6 个</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={smartPlanning}
                            className={cn("rounded-full px-3 py-1.5 text-xs font-medium", smartPlanning ? "bg-[#efe8ff] text-[#8d2dff]" : "bg-[#eef1f5] text-[#677385]")}
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
                                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", selected ? "bg-[#f3edff] text-[#5d2294] dark:bg-[#30223f] dark:text-[#d7b2ff]" : "hover:bg-[#f5f7f9] dark:hover:bg-[#252a31]")}
                                    onClick={() => onToggleModel(model)}
                                >
                                    <span className="grid size-8 place-items-center rounded-lg bg-white shadow-sm dark:bg-[#343b44]">
                                        <Orbit className="size-4" />
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{model.name}</span>
                                    <span className={cn("grid size-4 place-items-center rounded border", selected ? "border-[#912dff] bg-[#912dff] text-white" : "border-[#cbd3dd] text-transparent")}>
                                        <Check className="size-3" />
                                    </span>
                                </button>
                            );
                        })}
                        {!models.length ? <p className="py-8 text-center text-xs text-[#95a1b1]">管理后台尚未配置可用的生图模型</p> : null}
                    </div>
                    {!smartPlanning && selectedModels.length ? (
                        <button type="button" className="mt-2 w-full rounded-lg py-2 text-xs text-[#7b8796] hover:bg-[#f4f6f8]" onClick={onClearModels}>
                            清除选择并恢复智能规划
                        </button>
                    ) : null}
                </div>
            }
        >
            <Button icon={<Orbit className="size-4 text-[#8e32ee]" />} className="!h-11 !max-w-[230px] !rounded-xl !border-[#dce3ec] !px-4">
                <span className="truncate text-xs font-medium">{summary}</span>
            </Button>
        </Popover>
    );
}

function GenerationSettings({
    ratio,
    resolution,
    quality,
    count,
    onRatioChange,
    onResolutionChange,
    onPreferenceChange,
}: Pick<Parameters<typeof ImageWorkbenchView>[0], "ratio" | "resolution" | "onRatioChange" | "onResolutionChange" | "onPreferenceChange"> & { quality: ImageQuality; count: number }) {
    return (
        <Popover
            trigger="click"
            placement="topLeft"
            arrow={false}
            content={
                <div className="w-[min(390px,calc(100vw-48px))] py-1">
                    <SettingGroup title="画面比例">
                        {imageWorkbenchRatios.map((item) => (
                            <SettingChip key={item} active={ratio === item} onClick={() => onRatioChange(item)}>
                                {item}
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <SettingGroup title="输出分辨率">
                        {imageWorkbenchResolutions.map((item) => (
                            <SettingChip key={item} active={resolution === item} onClick={() => onResolutionChange(item)}>
                                {item}
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <p className="-mt-2 mb-4 text-[10px] leading-4 text-[#98a5b5]">{imageWorkbenchSizeLabel(ratio, resolution)}。最终是否支持由所选上游模型决定，不支持时会返回真实错误。</p>
                    <SettingGroup title="生成质量">
                        {(["auto", "high", "medium", "low"] as const).map((item) => (
                            <SettingChip key={item} active={quality === item} onClick={() => onPreferenceChange({ quality: item })}>
                                {qualityLabel(item)}
                            </SettingChip>
                        ))}
                    </SettingGroup>
                    <SettingGroup title="生成张数">
                        {[1, 2, 3, 4].map((item) => (
                            <SettingChip key={item} active={count === item} onClick={() => onPreferenceChange({ count: item })}>
                                {item} 张
                            </SettingChip>
                        ))}
                    </SettingGroup>
                </div>
            }
        >
            <Button icon={<Settings2 className="size-4 text-[#8798ae]" />} className="!h-11 !rounded-xl !border-[#dce3ec] !px-4">
                <span className="text-xs font-medium text-[#7d2dde]">{ratio}</span>
                <span className="text-[#c6ced9]">|</span>
                <span className="text-xs font-medium text-[#7d2dde]">{resolution}</span>
                <span className="text-[#c6ced9]">|</span>
                <span className="text-xs font-medium text-[#7d2dde]">{count} 张</span>
            </Button>
        </Popover>
    );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mb-4">
            <p className="mb-2 text-xs font-semibold text-[#46546a] dark:text-[#d7dee7]">{title}</p>
            <div className="flex flex-wrap gap-2">{children}</div>
        </div>
    );
}

function SettingChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            className={cn(
                "h-8 rounded-lg border px-3 text-xs font-medium transition",
                active ? "border-[#9a3cf2] bg-[#f5efff] text-[#812bd0] dark:bg-[#30213e] dark:text-[#d3a4ff]" : "border-[#dfe4eb] text-[#677489] hover:border-[#c49aed] dark:border-[#38404a] dark:text-[#9ba6b4]",
            )}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function RunStatusCard({ run, prompt, onRetry }: { run: CreativeAgentRun; prompt: string; onRetry: () => void }) {
    const failed = run.status === "failed";
    const cancelled = run.status === "cancelled";
    return (
        <div className={cn("flex items-center gap-3 rounded-2xl border p-4", failed ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20" : "border-[#e0e6ef] bg-[#f8fafc] dark:border-[#303742] dark:bg-[#191e24]")}>
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", failed ? "bg-red-100 text-red-500 dark:bg-red-950" : "bg-[#f0eaff] text-[#8f2ff1] dark:bg-[#2c2139]")}>
                {failed || cancelled ? <ImageIcon className="size-5" /> : <Spin size="small" />}
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[#46536a] dark:text-[#d7dee8]">{prompt || "AI 图片生成任务"}</p>
                <p className={cn("mt-1 line-clamp-2 text-[11px]", failed ? "text-red-500" : "text-[#94a1b2]")}>{failed ? run.tasks.find((task) => task.error)?.error || "生成失败" : cancelled ? "任务已取消" : "正在生成图片，请稍候……"}</p>
            </div>
            {failed || cancelled ? (
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
                    重试
                </Button>
            ) : null}
        </div>
    );
}

function qualityLabel(quality: NonNullable<ImageQuality>) {
    return quality === "auto" ? "智能" : quality === "high" ? "高清" : quality === "medium" ? "标准" : "快速";
}

function runPrompt(run: CreativeAgentRun, messages: CreativeMessage[]) {
    return run.prompt || messages.find((message) => message.runId === run.id && message.role === "user")?.content || "";
}

function assetUrl(asset: CreativeAsset) {
    return asset.serverUrl || asset.remoteUrl || "";
}
