"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Pagination, Select, Skeleton, Tag } from "antd";
import { BarChart3, CircleCheck, Database, ImageIcon, LockKeyhole, Package, RefreshCw, Settings2, Shirt, ShoppingBag, Sparkles, Video, Wallet } from "lucide-react";
import dayjs from "dayjs";
import { useUserStore } from "@/stores/use-user-store";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { emptyQianchuanMetrics, qianchuanKinds, type QianchuanKind, type QianchuanPage, type QianchuanQuery, type QianchuanRecord, type QianchuanSettings } from "@/lib/qianchuan-contract";
import { authorizeQianchuan, disconnectQianchuanAccount, getQianchuanData, getQianchuanStatus, refreshQianchuanAccounts, saveQianchuanConfig, syncQianchuanData } from "@/services/api/qianchuan";
import { qianchuanDemoPage } from "./demo-data";
import styles from "./analytics.module.css";

type Tab = "overview" | "materials" | "products" | "plans";
const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "数据概览" },
    { id: "materials", label: "素材分析" },
    { id: "products", label: "商品分析" },
    { id: "plans", label: "计划报表" },
];
const kindNames: Record<QianchuanKind, string> = { overview: "标准推广账户日报", plans: "全域商品推广计划", products: "可推广商品", images: "图片素材", videos: "视频素材" };
const value = (n: number | null | undefined, money = false) => (n === null || n === undefined ? "—" : `${money ? "¥" : ""}${n.toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: money ? 2 : 0 })}`);

export default function AnalyticsPage() {
    const user = useUserStore((s) => s.user),
        userId = user?.id || "";
    const canConfigure = hasAdminPermission(user, "system.manage");
    const { message, modal } = App.useApp(),
        cache = useQueryClient();
    const [tab, setTab] = useState<Tab>("overview"),
        [mediaKind, setMediaKind] = useState<"images" | "videos">("videos");
    const [selectedAccount, setSelectedAccount] = useState(""),
        [keyword, setKeyword] = useState(""),
        [page, setPage] = useState(1),
        [sort, setSort] = useState<QianchuanQuery["sort"]>("name");
    const [dates, setDates] = useState([dayjs().subtract(6, "day").format("YYYY-MM-DD"), dayjs().format("YYYY-MM-DD")]);
    const [accountModal, setAccountModal] = useState(false),
        [settingsModal, setSettingsModal] = useState(false),
        [detail, setDetail] = useState<QianchuanRecord | null>(null);
    const [busy, setBusy] = useState(""),
        [authError, setAuthError] = useState("");
    const [form] = Form.useForm<Omit<QianchuanSettings, "hasSecret"> & { secret: string }>();
    const statusQuery = useQuery({ queryKey: ["qianchuan-status", userId], queryFn: ({ signal }) => getQianchuanStatus(signal), enabled: Boolean(userId), retry: false });
    const status = statusQuery.data;
    const accountId = status?.accounts.find((a) => a.id === selectedAccount)?.id || status?.accounts[0]?.id || "";
    const demo = Boolean(status && !status.accounts.length && !status.connectionCount);
    const kind: QianchuanKind = tab === "materials" ? mediaKind : tab === "overview" ? "plans" : tab;
    const query: QianchuanQuery = { accountId, kind, startDate: dates[0], endDate: dates[1], page, pageSize: 10, keyword, sort };
    const overviewQuery: QianchuanQuery = { ...query, kind: "overview", keyword: "", page: 1 };
    const listQuery = useQuery({ queryKey: ["qianchuan-data", userId, query], queryFn: ({ signal }) => getQianchuanData(query, signal), enabled: Boolean(accountId), retry: false });
    const overview = useQuery({ queryKey: ["qianchuan-data", userId, overviewQuery], queryFn: ({ signal }) => getQianchuanData(overviewQuery, signal), enabled: Boolean(accountId), retry: false });
    const demoList = demo ? qianchuanDemoPage(query) : undefined;
    const demoOverview = demo ? qianchuanDemoPage(overviewQuery) : undefined;
    const data = demo ? demoList : listQuery.data,
        overviewData = demo ? demoOverview : overview.data;
    const metrics = overviewData?.summary || emptyQianchuanMetrics;
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.has("authorizationError")) setAuthError(params.get("authorizationError") || "");
        if (params.has("authorized") || params.has("authorizationError")) window.history.replaceState(null, "", "/analytics");
    }, []);
    async function perform(label: string, action: () => Promise<unknown>) {
        if (busy) return;
        setBusy(label);
        try {
            await action();
        } catch (error) {
            void message.error(error instanceof Error ? error.message : "操作失败");
        } finally {
            setBusy("");
        }
    }
    async function sync() {
        if (demo) {
            setAccountModal(true);
            return;
        }
        await perform("同步数据", async () => {
            const failures: string[] = [];
            // Explicit manual synchronization, not automatic fetch-on-tab-switch.
            for (const resource of qianchuanKinds) {
                setBusy(`正在同步${kindNames[resource]}`);
                try {
                    await syncQianchuanData({ ...query, kind: resource });
                } catch (error) {
                    failures.push(`${kindNames[resource]}：${error instanceof Error ? error.message : "同步失败"}`);
                }
            }
            await cache.invalidateQueries({ queryKey: ["qianchuan-data", userId] });
            if (failures.length)
                modal.warning({
                    title: "部分数据未能同步",
                    content: (
                        <div className="space-y-2">
                            {failures.map((f) => (
                                <p key={f}>{f}</p>
                            ))}
                            <p>已保留这些分区上次成功的数据。</p>
                        </div>
                    ),
                });
            else void message.success("同步完成");
        });
    }
    function openSettings() {
        form.setFieldsValue(status?.settings ? { ...status.settings, secret: "" } : { appId: "", secret: "", callbackUrl: `${window.location.origin}/api/qianchuan/callback`, requestTimeoutSeconds: 60, syncTimeoutSeconds: 600 });
        setSettingsModal(true);
    }
    const errors = [authError, statusQuery.error?.message, listQuery.error?.message, overview.error?.message, data?.error, overviewData?.error].filter((v, i, a) => v && a.indexOf(v) === i);
    return (
        <div className={styles.page}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <div>
                        <div className={styles.heading}>
                            <h1>千川数据分析</h1>
                            {demo ? <Tag color="orange">演示数据</Tag> : status ? <Tag color="green">真实账户</Tag> : null}
                        </div>
                        <p className={styles.subtitle}>连接商品、素材与投放表现，让每一次创作都有数据可循。</p>
                    </div>
                    <div className={styles.actions}>
                        {canConfigure && (
                            <Button icon={<Settings2 size={15} />} onClick={openSettings}>
                                应用配置
                            </Button>
                        )}
                        <Button onClick={() => setAccountModal(true)} disabled={!status}>
                            授权账户
                        </Button>
                        <Button type="primary" icon={<RefreshCw size={15} />} loading={Boolean(busy) && busy.includes("同步")} disabled={Boolean(busy) || !status || (!demo && !accountId)} onClick={() => void sync()}>
                            {busy.includes("同步") ? busy : "同步数据"}
                        </Button>
                    </div>
                </div>
                <div className={styles.tabs} role="tablist" aria-label="千川分析分类">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={tab === t.id}
                            className={styles.tab}
                            onClick={() => {
                                setTab(t.id);
                                setPage(1);
                                setKeyword("");
                                setDetail(null);
                            }}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                {errors.map((error) => (
                    <div key={error} className="mb-3">
                        <Alert
                            type="warning"
                            showIcon
                            title={error}
                            action={
                                <Button
                                    size="small"
                                    onClick={() => {
                                        void statusQuery.refetch();
                                        if (accountId) {
                                            void listQuery.refetch();
                                            void overview.refetch();
                                        }
                                    }}
                                >
                                    重新读取
                                </Button>
                            }
                        />
                    </div>
                ))}
                {demo && (
                    <Alert
                        type="info"
                        showIcon
                        title="当前为演示模式，以下数据与素材均为示例，不代表真实投放结果。"
                        action={
                            <Button size="small" onClick={() => setAccountModal(true)}>
                                连接我的账户
                            </Button>
                        }
                    />
                )}
                {status && !demo && !accountId && <Alert type="warning" title="授权已保存，尚未读取到投放账户。请打开“授权账户”刷新账户列表或重新授权。" />}
                <div className={styles.filters}>
                    <div className={styles.account}>
                        <Select
                            aria-label="千川账户"
                            className="w-full"
                            value={demo ? "demo" : accountId || undefined}
                            placeholder="选择授权账户"
                            options={demo ? [{ value: "demo", label: "梦畅旗舰店 · 演示" }] : status?.accounts.map((a) => ({ value: a.id, label: a.name }))}
                            onChange={(id) => {
                                setSelectedAccount(id);
                                setPage(1);
                                setDetail(null);
                            }}
                            disabled={Boolean(busy)}
                        />
                    </div>
                    <DatePicker.RangePicker
                        aria-label="报表日期"
                        allowClear={false}
                        value={[dayjs(dates[0]), dayjs(dates[1])]}
                        disabledDate={(d) => d.isAfter(dayjs(), "day")}
                        onChange={(d) => {
                            if (d?.[0] && d[1]) {
                                setDates([d[0].format("YYYY-MM-DD"), d[1].format("YYYY-MM-DD")]);
                                setPage(1);
                                setDetail(null);
                            }
                        }}
                        disabled={Boolean(busy)}
                    />
                    <span className={styles.synced}>
                        <CircleCheck size={13} />
                        {demo ? "示例预览 · 不调用千川接口" : overviewData?.lastSyncedAt ? `标准推广日报同步于 ${dayjs(overviewData.lastSyncedAt).format("MM-DD HH:mm")}` : "所选日期尚未同步标准推广日报"}
                    </span>
                </div>
                <div className={styles.stats}>
                    {[
                        { label: "标准推广消耗", n: metrics.cost, icon: Wallet, money: true },
                        { label: "支付金额", n: metrics.revenue, icon: ShoppingBag, money: true },
                        { label: "支付订单", n: metrics.orders, icon: Package },
                        { label: "支付 ROI", n: metrics.roi, icon: BarChart3 },
                    ].map((s) => (
                        <div className={styles.stat} key={s.label}>
                            <div className={styles.statIcon}>
                                <s.icon size={20} />
                            </div>
                            <div>
                                <div className={styles.statLabel}>{s.label}</div>
                                <div className={styles.statNumber}>{value(s.n, s.money)}</div>
                                <div className={styles.statHint}>{demo ? "演示指标" : "标准推广 · 不含全域计划"}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className={styles.columns}>
                    <div className={styles.main}>
                        <section className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2>标准推广投放趋势</h2>
                                <div className={styles.legend}>
                                    <span>消耗（元）</span>
                                    <span>支付金额（元）</span>
                                </div>
                            </div>
                            <TrendChart data={overviewData} />
                        </section>
                        <section className={styles.card} aria-label="分析数据列表">
                            <div className={styles.cardHeader}>
                                <h2>{tab === "overview" ? "全域商品推广计划" : tab === "materials" ? "素材库明细" : tab === "products" ? "商品明细" : "计划效果明细"}</h2>
                                <div className={styles.actions}>
                                    {tab === "materials" && (
                                        <Select
                                            aria-label="素材类型"
                                            value={mediaKind}
                                            onChange={(k) => {
                                                setMediaKind(k);
                                                setPage(1);
                                            }}
                                            options={[
                                                { value: "videos", label: "视频" },
                                                { value: "images", label: "图片" },
                                            ]}
                                        />
                                    )}
                                    <Select
                                        aria-label="排序方式"
                                        value={sort}
                                        onChange={(v) => {
                                            setSort(v);
                                            setPage(1);
                                        }}
                                        options={[
                                            { value: "name", label: "按名称排序" },
                                            { value: "cost", label: "按消耗排序" },
                                            { value: "revenue", label: "按支付金额排序" },
                                            { value: "roi", label: "按 ROI 排序" },
                                        ]}
                                    />
                                    <Input.Search
                                        aria-label="搜索记录"
                                        placeholder="搜索名称或 ID"
                                        value={keyword}
                                        onChange={(e) => {
                                            setKeyword(e.target.value);
                                            setPage(1);
                                        }}
                                        allowClear
                                        style={{ width: 190 }}
                                    />
                                </div>
                            </div>
                            {!status || (!demo && listQuery.isFetching) ? (
                                <Skeleton active paragraph={{ rows: 5 }} />
                            ) : data?.items.length ? (
                                <div className={styles.tableScroll}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th>{kindNames[kind]}</th>
                                                <th>{kind === "plans" ? "关联商品" : "数据范围"}</th>
                                                <th>消耗</th>
                                                <th>支付金额</th>
                                                <th>ROI</th>
                                                <th>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.items.map((row) => (
                                                <tr key={row.id}>
                                                    <td>
                                                        <div className={styles.identity}>
                                                            <Thumbnail row={row} demo={demo} />
                                                            <div>
                                                                <div className={styles.recordName}>{row.name || row.id}</div>
                                                                <div className={styles.recordMeta}>{row.status || `${row.kind === "images" ? "图片" : "视频"}素材`}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>{row.products?.length ? <div className={styles.recordName}>{row.products.map((p) => p.name || p.id).join("、")}</div> : row.metricScope === "plan" ? "计划级" : "—"}</td>
                                                    <td>{value(row.cost, true)}</td>
                                                    <td>{value(row.revenue, true)}</td>
                                                    <td>{value(row.roi)}</td>
                                                    <td>
                                                        <Button type="link" size="small" onClick={() => setDetail(row)}>
                                                            查看
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className={styles.empty}>
                                    <Database size={26} />
                                    <span>{keyword ? "没有匹配的记录" : data?.lastSyncedAt ? "当前接口未返回记录" : "所选数据尚未同步"}</span>
                                    <span>缺失数据不会使用演示数字填充</span>
                                </div>
                            )}
                            <p className={styles.note}>
                                {tab === "materials"
                                    ? "素材库不等于投放素材报表：素材与商品、计划的关联及素材级指标尚待接口验证，缺失时显示“—”。"
                                    : tab === "products"
                                      ? "展示可推广商品；商品级成交效果尚未接入，不分摊计划消耗。"
                                      : "计划为全域商品推广，顶部卡片与趋势仅统计标准推广，不含全域计划；二者不可直接对比。支付 ROI 与结算 ROI 不混用。"}
                            </p>
                            <div className={styles.tableFooter}>
                                <span>
                                    共 {data?.total ?? 0} 条{!demo && data?.lastSyncedAt ? ` · 同步于 ${dayjs(data.lastSyncedAt).format("MM-DD HH:mm")}` : ""}
                                </span>
                                <Pagination current={page} pageSize={10} total={data?.total || 0} onChange={setPage} showSizeChanger={false} size="small" />
                            </div>
                        </section>
                    </div>
                    <aside className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2>AI 投放分析</h2>
                            <Tag>即将上线</Tag>
                        </div>
                        <div className={styles.aiBody}>
                            <div className={styles.aiIcon}>
                                <Sparkles size={23} />
                            </div>
                            <h3>先看清数据，再理解表现</h3>
                            <p>AI 查数、素材对比与 MCP 工具将于后续接入。本期先完成真实数据展示。</p>
                            <div className={styles.aiExample}>
                                未来可以问
                                <br />
                                “最近 7 天，哪些素材值得关注？”
                                <br />
                                “比较同商品下不同计划的表现。”
                            </div>
                            <div className={styles.aiInput} aria-disabled="true">
                                AI 查数功能待开放 <LockKeyhole size={15} />
                            </div>
                            <p>当前不会调用模型，也不会自动调整预算或投放计划。</p>
                        </div>
                    </aside>
                </div>
                <Modal title="千川授权账户" open={accountModal} onCancel={() => setAccountModal(false)} footer={null} width={620}>
                    <div className="space-y-4 py-3">
                        <Alert type="info" title="授权仅用于读取数据；本期不会创建、启停计划或修改预算。" />
                        {!status?.postgres ? (
                            <Alert type="warning" title="当前是文件数据库模式。请先使用 PostgreSQL 后再接入真实账户。" />
                        ) : !status.configured ? (
                            <Alert type="warning" title="管理员需要先填写千川应用配置，并在开放平台登记相同的回调地址。" />
                        ) : null}
                        {status?.accounts.map((a) => (
                            <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                                <div className="min-w-0">
                                    <strong className="block truncate">{a.name}</strong>
                                    <div className="text-xs text-neutral-500">账户 ID：{a.id}</div>
                                </div>
                                <Button
                                    danger
                                    size="small"
                                    disabled={Boolean(busy)}
                                    onClick={() =>
                                        modal.confirm({
                                            title: "解除本地账户绑定？",
                                            content: "将删除该账户在 VOZEB 中的同步数据，不删除千川平台的商品、素材或计划。需要时可重新授权。",
                                            okText: "解除绑定",
                                            onOk: () =>
                                                perform("解除绑定", async () => {
                                                    await disconnectQianchuanAccount(a.id);
                                                    await cache.invalidateQueries({ queryKey: ["qianchuan-status", userId] });
                                                    await cache.invalidateQueries({ queryKey: ["qianchuan-data", userId] });
                                                }),
                                        })
                                    }
                                >
                                    解除绑定
                                </Button>
                            </div>
                        ))}
                        <div className={styles.actions}>
                            <Button
                                type="primary"
                                disabled={!status?.configured || Boolean(busy)}
                                onClick={() =>
                                    void perform("授权", async () => {
                                        const result = await authorizeQianchuan();
                                        window.location.assign(result.url);
                                    })
                                }
                            >
                                前往千川授权
                            </Button>
                            <Button
                                disabled={!status?.connectionCount || Boolean(busy)}
                                onClick={() =>
                                    void perform("刷新授权账户", async () => {
                                        try {
                                            await refreshQianchuanAccounts();
                                        } finally {
                                            await cache.invalidateQueries({ queryKey: ["qianchuan-status", userId] });
                                            await cache.invalidateQueries({ queryKey: ["qianchuan-data", userId] });
                                        }
                                        setAuthError("");
                                    })
                                }
                            >
                                刷新授权账户
                            </Button>
                            {canConfigure && <Button onClick={openSettings}>应用配置</Button>}
                        </div>
                    </div>
                </Modal>
                <Modal title="千川应用配置" open={settingsModal} onCancel={() => setSettingsModal(false)} onOk={() => form.submit()} confirmLoading={busy === "保存配置"} okText="保存" width={600}>
                    <Form
                        form={form}
                        layout="vertical"
                        className="pt-4"
                        onFinish={(v) =>
                            void perform("保存配置", async () => {
                                await saveQianchuanConfig({ ...v, secret: v.secret || "" });
                                await cache.invalidateQueries({ queryKey: ["qianchuan-status", userId] });
                                setSettingsModal(false);
                                void message.success("配置已保存");
                            })
                        }
                    >
                        <Form.Item name="appId" label="App ID" rules={[{ required: true }]}>
                            <Input autoComplete="off" />
                        </Form.Item>
                        <Form.Item name="secret" label="App Secret" help="仅在服务端加密保存，留空保留原密钥；更换 App ID 时必须重新填写。">
                            <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item name="callbackUrl" label="授权回调地址" rules={[{ required: true, type: "url" }]}>
                            <Input />
                        </Form.Item>
                        <div className="grid grid-cols-2 gap-4">
                            <Form.Item name="requestTimeoutSeconds" label="单次请求超时（秒）" rules={[{ required: true }]}>
                                <InputNumber min={1} max={600} className="w-full" />
                            </Form.Item>
                            <Form.Item name="syncTimeoutSeconds" label="单分区同步超时（秒）" rules={[{ required: true }]}>
                                <InputNumber min={1} max={600} className="w-full" />
                            </Form.Item>
                        </div>
                        <p className="text-xs text-neutral-500">同步上限 600 秒，与本接口的运行时窗口对应。Token 临近到期时将在下一次读取平台前刷新。请勿在回调地址中填写 Token。</p>
                    </Form>
                </Modal>
                <Modal title={detail?.name || "记录详情"} open={Boolean(detail)} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>} width={620}>
                    {detail && (
                        <>
                            <div className="py-3">{demo ? <Tag color="orange">演示记录</Tag> : <Tag>真实同步记录</Tag>}</div>
                            {detail.videoUrl ? (
                                <video controls preload="metadata" src={detail.videoUrl} className={styles.media} />
                            ) : detail.imageUrl ? (
                                <img src={detail.imageUrl} alt={detail.name} className={styles.media} referrerPolicy="no-referrer" />
                            ) : null}
                            <dl className={styles.detail}>
                                {[
                                    ["ID", detail.id],
                                    ["数据范围", detail.metricScope === "plan" ? "计划级" : detail.metricScope === "account" ? "账户级" : "素材/商品基础信息"],
                                    ["消耗", value(detail.cost, true)],
                                    ["支付金额", value(detail.revenue, true)],
                                    ["订单", value(detail.orders)],
                                    ["支付 ROI", value(detail.roi)],
                                    ["预算", value(detail.budget, true)],
                                    ["关联商品", detail.products?.map((p) => `${p.name}（${p.id}）`).join("、") || "—"],
                                ].map(([k, v]) => (
                                    <div key={k}>
                                        <dt>{k}</dt>
                                        <dd>{v}</dd>
                                    </div>
                                ))}
                            </dl>
                            <p className={styles.note}>“—”表示未获取或不适用，不等同于 0。媒体地址可能随平台授权或有效期变化。</p>
                        </>
                    )}
                </Modal>
            </div>
        </div>
    );
}

function Thumbnail({ row, demo }: { row: QianchuanRecord; demo: boolean }) {
    const url = row.imageUrl || row.products?.[0]?.imageUrl;
    return (
        <div className={styles.thumb}>
            {url ? (
                <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ) : demo ? (
                <>
                    <Shirt size={30} />
                    <small>示例素材</small>
                </>
            ) : row.kind === "videos" ? (
                <Video size={22} />
            ) : row.kind === "products" ? (
                <Package size={22} />
            ) : (
                <ImageIcon size={22} />
            )}
        </div>
    );
}
function TrendChart({ data }: { data?: QianchuanPage }) {
    const rows = data?.trend || [];
    if (!rows.some((r) => r.cost !== null || r.revenue !== null))
        return (
            <div className={styles.empty}>
                <BarChart3 size={26} />
                <span>暂无该日期范围的账户趋势</span>
            </div>
        );
    const max = Math.max(1, ...rows.flatMap((r) => [r.cost || 0, r.revenue || 0]));
    function path(key: "cost" | "revenue") {
        let gap = true;
        return rows
            .map((r, i) => {
                if (r[key] === null) {
                    gap = true;
                    return "";
                }
                const command = gap ? "M" : "L";
                gap = false;
                return `${command}${42 + (i * 700) / Math.max(rows.length - 1, 1)},${170 - ((r[key] || 0) / max) * 150}`;
            })
            .join(" ");
    }
    return (
        <>
            <svg className={styles.chart} viewBox="0 0 760 190" role="img" aria-label="账户消耗与支付金额趋势图">
                {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                    <g key={n}>
                        <line x1="42" x2="746" y1={170 - n * 150} y2={170 - n * 150} stroke="currentColor" opacity=".1" strokeDasharray="4 4" />
                        <text x="0" y={174 - n * 150} fontSize="10" fill="currentColor" opacity=".5">
                            {Math.round(max * n).toLocaleString()}
                        </text>
                    </g>
                ))}
                <path d={path("cost")} fill="none" stroke="var(--qc-accent)" strokeWidth="2.5" />
                <path d={path("revenue")} fill="none" stroke="#18a6a6" strokeWidth="2.5" />
                {rows.flatMap((row, index) =>
                    (["cost", "revenue"] as const).map((key) => {
                        const n = row[key];
                        return n === null ? null : <circle key={`${index}-${key}`} cx={42 + (index * 700) / Math.max(rows.length - 1, 1)} cy={170 - (n / max) * 150} r="3" fill={key === "cost" ? "var(--qc-accent)" : "#18a6a6"} />;
                    }),
                )}
            </svg>
            <div className={styles.chartLabels}>
                <span>{rows[0].date}</span>
                <span>标准推广账户日报 · 金额单位：元</span>
                <span>{rows.at(-1)?.date}</span>
            </div>
        </>
    );
}
