import { emptyQianchuanMetrics, type QianchuanPage, type QianchuanQuery, type QianchuanRecord } from "@/lib/qianchuan-contract";
import dayjs from "dayjs";

// Preview-only records. Never submitted to the API or written into a user's account.
export function qianchuanDemoPage(query: QianchuanQuery): QianchuanPage {
    const titles = ["白T通勤穿搭", "面料细节实拍", "三种穿搭演示", "新款开箱展示", "夏日轻盈搭配", "纯棉质感近拍"];
    const cost = [1200, 960, 850, 420, 760, 610],
        revenue = [5280, 3360, 4080, 0, 2736, 2135];
    const products = ["纯棉基础白T", "轻薄防晒衬衫", "休闲直筒长裤"];
    let items: QianchuanRecord[] = titles.map((name, i) => ({
        ...emptyQianchuanMetrics,
        id: `demo-${query.kind}-${i + 1}`,
        kind: query.kind,
        name,
        metricScope: query.kind === "plans" ? "plan" : "unavailable",
        cost: query.kind === "products" ? null : cost[i],
        revenue: query.kind === "products" ? null : revenue[i],
        orders: query.kind === "products" ? null : [36, 24, 28, 0, 18, 15][i],
        roi: query.kind === "products" ? null : revenue[i] / cost[i],
        ...(query.kind === "plans" ? { name: `全域商品推广 · ${name}`, status: i === 3 ? "暂停投放" : "投放中", budget: 1500, products: [{ id: `demo-product-${i % 3}`, name: products[i % 3] }] } : {}),
    }));
    if (query.kind === "products") items = products.map((name, i) => ({ ...emptyQianchuanMetrics, id: `demo-product-${i}`, kind: "products", name, status: "可推广", metricScope: "unavailable" }));
    const trend: QianchuanRecord[] = Array.from({ length: dayjs(query.endDate).diff(dayjs(query.startDate), "day") + 1 }, (_, i) => {
        const date = dayjs(query.startDate).add(i, "day").format("YYYY-MM-DD"),
            spend = [1260, 2080, 1520, 2240, 2670, 1750, 1160][i % 7];
        return {
            ...emptyQianchuanMetrics,
            id: date,
            name: date,
            date,
            kind: "overview",
            metricScope: "account",
            cost: spend,
            revenue: Math.round(spend * [3.2, 3.9, 3.6, 4.1, 4.2, 3.5, 3.85][i % 7]),
            orders: Math.round(spend / 35),
            impressions: spend * 96,
            clicks: spend * 3,
        };
    });
    if (query.kind === "overview") items = trend;
    items = items.filter((r) => r.name.toLowerCase().includes(query.keyword.toLowerCase()));
    items.sort((a, b) => (query.sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : (b[query.sort] ?? -1) - (a[query.sort] ?? -1)));
    const total = items.length;
    const sum = (key: "cost" | "revenue" | "orders" | "impressions" | "clicks") => (items.some((r) => r[key] === null) || !items.length ? null : items.reduce((n, r) => n + (r[key] ?? 0), 0));
    const summary = { cost: sum("cost"), revenue: sum("revenue"), orders: sum("orders"), impressions: sum("impressions"), clicks: sum("clicks"), roi: null as number | null };
    summary.roi = summary.cost && summary.revenue !== null ? summary.revenue / summary.cost : null;
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total, page: query.page, pageSize: query.pageSize, summary, trend: query.kind === "overview" ? trend : [], lastSyncedAt: null, error: null };
}
