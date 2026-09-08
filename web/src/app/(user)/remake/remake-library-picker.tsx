"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { listLibraryAssetPage } from "@/services/api/library-assets";
import type { LibraryAssetPage } from "@/services/api/library-assets";
import type { Asset } from "@/lib/library-asset-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import s from "./remake.module.css";

export function RemakeLibraryPicker({ kind, onPick, onClose }: { kind: "image" | "video"; onPick: (asset: Asset) => Promise<void>; onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [page, setPage] = useState(1);
    const [keyword, setKeyword] = useState("");
    const [search, setSearch] = useState("");
    const [data, setData] = useState<LibraryAssetPage>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        dialog.current?.showModal();
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        setData(undefined);
        void listLibraryAssetPage({ kind, page, pageSize: 12, keyword: search }, controller.signal)
            .then(setData)
            .catch((e) => {
                if (!controller.signal.aborted) setError(e.message);
            });
        return () => controller.abort();
    }, [kind, page, search]);
    return (
        <dialog
            ref={dialog}
            className={s.modal}
            onCancel={(e) => {
                e.preventDefault();
                if (!busy) onClose();
            }}
            aria-label="从资源库选择素材"
        >
            <div className={s.row} style={{ justifyContent: "space-between" }}>
                <h2 className={s.title}>资源库 · {kind === "image" ? "图片" : "视频"}</h2>
                <button disabled={busy} className={s.button} onClick={onClose} aria-label="关闭资源库">
                    <X size={16} />
                </button>
            </div>
            <form
                className={s.row}
                style={{ marginTop: 20 }}
                onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setSearch(keyword);
                }}
            >
                <input className={s.input} style={{ flex: 1 }} placeholder="搜索素材名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <button className={s.button}>搜索</button>
            </form>
            {error && <p className={s.error}>{error}</p>}
            <div className={s.pickerGrid}>
                {data?.assets.map((asset) => (
                    <button
                        disabled={busy}
                        key={asset.id}
                        onClick={() => {
                            setBusy(true);
                            void onPick(asset)
                                .then(onClose)
                                .catch((e) => setError(e.message))
                                .finally(() => setBusy(false));
                        }}
                    >
                        {asset.kind === "image" ? (
                            <img src={imagePreviewUrl(asset.data.serverUrl || asset.data.dataUrl, 320)} alt={asset.title} />
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.serverUrl || asset.data.url} preload="metadata" muted />
                        ) : null}
                        <span>{asset.title}</span>
                    </button>
                ))}
            </div>
            {!data ? <p>正在加载…</p> : !data.total ? <p className={s.muted}>没有匹配的素材，也可以关闭后本地上传。</p> : null}
            <div className={s.row} style={{ justifyContent: "space-between" }}>
                <button className={s.button} disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
                    上一页
                </button>
                <small>
                    {page} / {Math.max(1, Math.ceil((data?.total || 0) / 12))}
                </small>
                <button className={s.button} disabled={busy || !data || page * 12 >= data.total} onClick={() => setPage(page + 1)}>
                    下一页
                </button>
            </div>
        </dialog>
    );
}
