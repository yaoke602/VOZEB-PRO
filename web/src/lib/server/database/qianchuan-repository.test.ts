import { describe, expect, it, vi } from "vitest";
import { qianchuanQuerySchema } from "@/lib/qianchuan-contract";
import { QianchuanRepository } from "./qianchuan-repository";
import type { QueryExecutor } from "./postgres";

describe("Qianchuan bounded repository queries", () => {
    it("scopes every page query to user/account/category/date with stable pagination", async () => {
        const responses = [[{ synced_at: null, last_error: null }], [{ total: 0, cost: null, revenue: null, orders: null, impressions: null, clicks: null }], []];
        const query = vi.fn(async (_sql: string, _args?: unknown[]) => ({ rows: responses.shift() || [], rowCount: 1 }));
        const repo = new QianchuanRepository({ query } as unknown as QueryExecutor);
        const q = qianchuanQuerySchema.parse({ accountId: "123", kind: "plans", startDate: "2026-09-01", endDate: "2026-09-04", page: 3, pageSize: 10, keyword: "needle", sort: "cost" });
        const result = await repo.page("user-a", q);
        for (const [sql, args] of query.mock.calls) {
            expect(sql).toContain("user_id=$1 AND account_id=$2 AND kind=$3 AND scope=$4");
            expect(args?.slice(0, 4)).toEqual(["user-a", "123", "plans", "2026-09-01/2026-09-04"]);
        }
        expect(query.mock.calls[2][0]).toContain("ORDER BY cost DESC NULLS LAST,id LIMIT $6 OFFSET $7");
        expect(query.mock.calls[2][1]?.slice(-2)).toEqual([10, 20]);
        expect(result).toMatchObject({ total: 0, items: [], summary: { cost: null, roi: null } });
    });
    it("consumes OAuth state atomically and only for its user/app/callback", async () => {
        const query = vi.fn(async (_sql: string, _args?: unknown[]) => ({ rows: [], rowCount: 0 }));
        const repo = new QianchuanRepository({ query } as unknown as QueryExecutor);
        expect(await repo.consumeState("u", "hash", "app", "https://example.com/api/qianchuan/callback")).toBe(false);
        expect(query.mock.calls[0][0]).toContain("DELETE FROM qianchuan_oauth_states WHERE state_hash=$1 AND user_id=$2 AND app_id=$3 AND callback_url=$4 AND expires_at>now()");
    });
});
