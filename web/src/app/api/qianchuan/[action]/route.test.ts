import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), save: vi.fn(), status: vi.fn(), read: vi.fn(), audit: vi.fn(), ask: vi.fn(), latest: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/server/qianchuan-analysis-service", () => ({ askQianchuan: mocks.ask, latestQianchuanAnalysis: mocks.latest }));
vi.mock("@/lib/server/security", () => ({ checkGenerationRateLimit: mocks.rate }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: () => "http://internal:3000" }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/admin-permissions", async (original) => ({ ...(await original<typeof import("@/lib/admin-permissions")>()), hasAdminPermission: mocks.permission }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: () => ({ userId: "u" }), safeRecordAuditLog: mocks.audit }));
vi.mock("@/lib/server/qianchuan-service", () => ({
    saveQianchuanSettings: mocks.save,
    qianchuanStatus: mocks.status,
    readQianchuanPage: mocks.read,
    completeQianchuanAuthorization: vi.fn(),
    disconnectQianchuan: vi.fn(),
    refreshQianchuanAccounts: vi.fn(),
    startQianchuanAuthorization: vi.fn(),
    syncQianchuan: vi.fn(),
}));
import { GET, POST } from "./route";
const context = (action: string) => ({ params: Promise.resolve({ action }) });
beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: "u" });
    mocks.permission.mockReturnValue(false);
});
describe("Qianchuan route boundary", () => {
    it("passes trusted session context to analysis and enforces text rate limits", async () => {
        mocks.rate.mockResolvedValue({ allowed: true });
        mocks.ask.mockResolvedValue({ answer: "fixture" });
        const request = () => new Request("http://localhost/api/qianchuan/ask", { method: "POST", headers: { "content-type": "application/json", cookie: "session=fixture" }, body: '{"userId":"other"}' });
        expect((await POST(request(), context("ask"))).status).toBe(200);
        expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ userId: "u", cookie: "session=fixture", origin: "http://internal:3000" }), { userId: "other" });
        mocks.rate.mockResolvedValue({ allowed: false });
        expect((await POST(request(), context("ask"))).status).toBe(429);
        expect(mocks.ask).toHaveBeenCalledTimes(1);
        await GET(new Request("http://localhost/api/qianchuan/analysis?accountId=123"), context("analysis"));
        expect(mocks.latest).toHaveBeenCalledWith("u", "123");
    });
    it("requires a current session", async () => {
        mocks.user.mockResolvedValue(null);
        expect((await GET(new Request("http://localhost/api/qianchuan/status"), context("status"))).status).toBe(401);
        expect(mocks.status).not.toHaveBeenCalled();
    });
    it("rejects config changes without system.manage and never audits secret bodies", async () => {
        const response = await POST(new Request("http://localhost/api/qianchuan/settings", { method: "POST", headers: { "content-type": "application/json" }, body: '{"secret":"fixture-secret"}' }), context("settings"));
        expect(response.status).toBe(403);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("fixture-secret");
    });
    it("passes explicit ownership to data service and disables caching", async () => {
        mocks.read.mockResolvedValue({ items: [] });
        const response = await GET(new Request("http://localhost/api/qianchuan/data?accountId=123&kind=plans&startDate=2026-09-01&endDate=2026-09-04"), context("data"));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(mocks.read).toHaveBeenCalledWith("u", expect.objectContaining({ accountId: "123", page: 1, pageSize: 20 }));
    });
    it("does not expose raw database failures", async () => {
        mocks.status.mockRejectedValue(new Error("postgres://secret@internal-db"));
        const response = await GET(new Request("http://localhost/api/qianchuan/status"), context("status"));
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain("internal-db");
    });
});
