import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyQianchuanMetrics, qianchuanQuerySchema } from "@/lib/qianchuan-contract";
import { POSTGRESQL_QIANCHUAN_SCHEMA_SQL } from "./schema-qianchuan";
import { QianchuanRepository } from "./qianchuan-repository";

// Explicit isolated fixture database only; never use DATABASE_URL or application data.
const url = process.env.QIANCHUAN_TEST_DATABASE_URL;
const schema = `fixture_${randomUUID().replaceAll("-", "")}`;
describe.skipIf(!url)("Qianchuan real PostgreSQL transactions", () => {
    let db: Client;
    let repo: QianchuanRepository;
    const q = qianchuanQuerySchema.parse({ accountId: "123", kind: "plans", startDate: "2026-09-01", endDate: "2026-09-04", pageSize: 1 });
    beforeAll(async () => {
        const parsed = new URL(url!);
        if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/qianchuan_fixture") throw new Error("Use an isolated loopback qianchuan_fixture database");
        db = new Client({ connectionString: url });
        await db.connect();
        await db.query(`CREATE SCHEMA ${schema}`);
        await db.query(`SET search_path TO ${schema}`);
        await db.query("CREATE TABLE users(id text PRIMARY KEY)");
        await db.query(POSTGRESQL_QIANCHUAN_SCHEMA_SQL);
        repo = new QianchuanRepository(db);
        await db.query("INSERT INTO users VALUES('user-a'),('user-b')");
        for (const userId of ["user-a", "user-b"]) {
            await repo.saveConnection({ id: userId, user_id: userId, app_id: "1", access_ciphertext: "fixture", refresh_ciphertext: "fixture", expires_at: new Date() });
            await repo.bindAccount(userId, userId, "123", "fixture");
        }
    });
    afterAll(async () => {
        if (!db) return;
        await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await db.end();
    });
    it("keeps fractional metrics, isolates owners, and preserves snapshots on rollback", async () => {
        const record = { ...emptyQianchuanMetrics, id: "1", name: "A", kind: "plans" as const, metricScope: "plan" as const, cost: 0.25, revenue: 1.5, orders: 0 };
        await db.query("BEGIN");
        await repo.resetDataset("user-a", q);
        await repo.insertRecords("user-a", q, [record, { ...record, id: "2", name: "B", cost: 1.25 }]);
        await repo.finishDataset("user-a", q);
        await db.query("COMMIT");
        expect(await repo.page("user-a", q)).toMatchObject({ total: 2, items: [record], summary: { cost: 1.5, revenue: 3, roi: 2, orders: 0 } });
        expect(await repo.page("user-b", q)).toMatchObject({ total: 0, items: [] });
        expect(await repo.page("user-a", { ...q, page: 3 })).toMatchObject({ total: 2, items: [] });
        expect(await repo.page("user-a", { ...q, keyword: "B" })).toMatchObject({ total: 1, summary: { cost: 1.25 } });
        await db.query("BEGIN");
        await repo.resetDataset("user-a", q);
        await db.query("ROLLBACK");
        expect((await repo.page("user-a", q)).total).toBe(2);
        expect((await repo.page("user-a", { ...q, endDate: "2026-09-03" })).total).toBe(0);
    });
    it("enforces single-use OAuth state and user-bound deletion", async () => {
        const requestId = randomUUID();
        const claims = await Promise.all([repo.claimAnalysis("user-a", requestId, "123", "fingerprint"), repo.claimAnalysis("user-a", requestId, "123", "fingerprint")]);
        expect(claims).toEqual([true, false]);
        expect(await repo.analysis("user-b", requestId)).toBeUndefined();
        expect(await repo.latestAnalysis("user-a", "123")).toBeNull();
        const result = { requestId, question: "测试", query: q, answer: "消耗 0.25 元", source: null, createdAt: new Date().toISOString() };
        await repo.saveAnalysis("user-a", result);
        await repo.failAnalysis("user-a", requestId);
        expect(await repo.analysis("user-a", requestId)).toMatchObject({ status: "completed", result });
        expect(await repo.latestAnalysis("user-a", "123")).toEqual(result);
        expect(await repo.latestAnalysis("user-b", "123")).toBeNull();
        const failedId = randomUUID();
        await repo.claimAnalysis("user-a", failedId, "123", "another");
        await repo.failAnalysis("user-a", failedId);
        expect(await repo.analysis("user-a", failedId)).toMatchObject({ status: "failed" });
        expect(await repo.latestAnalysis("user-a", "123")).toEqual(result);
        await repo.createState("user-a", "fixture-hash", "1", "https://example.com/api/qianchuan/callback");
        expect(await repo.consumeState("user-b", "fixture-hash", "1", "https://example.com/api/qianchuan/callback")).toBe(false);
        expect(await repo.consumeState("user-a", "fixture-hash", "1", "https://example.com/api/qianchuan/callback")).toBe(true);
        expect(await repo.consumeState("user-a", "fixture-hash", "1", "https://example.com/api/qianchuan/callback")).toBe(false);
        await repo.removeUnavailableAccounts("user-a", "user-a", []);
        expect(await repo.accountConnection("user-a", "123")).toBe(null);
        expect(await repo.accountConnection("user-b", "123")).not.toBe(null);
    });
    it("retires only the superseded unused grant on reauthorization", async () => {
        await repo.saveConnection({ id: "replacement", user_id: "user-b", app_id: "1", access_ciphertext: "fixture", refresh_ciphertext: "fixture", expires_at: new Date() });
        await db.query("BEGIN");
        await repo.bindAccount("user-b", "replacement", "123", "Updated");
        await db.query("COMMIT");
        expect(await repo.connection("user-b", "user-b")).toBe(null);
        expect((await repo.accountConnection("user-b", "123"))?.id).toBe("replacement");
    });
    it("does not mix a concurrent committed update into a repeatable read", async () => {
        await repo.bindAccount("user-a", "user-a", "123", "fixture");
        await repo.resetDataset("user-a", q);
        await repo.insertRecords("user-a", q, [{ ...emptyQianchuanMetrics, id: "consistent", name: "Snapshot", kind: "plans", metricScope: "plan", cost: 0.25 }]);
        const writer = new Client({ connectionString: url });
        await writer.connect();
        try {
            await writer.query(`SET search_path TO ${schema}`);
            await db.query("BEGIN");
            await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
            expect((await repo.page("user-a", q)).summary.cost).toBe(0.25);
            await writer.query("UPDATE qianchuan_records SET cost=1.5, payload=jsonb_set(payload,'{cost}','1.5'::jsonb) WHERE user_id='user-a' AND id='consistent'");
            const stable = await repo.page("user-a", q);
            expect(stable.summary.cost).toBe(0.25);
            expect(stable.items[0].cost).toBe(0.25);
            await db.query("COMMIT");
            expect((await repo.page("user-a", q)).summary.cost).toBe(1.5);
        } finally {
            await db.query("ROLLBACK");
            await writer.end();
        }
    });
});
