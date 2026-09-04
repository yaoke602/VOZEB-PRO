import { beforeEach, describe, expect, it, vi } from "vitest";
import { qianchuanQuerySchema } from "@/lib/qianchuan-contract";
const mocks = vi.hoisted(() => ({
    settings: vi.fn(),
    connection: vi.fn(),
    lockConnection: vi.fn(),
    saveConnection: vi.fn(),
    removeUnavailableAccounts: vi.fn(),
    bindAccount: vi.fn(),
    accountConnection: vi.fn(),
    page: vi.fn(),
    datasetError: vi.fn(),
    resetDataset: vi.fn(),
    insertRecords: vi.fn(),
    finishDataset: vi.fn(),
    query: vi.fn(),
    transaction: vi.fn(),
    postgresQuery: vi.fn(),
    transport: vi.fn(),
}));
vi.mock("./database/postgres", () => ({ ensurePostgresSchema: vi.fn(), isPostgresDatabaseEnabled: () => true, postgresQuery: mocks.postgresQuery, withPostgresTransaction: mocks.transaction }));
vi.mock("./database/qianchuan-repository", () => ({
    QianchuanRepository: class {
        constructor() {
            return mocks;
        }
    },
}));
vi.mock("./secret-crypto", () => ({ encryptSecretValue: (v: string) => `enc:${v}`, decryptSecretValue: (v: string) => v.replace(/^enc:/, "") }));
import { qianchuanSettingsSchema, readQianchuanPage, refreshQianchuanAccounts, syncQianchuan } from "./qianchuan-service";

const settings = { appId: "1", secretCiphertext: "enc:fixture", callbackUrl: "https://example.com/api/qianchuan/callback", requestTimeoutSeconds: 60, syncTimeoutSeconds: 600 };
const grant = { id: "new", user_id: "u", app_id: "1", access_ciphertext: "enc:access", refresh_ciphertext: "enc:refresh", expires_at: new Date(Date.now() + 3600000) };
const q = qianchuanQuerySchema.parse({ accountId: "123", kind: "plans", startDate: "2026-09-01", endDate: "2026-09-04" });
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mocks.transport);
    mocks.settings.mockResolvedValue(settings);
    mocks.lockConnection.mockResolvedValue(true);
    mocks.connection.mockResolvedValue(grant);
    mocks.accountConnection.mockResolvedValue(grant);
    mocks.transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn({ query: mocks.query }));
});

describe("Qianchuan service", () => {
    it("does not let a revoked historical grant block newer authorized accounts", async () => {
        mocks.postgresQuery.mockResolvedValue({ rows: [{ id: "old" }, { id: "new" }] });
        mocks.connection.mockResolvedValueOnce({ ...grant, id: "old", expires_at: new Date(0) }).mockResolvedValueOnce(grant);
        mocks.transport.mockResolvedValueOnce(new Response('{"code":40001,"message":"revoked"}')).mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    code: 0,
                    data: {
                        list: [
                            { account_id: "123", account_name: "Current", account_type: "ADVERTISER", is_valid: true },
                            { account_id: "456", account_type: "ADVERTISER", is_valid: false },
                        ],
                    },
                }),
            ),
        );
        await expect(refreshQianchuanAccounts("u")).rejects.toThrow("1 个失败");
        expect(mocks.bindAccount).toHaveBeenCalledWith("u", "new", "123", "Current");
        expect(mocks.bindAccount).toHaveBeenCalledTimes(1);
    });
    it("reads ownership, summary and page within a repeatable read-only snapshot", async () => {
        await readQianchuanPage("u", q);
        expect(mocks.query).toHaveBeenCalledWith("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        expect(mocks.accountConnection).toHaveBeenCalledWith("u", "123");
        expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.page.mock.invocationCallOrder[0]);
    });
    it("rejects another user's account before requesting upstream data", async () => {
        mocks.accountConnection.mockResolvedValue(null);
        await expect(syncQianchuan("other", q)).rejects.toThrow("无权访问");
        expect(mocks.transport).not.toHaveBeenCalled();
    });
    it("does not commit a malformed response as an empty successful dataset", async () => {
        mocks.transport.mockResolvedValue(new Response('{"code":0,"data":{}}'));
        await expect(syncQianchuan("u", q)).rejects.toThrow("未覆盖");
        expect(mocks.finishDataset).not.toHaveBeenCalled();
        expect(mocks.datasetError).toHaveBeenCalledWith("u", q, expect.stringContaining("未覆盖"));
    });
    it("rejects untrusted callback transports and invalid configured timeouts", () => {
        const config = { ...settings, secret: "fixture" };
        expect(qianchuanSettingsSchema.safeParse(config).success).toBe(true);
        expect(qianchuanSettingsSchema.safeParse({ ...config, callbackUrl: "http://example.com/api/qianchuan/callback" }).success).toBe(false);
        expect(qianchuanSettingsSchema.safeParse({ ...config, callbackUrl: "https://example.com/not-callback" }).success).toBe(false);
        expect(qianchuanSettingsSchema.safeParse({ ...config, syncTimeoutSeconds: 601 }).success).toBe(false);
        expect(qianchuanSettingsSchema.safeParse({ ...config, requestTimeoutSeconds: 601 }).success).toBe(false);
    });
});
