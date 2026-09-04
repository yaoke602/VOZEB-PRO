import type { QianchuanKind, QianchuanQuery, QianchuanRecord } from "@/lib/qianchuan-contract";
import { emptyQianchuanMetrics } from "@/lib/qianchuan-contract";

export class QianchuanError extends Error {
    constructor(
        message: string,
        public status = 400,
    ) {
        super(message);
    }
}
export type PlatformObject = Record<string, unknown>;
export const object = (v: unknown): PlatformObject => (v && typeof v === "object" && !Array.isArray(v) ? (v as PlatformObject) : {});
export const objects = (v: unknown): PlatformObject[] => (Array.isArray(v) ? v.map(object) : []);
export const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
export function numeric(v: unknown): number | null {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
export function mediaUrl(v: unknown) {
    try {
        const url = new URL(text(v));
        return url.protocol === "https:" ? url.href : undefined;
    } catch {
        return undefined;
    }
}
// Node 22+ native JSON source context preserves platform int64 IDs without a custom parser.
export function parsePlatformJson(raw: string): PlatformObject {
    return object(
        JSON.parse(raw, (_key, value, context?: { source: string }) => {
            if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
                if (!context?.source) throw new QianchuanError("运行环境不支持无损读取千川 ID，请使用 Node 22 或更高版本", 500);
                return context.source;
            }
            return value;
        }),
    );
}

export class QianchuanApi {
    constructor(
        private token: string,
        private timeoutSeconds: number,
        private signal?: AbortSignal,
        private transport: typeof fetch = fetch,
    ) {}
    async request(path: string, params: PlatformObject = {}, method: "GET" | "POST" = "GET", oauth = false): Promise<PlatformObject> {
        const url = new URL(path, "https://api.oceanengine.com");
        if (url.origin !== "https://api.oceanengine.com" || !url.pathname.startsWith("/open_api/")) throw new QianchuanError("不允许的千川接口");
        if (method === "GET")
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
            }
        if (oauth) url.searchParams.set("access_token", this.token);
        const timeout = AbortSignal.timeout(this.timeoutSeconds * 1000);
        const signal = this.signal ? AbortSignal.any([timeout, this.signal]) : timeout;
        let payload: PlatformObject;
        try {
            const response = await this.transport(url, {
                method,
                signal,
                redirect: "error",
                cache: "no-store",
                headers: { "Content-Type": "application/json", ...(!oauth && this.token ? { "Access-Token": this.token } : {}) },
                ...(method === "POST" ? { body: JSON.stringify(params) } : {}),
            });
            if (!response.ok) throw new QianchuanError(`千川接口 HTTP ${response.status}`, 502);
            payload = parsePlatformJson(await response.text());
        } catch (error) {
            if (error instanceof QianchuanError) throw error;
            throw new QianchuanError(signal.aborted ? "千川请求超时，请缩小日期范围或调整请求超时配置" : "千川网络请求失败，请检查网络连接", 502);
        }
        if (payload.code !== 0) {
            // Do not expose upstream messages that may echo OAuth credentials or request URLs.
            const code = text(payload.code);
            throw new QianchuanError(`千川接口失败（code=${/^\d+$/.test(code) ? code : "unknown"}）${code === "40100" ? "：请求频率超限，请稍后重新同步" : "：请核对授权、接口权限和日期范围"}`, 502);
        }
        if (!payload.data || typeof payload.data !== "object") throw new QianchuanError("千川接口返回了无效数据", 502);
        return object(payload.data);
    }
    async *pages(path: string, params: PlatformObject, listKey: string | ((data: PlatformObject) => PlatformObject[])) {
        for (let page = 1; ; page++) {
            const data = await this.request(path, { ...params, page });
            if (typeof listKey === "string" && !Array.isArray(data[listKey])) throw new QianchuanError(`千川接口未返回 ${listKey} 列表，未覆盖已同步数据`, 502);
            const rows = typeof listKey === "function" ? listKey(data) : objects(data[listKey]);
            yield rows;
            const info = object(data.page_info);
            const totalPages = numeric(info.total_page);
            const total = numeric(info.total_number);
            const size = Number(params.page_size);
            const more = totalPages !== null ? page < totalPages : total !== null ? page * size < total : rows.length >= size;
            if (!more) return;
            if (!rows.length) throw new QianchuanError("千川分页数据不完整，未覆盖已同步数据", 502);
        }
    }
}

export function shopAccountRows(data: PlatformObject): PlatformObject[] {
    if (Array.isArray(data.adv_id_list)) return objects(data.adv_id_list).map((row) => ({ account_id: row.adv_id }));
    if (Array.isArray(data.list)) return data.list.map((id) => ({ account_id: id }));
    throw new QianchuanError("店铺接口未返回投放账户列表", 502);
}

export function resourceRequest(q: QianchuanQuery) {
    const common = { advertiser_id: q.accountId, page_size: 100 };
    switch (q.kind) {
        case "overview":
            return {
                path: "/open_api/v1.0/qianchuan/report/advertiser/get/",
                list: "list",
                params: { ...common, start_date: q.startDate, end_date: q.endDate, fields: ["stat_cost", "show_cnt", "click_cnt", "pay_order_count", "pay_order_amount"], filtering: { marketing_goal: "ALL" }, time_granularity: "TIME_GRANULARITY_DAILY" },
            };
        case "plans":
            return {
                path: "/open_api/v1.0/qianchuan/uni_promotion/list/",
                list: "ad_list",
                params: {
                    ...common,
                    start_time: `${q.startDate} 00:00:00`,
                    end_time: `${q.endDate} 23:59:59`,
                    marketing_goal: "VIDEO_PROM_GOODS",
                    fields: ["stat_cost", "total_pay_order_gmv_for_roi2", "total_pay_order_count_for_roi2", "total_prepay_and_pay_order_roi2"],
                },
            };
        case "products":
            return { path: "/open_api/v1.0/qianchuan/product/available/get/", list: "product_list", params: common };
        case "images":
            return { path: "/open_api/v1.0/qianchuan/image/get/", list: "list", params: common };
        case "videos":
            return { path: "/open_api/v1.0/qianchuan/video/get/", list: "list", params: common };
    }
}

export function normalizeQianchuanRecord(kind: QianchuanKind, row: PlatformObject): QianchuanRecord {
    const record: QianchuanRecord = { ...emptyQianchuanMetrics, id: "", name: "", kind, metricScope: "unavailable" };
    if (kind === "overview") {
        record.id = text(row.stat_datetime).slice(0, 10);
        record.date = record.id;
        record.name = record.id;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(record.id)) throw new QianchuanError("千川日报缺少有效日期，未覆盖已同步数据", 502);
        record.cost = numeric(row.stat_cost);
        record.revenue = numeric(row.pay_order_amount);
        record.orders = numeric(row.pay_order_count);
        record.impressions = numeric(row.show_cnt);
        record.clicks = numeric(row.click_cnt);
        record.roi = record.cost && record.revenue !== null ? record.revenue / record.cost : null;
        record.metricScope = "account";
    } else if (kind === "plans") {
        const ad = object(row.ad_info),
            stats = object(row.stats_info);
        record.id = text(ad.id);
        record.name = text(ad.name);
        record.status = text(ad.status);
        record.budget = numeric(ad.budget);
        // Full-domain list monetary fields use 1/100000 yuan in the validated reference integration.
        const cost = numeric(stats.stat_cost),
            revenue = numeric(stats.total_pay_order_gmv_for_roi2);
        record.cost = cost === null ? null : cost / 100000;
        record.revenue = revenue === null ? null : revenue / 100000;
        record.orders = numeric(stats.total_pay_order_count_for_roi2);
        record.roi = numeric(stats.total_prepay_and_pay_order_roi2);
        record.products = objects(row.product_info).map((p) => ({ id: text(p.product_id), name: text(p.product_name), imageUrl: mediaUrl(p.product_image) }));
        record.metricScope = "plan";
    } else if (kind === "products") {
        record.id = text(row.id);
        record.name = text(row.name);
        record.imageUrl = mediaUrl(row.img);
        record.status = "可推广";
    } else {
        record.id = text(row.material_id) || text(row.id);
        record.name = text(row.filename);
        if (kind === "images") record.imageUrl = mediaUrl(row.url);
        else record.videoUrl = mediaUrl(row.url);
    }
    if (!record.id) throw new QianchuanError("千川返回记录缺少稳定 ID，未覆盖已同步数据", 502);
    return record;
}
