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
export function qianchuanScope(q: Pick<QianchuanQuery, "kind" | "startDate" | "endDate">) {
    return q.kind === "overview" || q.kind === "plans" ? `${q.startDate}/${q.endDate}` : "catalog";
}
