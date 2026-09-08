"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Film, FolderOpen, ImageIcon, ListChecks, LoaderCircle, Package, Pencil, Plus, Save, Sparkles, Trash2, Upload, UserRound, X } from "lucide-react";
import { emptyRemake, remakeBusy, remakeSteps, subjectLabels, type RemakeMedia, type RemakeProject, type RemakeSubject, type RemakeJob } from "@/lib/remake-contract";
import { getRemakeProject, remakeAction, saveRemakeProject } from "@/services/api/remake";
import { importCreativeLibraryAsset, uploadCreativeAsset } from "@/services/api/creative";
import { createLibraryAsset } from "@/services/api/library-assets";
import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { RemakeLibraryPicker } from "../remake-library-picker";
import s from "../remake.module.css";

type PickTarget = { kind: "image" | "video"; subjectId?: string };
const media = (a: CreativeAsset): RemakeMedia => ({ assetId: a.id, title: a.title, url: a.serverUrl || "", storageKey: a.storageKey });
const subjectIcons = { person: UserRound, scene: ImageIcon, product: Package };

export default function RemakeEditor({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [project, setProject] = useState<RemakeProject>();
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [tab, setTab] = useState<RemakeSubject["type"]>("person");
    const [subjectId, setSubjectId] = useState("");
    const [shotId, setShotId] = useState("");
    const [preview, setPreview] = useState<"result" | "source">("result");
    const [picker, setPicker] = useState<PickTarget>();
    const [interval, setIntervalValue] = useState(5);
    const [confirm, setConfirm] = useState(false);
    const [assetFilter, setAssetFilter] = useState("all");
    const fileInput = useRef<HTMLInputElement>(null);
    const uploadTarget = useRef<PickTarget>({ kind: "video" });
    const confirmDialog = useRef<HTMLDialogElement>(null);
    const working = useRef(false);
    const state = project?.remake || emptyRemake();
    const active = remakeBusy(state);
    const locked = busy || active;
    const selectedSubject = state.subjects.find((a) => a.id === subjectId);
    const shot = state.shots.find((a) => a.id === shotId) || state.shots[0];

    useEffect(() => {
        let mounted = true;
        void getRemakeProject(id)
            .then((p) => {
                if (mounted) setProject(p);
            })
            .catch((e) => {
                if (mounted) setError(e.message);
            });
        return () => {
            mounted = false;
        };
    }, [id]);
    useEffect(() => {
        if (!active || busy) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const update = async () => {
            try {
                const p = await getRemakeProject(id);
                if (!stopped) setProject(p);
            } catch (e) {
                if (!stopped) setError((e as Error).message);
            } finally {
                if (!stopped) timer = setTimeout(update, 1500);
            }
        };
        timer = setTimeout(update, 1500);
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [active, busy, id]);
    useEffect(() => {
        if (confirm) confirmDialog.current?.showModal();
    }, [confirm]);
    useEffect(() => {
        const guard = (e: BeforeUnloadEvent) => {
            if (dirty) e.preventDefault();
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    }, [dirty]);

    function change(fn: (p: RemakeProject) => RemakeProject) {
        if (locked) return;
        setProject((p) => (p ? fn(p) : p));
        setDirty(true);
        setNotice("");
    }
    async function execute(fn: (p: RemakeProject) => Promise<RemakeProject>, flush = true) {
        if (!project || working.current) return;
        working.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const saved = flush && dirty ? await saveRemakeProject(project) : project;
            setProject(saved);
            setDirty(false);
            const p = await fn(saved);
            setProject(p);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            working.current = false;
            setBusy(false);
        }
    }
    function setStep(step: number) {
        void execute((p) => saveRemakeProject({ ...p, remake: { ...p.remake, step } }));
    }
    function updateSubject(patch: Partial<RemakeSubject>) {
        change((p) => ({ ...p, remake: { ...p.remake, subjects: p.remake.subjects.map((a) => (a.id === subjectId ? { ...a, ...patch } : a)) } }));
    }
    function upload(target: PickTarget) {
        uploadTarget.current = target;
        if (fileInput.current) {
            fileInput.current.accept = target.kind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/*";
            fileInput.current.click();
        }
    }
    async function attach(p: RemakeProject, asset: CreativeAsset, target: PickTarget) {
        if (target.kind === "video") return remakeAction(p, "source", { assetId: asset.id });
        return saveRemakeProject({ ...p, remake: { ...p.remake, subjects: p.remake.subjects.map((a) => (a.id === target.subjectId ? { ...a, replacement: media(asset) } : a)) } });
    }
    function addSubject() {
        const newId = crypto.randomUUID();
        setSubjectId(newId);
        change((p) => ({ ...p, remake: { ...p.remake, subjects: [...p.remake.subjects, { id: newId, type: tab, name: `新${subjectLabels[tab]}`, description: "" }] } }));
    }
    function addShot() {
        const newId = crypto.randomUUID();
        setShotId(newId);
        change((p) => ({
            ...p,
            remake: { ...p.remake, render: undefined, shots: [...p.remake.shots, { id: newId, title: `分镜 ${String(p.remake.shots.length + 1).padStart(2, "0")}`, description: "", dialogue: "", start: 0, duration: 5, subjectIds: [] }] },
        }));
    }
    function updateShot(patch: Partial<NonNullable<typeof shot>>) {
        change((p) => ({ ...p, remake: { ...p.remake, render: undefined, shots: p.remake.shots.map((a) => (a.id === shot?.id ? { ...a, ...patch } : a)) } }));
    }
    async function saveFinal(p: RemakeProject) {
        const url = p.remake.render?.url;
        if (!url) throw new Error("成片尚未完成");
        const storageKey = decodeURIComponent(url.split("/api/reference-assets/")[1]?.split("?")[0] || "");
        await createLibraryAsset({
            kind: "video",
            title: p.title,
            coverUrl: "",
            tags: ["爆款复刻", "成片"],
            source: "爆款复刻",
            metadata: { projectId: p.id },
            data: { url, serverUrl: url, storageKey, width: 0, height: 0, bytes: 0, mimeType: "video/mp4" },
        });
        setNotice("已添加到资源库的视频素材，可在资源库继续管理。");
        return p;
    }

    if (!project)
        return (
            <main className={s.page}>
                <div className={s.scroll}>
                    {error ? <p role="alert">{error}</p> : "正在读取复刻任务…"}
                    <Link href="/remake" className={s.link}>
                        返回任务列表
                    </Link>
                </div>
            </main>
        );
    return (
        <main className={s.page}>
            <header className={`${s.toolbar} ${s.projectHeader}`}>
                <div className={s.projectIdentity}>
                    <Link className={s.link} href="/remake" aria-label="返回任务列表">
                        <ArrowLeft size={18} />
                    </Link>
                    <div className={s.projectName}>
                        <label className={s.titleEdit}>
                            <input aria-label="任务名称" disabled={locked} value={project.title} onChange={(e) => change((p) => ({ ...p, title: e.target.value }))} />
                            <Pencil size={14} aria-hidden="true" />
                        </label>
                        <p className={s.muted} style={{ marginTop: 5 }}>
                            {project.ratio}　|　{state.resolution}p　|　目标语种：{state.language}
                        </p>
                    </div>
                </div>
                <nav className={s.steps} aria-label="复刻阶段">
                    {remakeSteps.map((name, i) => (
                        <button key={name} aria-current={state.step === i ? "step" : undefined} disabled={locked || (i > 0 && !state.analysis) || (i > 1 && !state.shots.length) || (i === 3 && !state.render)} onClick={() => setStep(i)}>
                            {name}
                        </button>
                    ))}
                </nav>
                <div className={`${s.row} ${s.headerActions}`}>
                    <button className={s.button} aria-label={busy ? "处理中" : dirty ? "保存修改" : "已保存"} disabled={locked || !dirty} onClick={() => void execute((p) => saveRemakeProject(p), false)}>
                        <Save size={15} />
                        <span>{busy ? "处理中" : dirty ? "保存修改" : "已保存"}</span>
                    </button>
                    <Link href="/remake" className={s.button} aria-label="任务列表">
                        <ListChecks size={16} />
                        <span>任务列表</span>
                    </Link>
                </div>
            </header>
            {error && (
                <div className={s.notice} role="alert">
                    {error}
                    <button className={s.link} onClick={() => void execute(() => getRemakeProject(id), false)}>
                        刷新状态
                    </button>
                </div>
            )}
            {notice && (
                <div className={s.notice} role="status">
                    {notice}
                </div>
            )}
            {dirty && <div className={s.saveHint}>有未保存修改；生成或切换步骤前会自动保存。</div>}
            {state.step === 0 && (
                <div className={s.scroll}>
                    <div className={s.hero}>
                        <h1>复刻爆款，让好内容持续转化</h1>
                        <p>上传原视频或从资源库选择，开始拆解视频结构。</p>
                        <div className={s.sourceCard}>
                            <div className={s.upload}>
                                {state.source ? (
                                    <div className={s.sourceSummary}>
                                        <Film size={28} />
                                        <div>
                                            <strong>{state.source.title}</strong>
                                            <p className={s.muted}>原视频已就绪，可开始解析或重新选择</p>
                                        </div>
                                        <Check size={18} />
                                    </div>
                                ) : (
                                    <Film size={42} style={{ margin: "0 auto 18px", color: "var(--accent)" }} />
                                )}
                                <div className={s.options}>
                                    <button disabled={locked} className={s.button} onClick={() => upload({ kind: "video" })}>
                                        <Upload size={16} />
                                        {state.source ? "重选视频" : "本地上传"}
                                    </button>
                                    <button disabled={locked} className={s.button} onClick={() => setPicker({ kind: "video" })}>
                                        <FolderOpen size={16} />
                                        资源库选择
                                    </button>
                                </div>
                                <p className={s.muted}>支持 MP4、WebM、MOV，沿用平台视频上传限制。</p>
                            </div>
                            <div className={s.sourceSettings}>
                                <label className={s.field}>
                                    目标语言
                                    <input disabled={locked} value={state.language} onChange={(e) => change((p) => ({ ...p, remake: { ...p.remake, language: e.target.value } }))} />
                                </label>
                                <label className={s.field}>
                                    视频比例
                                    <select disabled={locked} value={project.ratio} onChange={(e) => change((p) => ({ ...p, ratio: e.target.value }))}>
                                        {["9:16", "16:9", "1:1"].map((v) => (
                                            <option key={v}>{v}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className={s.field}>
                                    分辨率
                                    <select disabled={locked} value={state.resolution} onChange={(e) => change((p) => ({ ...p, remake: { ...p.remake, resolution: e.target.value } }))}>
                                        <option value="720">720p</option>
                                        <option value="1080">1080p</option>
                                    </select>
                                </label>
                                <label className={s.field}>
                                    采样间隔（秒）
                                    <input type="number" min={1} disabled={locked} value={interval} onChange={(e) => setIntervalValue(Number(e.target.value))} />
                                </label>
                            </div>
                            {state.source && (
                                <details className={s.sourceDetails}>
                                    <summary>预览原视频</summary>
                                    <video className={s.sourceVideo} src={state.source.url} controls preload="metadata" />
                                </details>
                            )}
                        </div>
                        <p className={s.muted}>使用真实采样画面分析，镜头边界为估计；本版不转录音轨，对白可在分镜中补充。</p>
                        {state.analysis?.error && <p className={s.error}>{state.analysis.error}</p>}
                        {state.analysis?.status === "running" && !state.analysis.taskId && !busy && (
                            <button className={s.button} onClick={() => void execute((p) => remakeAction(p, "cancel-preparation"), false)}>
                                停止画面准备
                            </button>
                        )}
                        <div className={s.options}>
                            <button className={s.primary} disabled={locked || !state.source || !(interval > 0)} onClick={() => void execute((p) => remakeAction(p, "analyze", { interval }))}>
                                {locked ? <LoaderCircle size={17} className={s.spin} /> : <Sparkles size={17} />}
                                {locked ? "正在读取画面 / 分析视频…" : "开始解析"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {state.step === 1 && (
                <>
                    <div className={s.tabs} role="tablist">
                        {Object.entries(subjectLabels).map(([key, label]) => {
                            const Icon = subjectIcons[key as keyof typeof subjectIcons];
                            return (
                                <button
                                    role="tab"
                                    key={key}
                                    aria-selected={key === tab}
                                    onClick={() => {
                                        setTab(key as typeof tab);
                                        setSubjectId("");
                                    }}
                                >
                                    <Icon size={16} />
                                    {label}
                                    <span>{state.subjects.filter((a) => a.type === key).length}</span>
                                </button>
                            );
                        })}
                        <small>
                            已替换 {state.subjects.filter((a) => a.replacement).length} / {state.subjects.length}
                        </small>
                    </div>
                    <div className={`${s.toolbar} ${s.subjectToolbar}`}>
                        <button className={s.button} disabled={locked} onClick={addSubject}>
                            <Plus size={16} />
                            添加{subjectLabels[tab]}
                        </button>
                        <span className={s.muted}>未替换的主体沿用原视频 · 原图为真实采样帧</span>
                    </div>
                    <div className={s.subjectsLayout}>
                        <div className={s.scroll}>
                            <div className={s.subjectGrid}>
                                {state.subjects
                                    .filter((a) => a.type === tab)
                                    .map((a) => (
                                        <article className={s.subjectCard} key={a.id} data-selected={a.id === subjectId}>
                                            <button className={s.subjectOpen} aria-label={`编辑${a.name}`} onClick={() => setSubjectId(a.id)}>
                                                <div className={s.pair}>
                                                    <MediaTile item={a.original} label="原" />
                                                    <MediaTile item={a.replacement} label="新" />
                                                </div>
                                                <h3 className={s.cardName}>{a.name}</h3>
                                            </button>
                                            <div className={s.cardFooter}>
                                                <span className={a.replacement ? s.replaced : s.muted}>
                                                    {a.replacement && <Check size={12} />}
                                                    {a.replacement ? "已配置替换" : "沿用原内容"}
                                                </span>
                                                <button className={s.link} onClick={() => setSubjectId(a.id)}>
                                                    <Pencil size={13} />
                                                    配置替换
                                                </button>
                                            </div>
                                            <JobStatus job={a.job} />
                                        </article>
                                    ))}
                            </div>
                            {!state.subjects.some((a) => a.type === tab) && <p className={s.muted}>暂未识别到此类主体，也可以手动添加。</p>}
                        </div>
                        {selectedSubject && (
                            <aside className={s.editor} aria-label="主体编辑面板">
                                <div className={s.row} style={{ justifyContent: "space-between" }}>
                                    <h2 className={s.title}>主体设定</h2>
                                    <button className={s.link} onClick={() => setSubjectId("")} aria-label="关闭主体编辑">
                                        <X size={17} />
                                    </button>
                                </div>
                                <MediaTile item={selectedSubject.replacement} label="新" />
                                <p className={s.muted}>上传、从资源库选择或 AI 生成新的{subjectLabels[selectedSubject.type]}。未配置时仍沿用原视频主体。</p>
                                <label className={s.field}>
                                    名称
                                    <input disabled={locked} value={selectedSubject.name} onChange={(e) => updateSubject({ name: e.target.value })} />
                                </label>
                                <div className={s.row}>
                                    <button disabled={locked} className={s.button} onClick={() => upload({ kind: "image", subjectId })}>
                                        <Upload size={14} />
                                        本地上传
                                    </button>
                                    <button disabled={locked} className={s.button} onClick={() => setPicker({ kind: "image", subjectId })}>
                                        资源库选择
                                    </button>
                                </div>
                                <label className={s.field}>
                                    主体描述
                                    <textarea disabled={locked} rows={5} value={selectedSubject.description} onChange={(e) => updateSubject({ description: e.target.value })} />
                                </label>
                                <button className={s.primary} disabled={locked || !selectedSubject.description.trim()} onClick={() => void execute((p) => remakeAction(p, "generate", { targetId: subjectId }))}>
                                    <Sparkles size={16} />
                                    生成主体图片
                                </button>
                                <JobStatus job={selectedSubject.job} />
                                {!!selectedSubject.job?.results.length && (
                                    <div className={s.pickerGrid}>
                                        {selectedSubject.job.results.map((r, i) => (
                                            <button key={r.assetId} disabled={locked} aria-pressed={selectedSubject.replacement?.assetId === r.assetId} onClick={() => updateSubject({ replacement: r })}>
                                                <img src={imagePreviewUrl(r.url, 320)} alt={r.title} />
                                                <span>
                                                    版本 {i + 1}
                                                    {selectedSubject.replacement?.assetId === r.assetId ? " · 当前" : ""}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className={s.row}>
                                    <button disabled={locked || !selectedSubject.replacement} className={s.link} onClick={() => updateSubject({ replacement: undefined })}>
                                        恢复原主体
                                    </button>
                                    <button
                                        disabled={locked}
                                        className={s.link}
                                        onClick={() => {
                                            change((p) => ({
                                                ...p,
                                                remake: { ...p.remake, subjects: p.remake.subjects.filter((a) => a.id !== subjectId), shots: p.remake.shots.map((a) => ({ ...a, subjectIds: a.subjectIds.filter((v) => v !== subjectId) })) },
                                            }));
                                            setSubjectId("");
                                        }}
                                    >
                                        <Trash2 size={14} />
                                        删除
                                    </button>
                                </div>
                            </aside>
                        )}
                    </div>
                    <footer className={s.footer} style={{ justifyContent: "center" }}>
                        <button disabled={locked || !state.shots.length} className={s.primary} onClick={() => setConfirm(true)}>
                            分镜解析
                            <ChevronRight size={16} />
                        </button>
                    </footer>
                </>
            )}
            {state.step === 2 && (
                <>
                    <div className={s.workspace}>
                        <aside className={s.assetRail}>
                            <div className={s.assetFilters} aria-label="参考素材分类">
                                {["all", "person", "scene", "product"].map((key) => (
                                    <button key={key} aria-pressed={assetFilter === key} onClick={() => setAssetFilter(key)}>
                                        {key === "all" ? "全部" : key === "product" ? "道具" : subjectLabels[key as keyof typeof subjectLabels]}
                                    </button>
                                ))}
                            </div>
                            <p className={s.railHint}>本镜头参考 · 已选 {shot?.subjectIds.length || 0} 项</p>
                            {Object.entries(subjectLabels)
                                .filter(([key]) => assetFilter === "all" || key === assetFilter)
                                .map(([key, label]) => (
                                    <section key={key}>
                                        <h3>
                                            {label}
                                            <span>{state.subjects.filter((a) => a.type === key).length}</span>
                                        </h3>
                                        {state.subjects
                                            .filter((a) => a.type === key)
                                            .map((a) => (
                                                <button
                                                    className={s.assetOption}
                                                    key={a.id}
                                                    disabled={locked || !shot}
                                                    aria-pressed={shot?.subjectIds.includes(a.id)}
                                                    onClick={() => updateShot({ subjectIds: shot!.subjectIds.includes(a.id) ? shot!.subjectIds.filter((v) => v !== a.id) : [...shot!.subjectIds, a.id] })}
                                                >
                                                    <div className={s.assetVisual}>
                                                        {a.replacement || a.original ? <img src={imagePreviewUrl((a.replacement || a.original)!.url, 320)} alt={a.name} /> : <ImageIcon size={24} />}
                                                        <span className={s.selectionMark}>{shot?.subjectIds.includes(a.id) ? <Check size={13} /> : <Plus size={13} />}</span>
                                                    </div>
                                                    <strong>{a.name}</strong>
                                                    <div className={s.muted}>
                                                        {shot?.subjectIds.includes(a.id) ? "已引用 · " : "未引用 · "}
                                                        {a.replacement ? "替换主体" : "原内容"}
                                                    </div>
                                                </button>
                                            ))}
                                    </section>
                                ))}
                        </aside>
                        <section className={s.shotEditor}>
                            {shot ? (
                                <>
                                    <div className={s.row} style={{ justifyContent: "space-between" }}>
                                        <div>
                                            <h2>分镜 {String(state.shots.indexOf(shot) + 1).padStart(2, "0")}</h2>
                                            <p className={s.muted}>{dirty ? "有修改 · 生成前自动保存" : "内容已保存"}</p>
                                        </div>
                                        <button className={s.primary} disabled={locked || state.shots.every((a) => a.selected)} onClick={() => void execute((p) => remakeAction(p, "generate-all"))}>
                                            <Sparkles size={15} />
                                            生成全部分镜
                                        </button>
                                    </div>
                                    <div className={s.shotForm}>
                                        <div className={s.referenceHeading}>
                                            <span>本镜头参考主体</span>
                                            <small>{shot.subjectIds.length} 项</small>
                                        </div>
                                        <div className={s.referenceChips}>
                                            {state.subjects
                                                .filter((a) => shot.subjectIds.includes(a.id))
                                                .map((a) => (
                                                    <span key={a.id} className={s.referenceChip}>
                                                        {(a.replacement || a.original) && <img src={imagePreviewUrl((a.replacement || a.original)!.url, 160)} alt="" />}
                                                        <span>{a.name}</span>
                                                        {a.replacement && <Check size={12} />}
                                                    </span>
                                                ))}
                                            {!shot.subjectIds.length && <p className={s.muted}>尚未选择参考主体，点击素材卡片即可引用。</p>}
                                        </div>
                                        <label className={s.field}>
                                            分镜标题
                                            <input disabled={locked} value={shot.title} onChange={(e) => updateShot({ title: e.target.value })} />
                                        </label>
                                        <label className={s.field}>
                                            分镜具体动作描述
                                            <textarea disabled={locked} rows={7} value={shot.description} onChange={(e) => updateShot({ description: e.target.value })} />
                                        </label>
                                        <p className={s.referenceHelp}>生成时会按已选替换主体自动改写描述，规划完成后回填；未选中的商品不会替换。</p>
                                        <label className={s.field}>
                                            对白 / 旁白
                                            <textarea disabled={locked} rows={3} value={shot.dialogue} placeholder="可填写需要生成的对白，未填写不推测原视频台词" onChange={(e) => updateShot({ dialogue: e.target.value })} />
                                        </label>
                                        <div className={s.row}>
                                            <label className={s.field}>
                                                目标时长（秒）
                                                <input disabled={locked} type="number" min={1} value={shot.duration} onChange={(e) => updateShot({ duration: Number(e.target.value) })} />
                                            </label>
                                            <span className={s.muted}>Agent 自动选择模型，实际时长遵循模型能力。</span>
                                        </div>
                                        <div className={s.row}>
                                            <button className={s.primary} disabled={locked || !shot.description.trim()} onClick={() => void execute((p) => remakeAction(p, "generate", { targetId: shot.id }))}>
                                                <Sparkles size={16} />
                                                {shot.selected ? "生成新版本" : "生成此分镜"}
                                            </button>
                                            <button className={s.button} disabled={locked} onClick={() => change((p) => ({ ...p, remake: { ...p.remake, render: undefined, shots: p.remake.shots.filter((a) => a.id !== shot.id) } }))}>
                                                <Trash2 size={14} />
                                                删除分镜
                                            </button>
                                        </div>
                                        <JobStatus job={shot.job} />
                                    </div>
                                </>
                            ) : (
                                <p className={s.muted}>添加一个分镜开始编辑。</p>
                            )}
                        </section>
                        <section className={s.preview}>
                            <div className={s.previewTabs}>
                                <button aria-pressed={preview === "result"} onClick={() => setPreview("result")}>
                                    分镜生成
                                </button>
                                <button aria-pressed={preview === "source"} onClick={() => setPreview("source")}>
                                    原视频
                                </button>
                            </div>
                            <div className={s.player}>
                                {preview === "source" && state.source ? (
                                    <video
                                        key={`${state.source.url}-${shot?.id}`}
                                        src={state.source.url}
                                        controls
                                        preload="metadata"
                                        onLoadedMetadata={(e) => {
                                            e.currentTarget.currentTime = shot?.start || 0;
                                        }}
                                    />
                                ) : shot?.selected ? (
                                    <video key={shot.selected.url} src={shot.selected.url} controls preload="metadata" />
                                ) : (
                                    <div>
                                        <Film size={32} style={{ margin: "0 auto 15px" }} />
                                        {shot?.job?.status === "running" || shot?.job?.status === "pending" ? "正在生成" : shot?.job?.status === "error" ? "生成失败" : "待生成"}
                                    </div>
                                )}
                            </div>
                            <JobStatus job={shot?.job} />
                            {shot?.job?.results.length ? (
                                <>
                                    <p className={s.muted}>生成版本 · 点击设为当前分镜</p>
                                    <div className={s.pickerGrid}>
                                        {shot.job.results.map((r, i) => (
                                            <button disabled={locked} aria-pressed={shot.selected?.assetId === r.assetId} key={r.assetId} onClick={() => updateShot({ selected: r })}>
                                                <video src={r.url} muted preload="metadata" />
                                                <span>
                                                    版本 {i + 1} {shot.selected?.assetId === r.assetId ? "✓ 当前" : ""}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : null}
                        </section>
                        <section className={s.filmstrip}>
                            <div className={s.row} style={{ justifyContent: "space-between" }}>
                                <strong>
                                    {state.shots.length} 个分镜 <span className={s.muted}>· 已选定 {state.shots.filter((a) => a.selected).length} 个结果</span>
                                </strong>
                                <button className={s.link} disabled={locked} onClick={addShot}>
                                    <Plus size={14} />
                                    新增分镜
                                </button>
                            </div>
                            <div className={s.stripScroll}>
                                <div className={s.stripItems}>
                                    {state.shots.map((a, i) => (
                                        <button className={s.shotThumb} aria-pressed={a.id === shot?.id} title={a.title} key={a.id} onClick={() => setShotId(a.id)}>
                                            <div>{a.selected ? <video src={a.selected.url} muted preload="metadata" /> : a.job?.status === "running" ? <LoaderCircle className={s.spin} size={20} /> : <Film size={20} />}</div>
                                            <small>
                                                <span>分镜 {String(i + 1).padStart(2, "0")}</span>
                                                <span>{a.duration}s</span>
                                            </small>
                                            <span className={s.shotCaption}>{a.title}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </div>
                    <footer className={s.footer}>
                        <span className={s.footerHint}>选定全部分镜结果后，即可合成视频成片。</span>
                        <button className={s.button} disabled={locked} onClick={() => setStep(1)}>
                            返回主体设定
                        </button>
                        <button className={s.primary} disabled={locked || !state.shots.length || state.shots.some((a) => !a.selected)} onClick={() => void execute((p) => remakeAction(p, "render"))}>
                            生成视频成片
                            <ChevronRight size={16} />
                        </button>
                    </footer>
                </>
            )}
            {state.step === 3 && (
                <>
                    <div className={s.scroll}>
                        <div className={s.finalHeading}>
                            <h2>你的复刻成片</h2>
                            <p className={s.muted}>对照原视频检查效果，满意后下载或添加到资源库。</p>
                        </div>
                        <div className={s.finalGrid}>
                            <section>
                                <h2 className={s.cardName}>原视频</h2>
                                <div className={s.player}>
                                    <video src={state.source?.url} controls preload="metadata" />
                                </div>
                            </section>
                            <section>
                                <h2 className={s.cardName}>复刻成片</h2>
                                <div className={s.player}>
                                    {state.render?.url ? (
                                        <video src={state.render.url} controls preload="metadata" />
                                    ) : (
                                        <div>
                                            <Film size={32} style={{ margin: "0 auto 16px" }} />
                                            {["pending", "running"].includes(state.render?.status || "") ? "正在合成成片…" : "成片尚未就绪"}
                                        </div>
                                    )}
                                </div>
                                {state.render?.error && <p className={s.error}>{state.render.error}</p>}
                            </section>
                        </div>
                    </div>
                    <footer className={s.footer}>
                        <button disabled={locked} className={s.button} onClick={() => setStep(2)}>
                            返回分镜
                        </button>
                        <button disabled={locked || !state.render?.url} className={s.primary} onClick={() => void execute(saveFinal)}>
                            <FolderOpen size={16} />
                            上传资源库
                        </button>
                        {state.render?.url && (
                            <a className={s.button} href={`${state.render.url}?download=1`} download>
                                下载成片
                            </a>
                        )}
                    </footer>
                </>
            )}
            <input
                hidden
                ref={fileInput}
                type="file"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void execute(async (p) => attach(p, await uploadCreativeAsset(p.creativeConversationId!, file), uploadTarget.current));
                }}
            />
            {picker && (
                <RemakeLibraryPicker
                    kind={picker.kind}
                    onClose={() => setPicker(undefined)}
                    onPick={async (asset) => {
                        await execute(async (p) => attach(p, await importCreativeLibraryAsset(p.creativeConversationId!, asset.id), picker));
                    }}
                />
            )}
            {confirm && (
                <dialog ref={confirmDialog} className={s.modal} onCancel={() => setConfirm(false)} aria-label="确认主体替换情况">
                    <h2 className={s.title}>确认主体替换情况</h2>
                    <p style={{ margin: "18px 0", lineHeight: 1.8 }}>已替换 {state.subjects.filter((a) => a.replacement).length} 个主体，其余沿用原视频内容。进入分镜后可继续编辑动作描述、对白与参考主体。</p>
                    <div className={s.row} style={{ justifyContent: "flex-end" }}>
                        <button className={s.button} onClick={() => setConfirm(false)}>
                            继续调整
                        </button>
                        <button
                            className={s.primary}
                            onClick={() => {
                                setConfirm(false);
                                setStep(2);
                            }}
                        >
                            <Check size={15} />
                            确认并进入分镜
                        </button>
                    </div>
                </dialog>
            )}
        </main>
    );
}

function MediaTile({ item, label }: { item?: RemakeMedia; label?: string }) {
    return (
        <div className={s.media}>
            {item ? (
                <img src={imagePreviewUrl(item.url, 640)} alt={item.title} />
            ) : (
                <div style={{ textAlign: "center", fontSize: 12 }}>
                    <ImageIcon size={24} style={{ margin: "0 auto 9px", opacity: 0.5 }} />
                    暂未配置
                </div>
            )}
            {label && <span className={`${s.badge} ${label === "新" ? s.badgeNew : ""}`}>{label}</span>}
        </div>
    );
}
function JobStatus({ job }: { job?: RemakeJob }) {
    if (!job) return null;
    return (
        <div role="status">
            {["pending", "running"].includes(job.status) && (
                <p className={s.status}>
                    <LoaderCircle size={15} className={s.spin} />
                    {job.status === "pending" ? "提交待确认" : "规划 / 生成中"}
                </p>
            )}
            {job.error && <p className={s.error}>{job.error}</p>}
            {job.status === "success" && <p className={s.muted}>生成完成</p>}
        </div>
    );
}
