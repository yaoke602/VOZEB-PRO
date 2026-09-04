import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyQianchuanMetrics, qianchuanQuerySchema } from "@/lib/qianchuan-contract";

const m = vi.hoisted(() => ({ enabled: vi.fn(), account: vi.fn(), claim: vi.fn(), analysis: vi.fn(), latest: vi.fn(), save: vi.fn(), fail: vi.fn(), settings: vi.fn(), candidates: vi.fn(), request: vi.fn(), read: vi.fn(), refund: vi.fn() }));
vi.mock("./database/postgres", () => ({ ensurePostgresSchema: vi.fn(), isPostgresDatabaseEnabled: m.enabled }));
vi.mock("./database/qianchuan-repository", () => ({
    QianchuanRepository: class {
        accountConnection = m.account;
        claimAnalysis = m.claim;
        analysis = m.analysis;
        latestAnalysis = m.latest;
        saveAnalysis = m.save;
        failAnalysis = m.fail;
    },
}));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: m.settings, refundUserPoints: m.refund }));
vi.mock("./logical-model-router", () => ({ resolveLogicalModelCandidates: m.candidates }));
vi.mock("./text-planning-runtime", () => ({ rankTextPlanningCandidates: (value: unknown) => value, requestStructuredText: m.request }));
vi.mock("./qianchuan-service", () => ({ readQianchuanPage: m.read }));
import { askQianchuan, latestQianchuanAnalysis, qianchuanPlanSchema } from "./qianchuan-analysis-service";

const query = qianchuanQuerySchema.parse({ accountId: "123", kind: "plans", startDate: "2026-09-01", endDate: "2026-09-04" });
const input = { requestId: "d358c14d-9b59-4fdc-88cd-6d58f6a72d2b", question: "按消耗排列计划", query };
const context = { userId: "user-a", origin: "http://internal:3000", cookie: "fixture-session" };
const planQuery = { kind: query.kind, startDate: query.startDate, endDate: query.endDate, page: 1, pageSize: 20, keyword: "", sort: "cost" };
const response = (value: unknown, headers = new Headers()) => ({ arguments: JSON.stringify(value), headers });
beforeEach(() => {
    vi.resetAllMocks();
    m.enabled.mockReturnValue(true);
    m.account.mockResolvedValue({ id: "connection" });
    m.claim.mockResolvedValue(true);
    m.settings.mockResolvedValue({ defaultModels: { textModel: "logical-text" } });
    m.candidates.mockReturnValue([{ channelId: "channel-one", upstreamModel: "text-upstream" }]);
    m.request.mockResolvedValueOnce(response({ supported: true, clarification: "", query: planQuery })).mockResolvedValueOnce(response({ answer: "计划消耗为 0.25 元，部分指标缺失。" }));
    m.read.mockResolvedValue({
        items: [{ ...emptyQianchuanMetrics, id: "1", name: "计划", kind: "plans", metricScope: "plan", cost: 0.25, imageUrl: "https://private-signed.example" }],
        total: 10,
        summary: { ...emptyQianchuanMetrics, cost: 2.5 },
        lastSyncedAt: "2026-09-04T01:00:00Z",
        error: null,
    });
});
describe("Qianchuan AI queries", () => {
    it("plans then reads only the owned cache, strips media URLs and persists the answer", async () => {
        const result = await askQianchuan(context, input);
        expect(m.account).toHaveBeenCalledWith("user-a", "123");
        expect(m.read).toHaveBeenCalledWith("user-a", { ...query, sort: "cost" });
        expect(result).toMatchObject({ source: { total: 10, returned: 1, summary: { cost: 2.5, orders: null } } });
        expect(m.save).toHaveBeenCalledWith("user-a", result);
        const calls = m.request.mock.calls;
        expect(JSON.stringify(calls[1])).not.toContain("private-signed");
        expect(calls[0][0]).toMatchObject({ cookie: "fixture-session", origin: "http://internal:3000" });
        expect(calls[0][0].headers["Idempotency-Key"]).not.toBe(calls[1][0].headers["Idempotency-Key"]);
        expect(calls[0][0].headers["Idempotency-Key"]).not.toBe(input.requestId);
    });
    it("replays a completed request without any text billing or query", async () => {
        const saved = { answer: "saved" };
        m.claim.mockResolvedValue(false);
        m.analysis.mockResolvedValue({
            status: "completed",
            fingerprint: createHash("sha256")
                .update(JSON.stringify({ question: input.question, query }))
                .digest("hex"),
            result: saved,
        });
        expect(await askQianchuan(context, input)).toEqual(saved);
        expect(m.request).not.toHaveBeenCalled();
        expect(m.read).not.toHaveBeenCalled();
    });
    it.each(["pending", "failed"])("does not automatically resubmit %s requests", async (status) => {
        m.claim.mockResolvedValue(false);
        m.analysis.mockResolvedValue({
            status,
            fingerprint: createHash("sha256")
                .update(JSON.stringify({ question: input.question, query }))
                .digest("hex"),
            result: null,
        });
        await expect(askQianchuan(context, input)).rejects.toMatchObject({ status: 409 });
        expect(m.request).not.toHaveBeenCalled();
    });
    it("rejects fingerprints, unauthorized accounts and demo mode before model access", async () => {
        m.claim.mockResolvedValue(false);
        m.analysis.mockResolvedValue({ fingerprint: "different" });
        await expect(askQianchuan(context, input)).rejects.toMatchObject({ status: 409 });
        m.account.mockResolvedValue(null);
        await expect(askQianchuan(context, input)).rejects.toMatchObject({ status: 404 });
        await expect(latestQianchuanAnalysis("user-b", "123")).rejects.toMatchObject({ status: 404 });
        expect(m.latest).not.toHaveBeenCalled();
        m.enabled.mockReturnValue(false);
        await expect(askQianchuan(context, input)).rejects.toMatchObject({ status: 409 });
        expect(m.request).not.toHaveBeenCalled();
    });
    it("rejects executable fields, cross-account fields and reversed dates in model plans", () => {
        for (const extra of [{ accountId: "other" }, { sql: "SELECT * FROM users" }, { endDate: "2026-08-01" }]) {
            expect(qianchuanPlanSchema.safeParse({ supported: true, clarification: "", query: { ...planQuery, ...extra } }).success).toBe(false);
        }
    });
    it("does not invent zeros or call a second model on an unsynced dataset", async () => {
        m.read.mockResolvedValue({ items: [], total: 0, summary: emptyQianchuanMetrics, lastSyncedAt: null, error: null });
        const result = await askQianchuan(context, input);
        expect(result.answer).toContain("尚未同步");
        expect(m.request).toHaveBeenCalledTimes(1);
        expect(m.save).toHaveBeenCalled();
    });
    it("persists clarifications without accessing business data", async () => {
        m.request.mockReset().mockResolvedValue(response({ supported: false, clarification: "暂不支持跨账户查询", query: planQuery }));
        expect((await askQianchuan(context, input)).answer).toContain("跨账户");
        expect(m.read).not.toHaveBeenCalled();
    });
    it("refunds invalid zero-point structured output and marks failure without leaking raw errors", async () => {
        m.request.mockReset().mockResolvedValue(response({ bad: "secret" }, new Headers({ "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "charge-one" })));
        await expect(askQianchuan(context, input)).rejects.toMatchObject({ status: 502 });
        expect(m.refund).toHaveBeenCalledWith("user-a", "logical-text", 0, "text", 1, undefined, "charge-one");
        expect(m.fail).toHaveBeenCalledWith("user-a", input.requestId);
        expect(m.save).not.toHaveBeenCalled();
    });
});
