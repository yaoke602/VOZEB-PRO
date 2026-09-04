"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Skeleton, Tag } from "antd";
import { Sparkles } from "lucide-react";
import { useUserStore } from "@/stores/use-user-store";
import type { QianchuanAsk, QianchuanQuery } from "@/lib/qianchuan-contract";
import { askQianchuanData, getLatestQianchuanAnalysis } from "@/services/api/qianchuan";
import styles from "./analytics.module.css";

export default function AnalysisPanel({ query, demo, onApply }: { query: QianchuanQuery; demo: boolean; onApply: (q: QianchuanQuery) => void }) {
    const userId = useUserStore((s) => s.user?.id),
        cache = useQueryClient();
    const [question, setQuestion] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const inflight = useRef(false),
        retry = useRef<QianchuanAsk | null>(null);
    const key = ["qianchuan-analysis", userId, query.accountId];
    const history = useQuery({ queryKey: key, queryFn: ({ signal }) => getLatestQianchuanAnalysis(query.accountId, signal), enabled: Boolean(userId && query.accountId && !demo), retry: false });
    async function submit() {
        if (inflight.current || !question.trim() || !query.accountId || demo) return;
        inflight.current = true;
        setBusy(true);
        setError("");
        const same = retry.current?.question === question.trim() && JSON.stringify(retry.current.query) === JSON.stringify(query);
        const input = same ? retry.current! : { question: question.trim(), query: { ...query }, requestId: crypto.randomUUID() };
        retry.current = input;
        try {
            const answer = await askQianchuanData(input);
            await cache.cancelQueries({ queryKey: key, exact: true });
            cache.setQueryData(key, answer);
            retry.current = null;
        } catch (e) {
            setError(e instanceof Error ? e.message : "查数失败");
        } finally {
            inflight.current = false;
            setBusy(false);
        }
    }
    const result = history.data;
    return (
        <aside className={styles.card} aria-label="AI 查数助手">
            <div className={styles.cardHeader}>
                <h2>AI 查数</h2>
                <Tag>只读分析</Tag>
            </div>
            <div className={styles.aiBody}>
                <div className={styles.aiIcon}>
                    <Sparkles size={23} />
                </div>
                <h3>用一句话，找到所需数据</h3>
                <p>{demo ? "演示模式不调用模型；授权并同步真实账户后可使用。" : "使用后台默认文本模型，按现有文本计费。仅分析当前账户的已同步数据，不修改投放。"}</p>
                <div className="flex flex-wrap gap-2">
                    {["按消耗列出当前日期的全域计划", "汇总当前日期的标准推广消耗和支付金额", "查询名称包含衬衫的商品"].map((text) => (
                        <Button key={text} size="small" className="!h-auto !whitespace-normal !text-left" disabled={busy || demo || !query.accountId} onClick={() => setQuestion(text)}>
                            {text}
                        </Button>
                    ))}
                </div>
                <Input.TextArea
                    aria-label="千川查数问题"
                    placeholder="例如：当前日期消耗最高的全域计划是什么？"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    disabled={busy || demo || !query.accountId}
                    maxLength={4000}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                />
                <Button type="primary" block loading={busy} disabled={!question.trim() || demo || !query.accountId} onClick={() => void submit()}>
                    {busy ? "正在查询与分析" : "查询并分析"}
                </Button>
                <p>一次查询一个分类与日期区间。未同步区间会提示同步；缺失指标不会补成零。</p>
                {(error || history.error) && <Alert type="warning" showIcon title={error || history.error?.message} />}
                {error && !busy && (
                    <Button
                        size="small"
                        disabled={!question.trim()}
                        onClick={() => {
                            retry.current = null;
                            void submit();
                        }}
                    >
                        重新提问（将重新计费）
                    </Button>
                )}
                {history.isFetching && !result && !demo && query.accountId && <Skeleton active paragraph={{ rows: 3 }} />}
                {result && (
                    <div className={styles.analysisAnswer} aria-live="polite">
                        <div className={styles.recordMeta}>最近一次查询 · {new Date(result.createdAt).toLocaleString("zh-CN")}</div>
                        <h3>{result.question}</h3>
                        <div className="whitespace-pre-wrap break-words">{result.answer}</div>
                        <p>
                            账户：{result.query.accountId}
                            <br />
                            {result.query.startDate} 至 {result.query.endDate}
                        </p>
                        {result.source && (
                            <>
                                <p>
                                    命中 {result.source.total} 条 · 模型读取 {result.source.returned} 条明细
                                    <br />
                                    同步时间：{result.source.lastSyncedAt ? new Date(result.source.lastSyncedAt).toLocaleString("zh-CN") : "尚未同步"}
                                </p>
                                {result.source.warning && <Alert type="warning" title={result.source.warning} />}
                            </>
                        )}
                        <Button size="small" disabled={busy} onClick={() => onApply(result.query)}>
                            应用查询条件
                        </Button>
                        <p>AI 解读仅供参考，请结合原始报表核对。</p>
                    </div>
                )}
            </div>
        </aside>
    );
}
