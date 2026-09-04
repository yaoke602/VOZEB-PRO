import type { QianchuanAccount, QianchuanPage, QianchuanQuery, QianchuanRecord, QianchuanSettings } from "@/lib/qianchuan-contract";
import { emptyQianchuanMetrics, qianchuanScope } from "@/lib/qianchuan-contract";
import { postgresQuery, type QueryExecutor } from "./postgres";

export type StoredQianchuanSettings = Omit<QianchuanSettings, "hasSecret"> & { secretCiphertext: string };
export type QianchuanConnection = { id: string; user_id: string; app_id: string; access_ciphertext: string; refresh_ciphertext: string; expires_at: Date };
export class QianchuanRepository {
    constructor(private db: QueryExecutor = { query: postgresQuery }) {}
    async settings(): Promise<StoredQianchuanSettings | null> {
        const { rows } = await this.db.query("SELECT * FROM qianchuan_settings WHERE id='default'");
        const r = rows[0];
        return r ? { appId: r.app_id, secretCiphertext: r.secret_ciphertext, callbackUrl: r.callback_url, requestTimeoutSeconds: r.request_timeout_seconds, syncTimeoutSeconds: r.sync_timeout_seconds } : null;
    }
    async saveSettings(s: StoredQianchuanSettings) {
        await this.db.query(
            `INSERT INTO qianchuan_settings VALUES ('default',$1,$2,$3,$4,$5)
            ON CONFLICT(id) DO UPDATE SET app_id=$1, secret_ciphertext=$2, callback_url=$3, request_timeout_seconds=$4, sync_timeout_seconds=$5`,
            [s.appId, s.secretCiphertext, s.callbackUrl, s.requestTimeoutSeconds, s.syncTimeoutSeconds],
        );
    }
    async accounts(userId: string): Promise<QianchuanAccount[]> {
        const { rows } = await this.db.query("SELECT id,name,connection_id,authorized_at FROM qianchuan_accounts WHERE user_id=$1 ORDER BY name,id", [userId]);
        return rows.map((r) => ({ id: r.id, name: r.name, connectionId: r.connection_id, authorizedAt: new Date(r.authorized_at).toISOString() }));
    }
    async connectionCount(userId: string) {
        const { rows } = await this.db.query("SELECT count(*)::integer AS count FROM qianchuan_connections WHERE user_id=$1", [userId]);
        return rows[0].count as number;
    }
    async accountConnection(userId: string, accountId: string) {
        const { rows } = await this.db.query<QianchuanConnection>(
            `SELECT c.* FROM qianchuan_connections c
            JOIN qianchuan_accounts a ON a.connection_id=c.id AND a.user_id=c.user_id WHERE a.user_id=$1 AND a.id=$2`,
            [userId, accountId],
        );
        return rows[0] || null;
    }
    async connection(userId: string, id: string) {
        const { rows } = await this.db.query<QianchuanConnection>("SELECT * FROM qianchuan_connections WHERE user_id=$1 AND id=$2", [userId, id]);
        return rows[0] || null;
    }
    async lockConnection(id: string) {
        const { rows } = await this.db.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked", [`qianchuan:${id}`]);
        return rows[0].locked === true;
    }
    async saveConnection(c: QianchuanConnection) {
        await this.db.query(
            `INSERT INTO qianchuan_connections(id,user_id,app_id,access_ciphertext,refresh_ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(id) DO UPDATE SET access_ciphertext=$4,refresh_ciphertext=$5,expires_at=$6 WHERE qianchuan_connections.user_id=$2`,
            [c.id, c.user_id, c.app_id, c.access_ciphertext, c.refresh_ciphertext, c.expires_at],
        );
    }
    async bindAccount(userId: string, connectionId: string, id: string, name: string) {
        const previous = (await this.db.query("SELECT connection_id FROM qianchuan_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE", [userId, id])).rows[0]?.connection_id;
        await this.db.query(
            `INSERT INTO qianchuan_accounts(user_id,id,connection_id,name) VALUES($1,$2,$3,$4)
            ON CONFLICT(user_id,id) DO UPDATE SET connection_id=$3,name=$4,authorized_at=now()`,
            [userId, id, connectionId, name],
        );
        // Reauthorization replaces a grant; retire only the displaced, now-unused grant.
        if (previous && previous !== connectionId) await this.db.query("DELETE FROM qianchuan_connections c WHERE c.user_id=$1 AND c.id=$2 AND NOT EXISTS(SELECT 1 FROM qianchuan_accounts a WHERE a.connection_id=c.id)", [userId, previous]);
    }
    async removeUnavailableAccounts(userId: string, connectionId: string, ids: string[]) {
        await this.db.query("DELETE FROM qianchuan_accounts WHERE user_id=$1 AND connection_id=$2 AND NOT (id=ANY($3::text[]))", [userId, connectionId, ids]);
    }
    async createState(userId: string, hash: string, appId: string, callback: string) {
        await this.db.query("DELETE FROM qianchuan_oauth_states WHERE expires_at < now() OR user_id=$1", [userId]);
        // Ten-minute, single-use OAuth security window; unrelated to provider query timing.
        await this.db.query("INSERT INTO qianchuan_oauth_states VALUES($1,$2,$3,$4,now()+interval '10 minutes')", [hash, userId, appId, callback]);
    }
    async consumeState(userId: string, hash: string, appId: string, callback: string) {
        const r = await this.db.query("DELETE FROM qianchuan_oauth_states WHERE state_hash=$1 AND user_id=$2 AND app_id=$3 AND callback_url=$4 AND expires_at>now() RETURNING state_hash", [hash, userId, appId, callback]);
        return Boolean(r.rowCount);
    }
    async datasetError(userId: string, q: QianchuanQuery, error: string) {
        await this.db.query(
            `INSERT INTO qianchuan_datasets(user_id,account_id,kind,scope,last_error) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(user_id,account_id,kind,scope) DO UPDATE SET last_error=$5`,
            [userId, q.accountId, q.kind, qianchuanScope(q), error],
        );
    }
    async resetDataset(userId: string, q: QianchuanQuery) {
        const args = [userId, q.accountId, q.kind, qianchuanScope(q)];
        await this.db.query("INSERT INTO qianchuan_datasets(user_id,account_id,kind,scope) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", args);
        await this.db.query("DELETE FROM qianchuan_records WHERE user_id=$1 AND account_id=$2 AND kind=$3 AND scope=$4", args);
    }
    async insertRecords(userId: string, q: QianchuanQuery, records: QianchuanRecord[]) {
        if (!records.length) return;
        await this.db.query(
            `INSERT INTO qianchuan_records(user_id,account_id,kind,scope,id,name,cost,revenue,orders,impressions,clicks,roi,payload)
            SELECT $1,$2,$3,$4,r->>'id',r->>'name',(r->>'cost')::numeric,(r->>'revenue')::numeric,
            (r->>'orders')::numeric,(r->>'impressions')::numeric,(r->>'clicks')::numeric,(r->>'roi')::numeric,r FROM jsonb_array_elements($5::jsonb) r
            ON CONFLICT(user_id,account_id,kind,scope,id) DO UPDATE SET name=EXCLUDED.name,cost=EXCLUDED.cost,revenue=EXCLUDED.revenue,
            orders=EXCLUDED.orders,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,roi=EXCLUDED.roi,payload=EXCLUDED.payload`,
            [userId, q.accountId, q.kind, qianchuanScope(q), JSON.stringify(records)],
        );
    }
    async finishDataset(userId: string, q: QianchuanQuery) {
        await this.db.query("UPDATE qianchuan_datasets SET synced_at=now(),last_error=NULL WHERE user_id=$1 AND account_id=$2 AND kind=$3 AND scope=$4", [userId, q.accountId, q.kind, qianchuanScope(q)]);
    }
    async page(userId: string, q: QianchuanQuery): Promise<QianchuanPage> {
        const scopeArgs = [userId, q.accountId, q.kind, qianchuanScope(q)];
        const dataset = (await this.db.query("SELECT synced_at,last_error FROM qianchuan_datasets WHERE user_id=$1 AND account_id=$2 AND kind=$3 AND scope=$4", scopeArgs)).rows[0];
        const where = "user_id=$1 AND account_id=$2 AND kind=$3 AND scope=$4 AND ($5='' OR strpos(lower(name),lower($5))>0 OR id=$5)";
        const args = [...scopeArgs, q.keyword];
        // Partial metrics remain null instead of silently summing an incomplete field.
        const summary = (
            await this.db.query(
                `SELECT count(*)::integer AS total,
            CASE WHEN count(cost)=count(*) THEN sum(cost) END AS cost,
            CASE WHEN count(revenue)=count(*) THEN sum(revenue) END AS revenue,
            CASE WHEN count(orders)=count(*) THEN sum(orders) END AS orders,
            CASE WHEN count(impressions)=count(*) THEN sum(impressions) END AS impressions,
            CASE WHEN count(clicks)=count(*) THEN sum(clicks) END AS clicks FROM qianchuan_records WHERE ${where}`,
                args,
            )
        ).rows[0];
        const order = q.sort === "name" ? "name ASC" : `${q.sort} DESC NULLS LAST`;
        const records = await this.db.query(`SELECT payload FROM qianchuan_records WHERE ${where} ORDER BY ${order},id LIMIT $6 OFFSET $7`, [...args, q.pageSize, (q.page - 1) * q.pageSize]);
        const metrics = { ...emptyQianchuanMetrics };
        for (const key of ["cost", "revenue", "orders", "impressions", "clicks"] as const) metrics[key] = summary[key] === null ? null : Number(summary[key]);
        metrics.roi = metrics.cost && metrics.revenue !== null ? metrics.revenue / metrics.cost : null;
        const trend = q.kind === "overview" ? (await this.db.query(`SELECT payload FROM qianchuan_records WHERE ${where} ORDER BY id`, args)).rows.map((r) => r.payload as QianchuanRecord) : [];
        return {
            items: records.rows.map((r) => r.payload),
            total: summary.total,
            page: q.page,
            pageSize: q.pageSize,
            summary: metrics,
            trend,
            lastSyncedAt: dataset?.synced_at ? new Date(dataset.synced_at).toISOString() : null,
            error: dataset?.last_error || null,
        };
    }
}
