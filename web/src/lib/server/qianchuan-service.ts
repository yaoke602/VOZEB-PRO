import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { QianchuanQuery, QianchuanStatus } from "@/lib/qianchuan-contract";
import { ensurePostgresSchema, isPostgresDatabaseEnabled, postgresQuery, withPostgresTransaction } from "./database/postgres";
import { QianchuanRepository, type QianchuanConnection, type StoredQianchuanSettings } from "./database/qianchuan-repository";
import { decryptSecretValue, encryptSecretValue } from "./secret-crypto";
import { normalizeQianchuanRecord, numeric, objects, QianchuanApi, QianchuanError, resourceRequest, shopAccountRows, text, type PlatformObject } from "./qianchuan-provider";

const repository = new QianchuanRepository();
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
export const qianchuanSettingsSchema = z
    .object({
        appId: z.string().regex(/^\d+$/, "App ID 必须是数字"),
        secret: z.string().trim().default(""),
        callbackUrl: z.url().refine((v) => {
            const u = new URL(v);
            return (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/api/qianchuan/callback";
        }, "填写站点的 /api/qianchuan/callback 地址，公网必须使用 HTTPS"),
        requestTimeoutSeconds: z.number().int().positive(),
        syncTimeoutSeconds: z.number().int().positive().max(600),
    })
    .refine((v) => v.syncTimeoutSeconds >= v.requestTimeoutSeconds, "同步超时不能小于单次请求超时");

async function ready() {
    if (!isPostgresDatabaseEnabled()) throw new QianchuanError("真实千川数据接入需要 PostgreSQL；当前可体验演示模式", 409);
    await ensurePostgresSchema();
}
async function requiredSettings() {
    await ready();
    const settings = await repository.settings();
    if (!settings) throw new QianchuanError("请先由管理员配置千川应用", 409);
    return settings;
}
export async function qianchuanStatus(userId: string, canConfigure: boolean): Promise<QianchuanStatus> {
    if (!isPostgresDatabaseEnabled()) return { configured: false, postgres: false, accounts: [], connectionCount: 0 };
    await ready();
    const [settings, accounts, connectionCount] = await Promise.all([repository.settings(), repository.accounts(userId), repository.connectionCount(userId)]);
    return {
        configured: Boolean(settings),
        postgres: true,
        accounts,
        connectionCount,
        ...(canConfigure && settings
            ? { settings: { appId: settings.appId, hasSecret: Boolean(settings.secretCiphertext), callbackUrl: settings.callbackUrl, requestTimeoutSeconds: settings.requestTimeoutSeconds, syncTimeoutSeconds: settings.syncTimeoutSeconds } }
            : {}),
    };
}
export async function saveQianchuanSettings(value: unknown) {
    await ready();
    const parsed = qianchuanSettingsSchema.safeParse(value);
    if (!parsed.success) throw new QianchuanError(parsed.error.issues[0].message);
    const input = parsed.data,
        previous = await repository.settings();
    const secretCiphertext = input.secret ? encryptSecretValue(input.secret) : previous?.appId === input.appId ? previous.secretCiphertext : "";
    if (!secretCiphertext) throw new QianchuanError("首次配置或更换 App ID 时必须填写 App Secret");
    await repository.saveSettings({ appId: input.appId, secretCiphertext, callbackUrl: input.callbackUrl, requestTimeoutSeconds: input.requestTimeoutSeconds, syncTimeoutSeconds: input.syncTimeoutSeconds });
}
export async function startQianchuanAuthorization(userId: string) {
    const settings = await requiredSettings(),
        state = randomBytes(32).toString("base64url");
    await repository.createState(userId, hashState(state), settings.appId, settings.callbackUrl);
    const url = new URL("https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html");
    url.search = new URLSearchParams({ app_id: settings.appId, state, material_auth: "1", redirect_uri: settings.callbackUrl }).toString();
    return url.href;
}
function tokenConnection(userId: string, id: string, appId: string, data: PlatformObject, previousRefresh = ""): QianchuanConnection {
    const token = text(data.access_token),
        refresh = text(data.refresh_token) || previousRefresh,
        expires = numeric(data.expires_in);
    if (!token || !refresh || !expires || expires <= 0) throw new QianchuanError("千川未返回有效的授权令牌或有效期，请重新授权", 502);
    return { id, user_id: userId, app_id: appId, access_ciphertext: encryptSecretValue(token), refresh_ciphertext: encryptSecretValue(refresh), expires_at: new Date(Date.now() + expires * 1000) };
}
export async function completeQianchuanAuthorization(userId: string, state: string, code: string) {
    const settings = await requiredSettings();
    if (!state || !code || !(await repository.consumeState(userId, hashState(state), settings.appId, settings.callbackUrl))) throw new QianchuanError("授权链接已失效或不属于当前用户，请重新发起授权");
    const api = new QianchuanApi("", settings.requestTimeoutSeconds);
    const result = await api.request("/open_api/oauth2/access_token/", { app_id: settings.appId, secret: decryptSecretValue(settings.secretCiphertext), auth_code: code }, "POST");
    const connection = tokenConnection(userId, randomUUID(), settings.appId, result);
    // Persist rotated credentials before discovery; an account-list failure must not discard a valid grant.
    await repository.saveConnection(connection);
    await discoverAccounts(connection, settings);
}
async function activeConnection(userId: string, id: string, settings: StoredQianchuanSettings) {
    return withPostgresTransaction(async (db) => {
        const repo = new QianchuanRepository(db);
        if (!(await repo.lockConnection(id))) throw new QianchuanError("该授权正在同步，请稍后再试", 409);
        const connection = await repo.connection(userId, id);
        if (!connection) throw new QianchuanError("授权不存在", 404);
        if (connection.app_id !== settings.appId) throw new QianchuanError("应用配置已更换，请重新授权", 409);
        if (new Date(connection.expires_at).getTime() > Date.now() + settings.requestTimeoutSeconds * 1000) return connection;
        const refreshed = await new QianchuanApi("", settings.requestTimeoutSeconds).request(
            "/open_api/oauth2/refresh_token/",
            {
                app_id: settings.appId,
                secret: decryptSecretValue(settings.secretCiphertext),
                refresh_token: decryptSecretValue(connection.refresh_ciphertext),
            },
            "POST",
        );
        const next = tokenConnection(userId, id, settings.appId, refreshed, decryptSecretValue(connection.refresh_ciphertext));
        await repo.saveConnection(next);
        return next;
    });
}
async function discoverAccounts(connection: QianchuanConnection, settings: StoredQianchuanSettings) {
    const api = new QianchuanApi(decryptSecretValue(connection.access_ciphertext), settings.requestTimeoutSeconds, AbortSignal.timeout(settings.syncTimeoutSeconds * 1000));
    const data = await api.request("/open_api/oauth2/advertiser/get/", {}, "GET", true);
    if (!Array.isArray(data.list)) throw new QianchuanError("未读取到授权账户列表，请检查应用权限", 502);
    const accounts = new Map<string, string>();
    for (const row of objects(data.list)) {
        if (row.is_valid === false) continue;
        const id = text(row.account_id) || text(row.advertiser_id),
            type = text(row.account_type) || text(row.account_role);
        if (!/^\d+$/.test(id)) continue;
        if (type === "ADVERTISER" || type === "QIANCHUAN") accounts.set(id, text(row.account_name) || text(row.advertiser_name) || `千川账户 ${id}`);
        else if (type === "PLATFORM_ROLE_SHOP_ACCOUNT") {
            for await (const shops of api.pages("/open_api/v1.0/qianchuan/shop/advertiser/list/", { shop_id: id, page_size: 100 }, shopAccountRows)) {
                for (const shop of shops) {
                    const adv = text(shop.account_id);
                    if (/^\d+$/.test(adv)) accounts.set(adv, `千川账户 ${adv}`);
                }
            }
        } else if (type === "CUSTOMER_ADMIN" || type === "CUSTOMER_OPERATOR") {
            for await (const children of api.pages("/open_api/v3.0/customer_center/account/list/", { account_id: id, filter: { account_type: "QIANCHUAN" }, page_size: 100 }, "accounts")) {
                for (const child of children) if (child.account_type === "QIANCHUAN" && /^\d+$/.test(text(child.account_id))) accounts.set(text(child.account_id), text(child.account_name) || `千川账户 ${text(child.account_id)}`);
            }
        }
    }
    await withPostgresTransaction(async (db) => {
        const repo = new QianchuanRepository(db);
        await repo.removeUnavailableAccounts(connection.user_id, connection.id, [...accounts.keys()]);
        for (const [id, name] of accounts) await repo.bindAccount(connection.user_id, connection.id, id, name);
    });
    if (!accounts.size) throw new QianchuanError("授权已保存，但尚未找到可读取的千川投放账户。请检查账户类型及权限后刷新授权账户", 409);
}
export async function refreshQianchuanAccounts(userId: string) {
    const settings = await requiredSettings();
    const { rows } = await postgresQuery("SELECT id FROM qianchuan_connections WHERE user_id=$1 AND app_id=$2 ORDER BY created_at", [userId, settings.appId]);
    const failures: string[] = [];
    for (const row of rows) {
        try {
            await discoverAccounts(await activeConnection(userId, row.id, settings), settings);
        } catch (error) {
            failures.push(error instanceof QianchuanError ? error.message : "授权读取失败");
        }
    }
    if (failures.length) throw new QianchuanError(`已尝试刷新全部授权，其中 ${failures.length} 个失败：${[...new Set(failures)].join("；")}`, 409);
}
export async function disconnectQianchuan(userId: string, accountId: string) {
    await ready();
    // Remove the selected local account and its snapshots, not any upstream advertising entity.
    await postgresQuery("DELETE FROM qianchuan_accounts WHERE user_id=$1 AND id=$2", [userId, accountId]);
    await postgresQuery("DELETE FROM qianchuan_connections c WHERE user_id=$1 AND NOT EXISTS(SELECT 1 FROM qianchuan_accounts a WHERE a.connection_id=c.id)", [userId]);
}
export async function readQianchuanPage(userId: string, q: QianchuanQuery) {
    await ready();
    return withPostgresTransaction(async (db) => {
        // Metadata, totals, page and chart must observe the same committed snapshot.
        await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const repo = new QianchuanRepository(db);
        if (!(await repo.accountConnection(userId, q.accountId))) throw new QianchuanError("无权访问该千川账户", 404);
        return repo.page(userId, q);
    });
}
export async function syncQianchuan(userId: string, q: QianchuanQuery) {
    const settings = await requiredSettings();
    const grant = await repository.accountConnection(userId, q.accountId);
    if (!grant) throw new QianchuanError("无权访问该千川账户", 404);
    const connection = await activeConnection(userId, grant.id, settings);
    try {
        await withPostgresTransaction(async (db) => {
            const repo = new QianchuanRepository(db);
            if (!(await repo.lockConnection(connection.id))) throw new QianchuanError("该授权正在同步，请勿重复提交", 409);
            const api = new QianchuanApi(decryptSecretValue(connection.access_ciphertext), settings.requestTimeoutSeconds, AbortSignal.timeout(settings.syncTimeoutSeconds * 1000));
            const request = resourceRequest(q);
            await repo.resetDataset(userId, q);
            for await (const rows of api.pages(request.path, request.params, request.list))
                await repo.insertRecords(
                    userId,
                    q,
                    rows.map((r) => normalizeQianchuanRecord(q.kind, r)),
                );
            await repo.finishDataset(userId, q);
        });
    } catch (error) {
        if (error instanceof QianchuanError && error.status !== 409) await repository.datasetError(userId, q, error.message);
        throw error;
    }
    return readQianchuanPage(userId, q);
}
