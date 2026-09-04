import { z } from "zod";

export const qianchuanKinds = ["overview", "plans", "products", "images", "videos"] as const;
export type QianchuanKind = (typeof qianchuanKinds)[number];
const date = z.iso.date();
export const qianchuanQuerySchema = z
    .object({
        accountId: z.string().min(1),
        kind: z.enum(qianchuanKinds),
        startDate: date,
        endDate: date,
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        keyword: z.string().trim().max(200).default(""),
        sort: z.enum(["name", "cost", "revenue", "roi"]).default("name"),
    })
    .refine((v) => v.startDate <= v.endDate, { message: "开始日期不能晚于结束日期" });
export type QianchuanQuery = z.infer<typeof qianchuanQuerySchema>;
export type QianchuanMetrics = { cost: number | null; revenue: number | null; orders: number | null; impressions: number | null; clicks: number | null; roi: number | null };
export type QianchuanRecord = QianchuanMetrics & {
    id: string;
    name: string;
    kind: QianchuanKind;
    date?: string;
    status?: string;
    imageUrl?: string;
    videoUrl?: string;
    budget?: number | null;
    products?: { id: string; name: string; imageUrl?: string }[];
    metricScope: "account" | "plan" | "unavailable";
};
export type QianchuanAccount = { id: string; name: string; connectionId: string; authorizedAt: string };
export type QianchuanSettings = { appId: string; hasSecret: boolean; callbackUrl: string; requestTimeoutSeconds: number; syncTimeoutSeconds: number };
export type QianchuanStatus = { configured: boolean; postgres: boolean; accounts: QianchuanAccount[]; connectionCount: number; settings?: QianchuanSettings };
export type QianchuanPage = {
    items: QianchuanRecord[];
    total: number;
    page: number;
    pageSize: number;
    summary: QianchuanMetrics;
    trend: QianchuanRecord[];
    lastSyncedAt: string | null;
    error: string | null;
};
export const emptyQianchuanMetrics: QianchuanMetrics = { cost: null, revenue: null, orders: null, impressions: null, clicks: null, roi: null };
export const qianchuanAskSchema = z.object({
    requestId: z.string().uuid(),
    question: z.string().trim().min(1).max(4000),
    query: qianchuanQuerySchema,
});
export type QianchuanAsk = z.infer<typeof qianchuanAskSchema>;
export type QianchuanAnalysis = {
    requestId: string;
    question: string;
    answer: string;
    query: QianchuanQuery;
    source: { total: number; returned: number; lastSyncedAt: string | null; warning: string | null; summary: QianchuanMetrics } | null;
    createdAt: string;
};
export const qianchuanScopeNotes =
    "overview 仅为标准推广账户日报，不含全域；plans 仅为全域商品推广计划；products/images/videos 仅为目录，无商品或素材级投放指标。金额单位元；null 是缺失，不是零。日期为精确已同步区间，未同步不能视为零。summary 覆盖当前筛选的全部记录，items 仅为当前页，不能当作全部明细。不得跨口径相加、分摊、比较或推断因果。";
export function qianchuanScope(q: Pick<QianchuanQuery, "kind" | "startDate" | "endDate">) {
    return q.kind === "overview" || q.kind === "plans" ? `${q.startDate}/${q.endDate}` : "catalog";
}
