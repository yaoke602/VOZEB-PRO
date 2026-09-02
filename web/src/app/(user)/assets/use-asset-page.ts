"use client";

import { useCallback, useEffect, useState } from "react";

import type { Asset, AssetKind } from "@/lib/library-asset-contract";
import { listLibraryAssetPage } from "@/services/api/library-assets";

export function useAssetPage(input: { userId: string; page: number; pageSize: number; kind: AssetKind | "all"; keyword: string }) {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reloadToken, setReloadToken] = useState(0);
    const [keyword, setKeyword] = useState(input.keyword.trim());
    const queryKey = `${input.userId}\u0000${input.page}\u0000${input.pageSize}\u0000${input.kind}\u0000${keyword}`;
    const [loadedQueryKey, setLoadedQueryKey] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => setKeyword(input.keyword.trim()), 220);
        return () => clearTimeout(timer);
    }, [input.keyword]);

    useEffect(() => {
        if (!input.userId) {
            setAssets([]);
            setTotal(0);
            setError("");
            setLoading(false);
            setLoadedQueryKey(queryKey);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void listLibraryAssetPage(
            {
                page: input.page,
                pageSize: input.pageSize,
                kind: input.kind === "all" ? undefined : input.kind,
                keyword,
            },
            controller.signal,
        )
            .then((result) => {
                if (controller.signal.aborted) return;
                setAssets(result.assets);
                setTotal(result.total);
                setLoadedQueryKey(queryKey);
            })
            .catch((reason) => {
                if (reason instanceof DOMException && reason.name === "AbortError") return;
                setAssets([]);
                setTotal(0);
                setError(reason instanceof Error ? reason.message : "素材加载失败");
                setLoadedQueryKey(queryKey);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [input.kind, input.page, input.pageSize, input.userId, keyword, queryKey, reloadToken]);

    const reload = useCallback(() => setReloadToken((value) => value + 1), []);
    const current = loadedQueryKey === queryKey;
    return { assets: current ? assets : [], total: current ? total : 0, loading: Boolean(input.userId) && (!current || loading), error: current ? error : "", reload };
}
