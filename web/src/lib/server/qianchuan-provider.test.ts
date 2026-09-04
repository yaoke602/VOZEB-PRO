import { describe, expect, it, vi } from "vitest";
import { qianchuanQuerySchema, qianchuanScope } from "@/lib/qianchuan-contract";
import { normalizeQianchuanRecord, parsePlatformJson, QianchuanApi, resourceRequest, shopAccountRows } from "./qianchuan-provider";

const query = qianchuanQuerySchema.parse({ accountId: "123", kind: "plans", startDate: "2026-09-01", endDate: "2026-09-04" });
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));

describe("Qianchuan protocol normalization", () => {
    it("preserves int64 identifiers without rounding", () => {
        expect(parsePlatformJson('{"id":7590294716513329233,"zero":0,"cost":0.25}')).toEqual({ id: "7590294716513329233", zero: 0, cost: 0.25 });
    });
    it("keeps missing metrics separate from real zero and converts full-domain money", () => {
        const plan = normalizeQianchuanRecord("plans", {
            ad_info: { id: "1", name: "p", budget: 100.25 },
            stats_info: { stat_cost: 125000, total_pay_order_gmv_for_roi2: 500000, total_pay_order_count_for_roi2: 0, total_prepay_and_pay_order_roi2: 4 },
            product_info: [
                { product_id: "2", product_name: "a" },
                { product_id: "3", product_name: "b" },
            ],
        });
        expect(plan).toMatchObject({ cost: 1.25, revenue: 5, orders: 0, clicks: null, roi: 4, budget: 100.25, metricScope: "plan" });
        expect(plan.products).toHaveLength(2);
        expect(normalizeQianchuanRecord("products", { id: "2", name: "a", stat_cost: 125000 })).toMatchObject({ cost: null, revenue: null, metricScope: "unavailable" });
    });
    it("does not invent ROI at zero spend or accept missing row identifiers", () => {
        expect(normalizeQianchuanRecord("overview", { stat_datetime: "2026-09-01 00:00:00", stat_cost: 0, pay_order_amount: 0 })).toMatchObject({ cost: 0, revenue: 0, roi: null });
        expect(() => normalizeQianchuanRecord("overview", { stat_datetime: "all" })).toThrow("日期");
        expect(() => normalizeQianchuanRecord("videos", {})).toThrow("稳定 ID");
    });
    it("supports both official shop account response shapes", () => {
        expect(shopAccountRows({ adv_id_list: [{ adv_id: "123" }] })).toEqual([{ account_id: "123" }]);
        expect(shopAccountRows({ list: [123, "456"] })).toEqual([{ account_id: 123 }, { account_id: "456" }]);
        expect(() => shopAccountRows({})).toThrow("账户列表");
    });
    it("uses category and date-scoped requests with explicit metric fields", () => {
        expect(resourceRequest(query)).toMatchObject({ list: "ad_list", params: { advertiser_id: "123", marketing_goal: "VIDEO_PROM_GOODS" } });
        expect(qianchuanScope(query)).toBe("2026-09-01/2026-09-04");
        expect(qianchuanScope({ ...query, kind: "products" })).toBe("catalog");
        expect(qianchuanQuerySchema.safeParse({ ...query, endDate: "2026-08-01" }).success).toBe(false);
        expect(qianchuanQuerySchema.safeParse({ ...query, sort: "cost; DROP TABLE users" }).success).toBe(false);
        expect(qianchuanQuerySchema.safeParse({ ...query, pageSize: 101 }).success).toBe(false);
    });
    it("puts OAuth account token in query and business token in header", async () => {
        const transport = vi.fn<typeof fetch>().mockImplementation(async () => ok({ list: [] }));
        const api = new QianchuanApi("fixture-token", 60, undefined, transport);
        await api.request("/open_api/oauth2/advertiser/get/", {}, "GET", true);
        expect(new URL(String(transport.mock.calls[0][0])).searchParams.get("access_token")).toBe("fixture-token");
        await api.request("/open_api/v1.0/qianchuan/video/get/", { advertiser_id: "123" });
        expect(transport.mock.calls[1][1]?.headers).toMatchObject({ "Access-Token": "fixture-token" });
        expect(new URL(String(transport.mock.calls[1][0])).searchParams.has("access_token")).toBe(false);
        await expect(api.request("https://evil.example/open_api/x")).rejects.toThrow("不允许");
        expect(transport).toHaveBeenCalledTimes(2);
    });
    it("honors explicit page count even when an intermediate page is short", async () => {
        const transport = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(ok({ list: [{ id: "1" }], page_info: { total_page: 2 } }))
            .mockResolvedValueOnce(ok({ list: [{ id: "2" }], page_info: { total_page: 2 } }));
        const pages = [];
        for await (const rows of new QianchuanApi("fixture", 60, undefined, transport).pages("/open_api/test/", { page_size: 100 }, "list")) pages.push(...rows);
        expect(pages.map((r) => r.id)).toEqual(["1", "2"]);
    });
    it("fails on malformed pages and does not echo upstream secrets", async () => {
        const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(ok({})).mockResolvedValueOnce(new Response('{"code":40001,"message":"secret fixture-token"}'));
        const api = new QianchuanApi("fixture-token", 60, undefined, transport);
        await expect(api.pages("/open_api/test/", { page_size: 100 }, "list").next()).rejects.toThrow("未覆盖");
        await expect(api.request("/open_api/test/")).rejects.toThrow("code=40001");
    });
});
