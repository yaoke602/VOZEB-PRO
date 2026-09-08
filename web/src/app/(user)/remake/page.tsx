"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Film, Plus, RefreshCw } from "lucide-react";
import { createRemakeProject, listRemakeProjects } from "@/services/api/remake";
import type { DramaProjectSummaryPage } from "@/lib/drama-project-contract";
import s from "./remake.module.css";

export default function RemakePage() {
    const router = useRouter();
    const [page, setPage] = useState(1);
    const [data, setData] = useState<DramaProjectSummaryPage>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        void listRemakeProjects(page)
            .then((result) => {
                if (active) setData(result);
            })
            .catch((e) => {
                if (active) setError(e.message);
            });
        return () => {
            active = false;
        };
    }, [page]);
    async function create() {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            const p = await createRemakeProject("未命名复刻任务");
            router.push(`/remake/${p.id}`);
        } catch (e) {
            setError((e as Error).message);
            setBusy(false);
        }
    }
    return (
        <main className={s.page}>
            <div className={s.scroll}>
                <div className={s.hero}>
                    <RefreshCw size={35} style={{ margin: "auto", color: "var(--accent)" }} />
                    <h1>复刻爆款，让好内容持续转化</h1>
                    <p>导入原视频，替换角色、场景或商品，按分镜生成你的视频。</p>
                    <div className={s.options}>
                        <button className={s.primary} disabled={busy} onClick={() => void create()}>
                            <Plus size={16} />
                            {busy ? "正在创建…" : "新建复刻任务"}
                        </button>
                    </div>
                    <div className={s.process} aria-label="复刻流程">
                        {["导入原视频", "设定替换主体", "编辑与生成分镜", "导出视频成片"].map((label, i) => (
                            <span key={label}>
                                <b>{i + 1}</b>
                                {label}
                                {i < 3 && <ChevronRight size={13} />}
                            </span>
                        ))}
                    </div>
                </div>
                {error && (
                    <p role="alert" className={s.error}>
                        {error}
                    </p>
                )}
                <div style={{ maxWidth: 1100, margin: "auto" }}>
                    <div className={s.listHeading}>
                        <h2 className={s.title}>我的复刻任务</h2>
                        <span className={s.muted}>{data ? `共 ${data.total} 个任务` : "读取中"} · 点击继续编辑</span>
                    </div>
                    <div className={s.tasks}>
                        {!data ? (
                            <p className={s.muted}>正在读取任务…</p>
                        ) : !data.items.length ? (
                            <p className={s.muted}>还没有复刻任务，从一条原视频开始。</p>
                        ) : (
                            data.items.map((p) => (
                                <button className={s.task} key={p.id} onClick={() => router.push(`/remake/${p.id}`)}>
                                    <span className={s.taskIcon}>
                                        <Film size={23} />
                                    </span>
                                    <div>
                                        <strong>{p.title}</strong>
                                        <p className={s.muted}>
                                            {p.ratio} · {new Date(p.updatedAt).toLocaleString("zh-CN")}
                                        </p>
                                    </div>
                                    <ArrowRight size={18} />
                                </button>
                            ))
                        )}
                    </div>
                    <div className={s.options}>
                        <button className={s.button} disabled={page === 1} onClick={() => setPage(page - 1)}>
                            上一页
                        </button>
                        <span>{page}</span>
                        <button className={s.button} disabled={!data || page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
                            下一页
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
