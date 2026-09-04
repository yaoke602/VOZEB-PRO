export const POSTGRESQL_QIANCHUAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS qianchuan_settings (
    id text PRIMARY KEY CHECK (id = 'default'), app_id text NOT NULL,
    secret_ciphertext text NOT NULL, callback_url text NOT NULL,
    request_timeout_seconds integer NOT NULL CHECK (request_timeout_seconds > 0),
    sync_timeout_seconds integer NOT NULL CHECK (sync_timeout_seconds >= request_timeout_seconds)
);
CREATE TABLE IF NOT EXISTS qianchuan_oauth_states (
    state_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id text NOT NULL, callback_url text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS qianchuan_connections (
    id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id text NOT NULL, access_ciphertext text NOT NULL, refresh_ciphertext text NOT NULL,
    expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vozeb_pro_qianchuan_connections_owner_idx ON qianchuan_connections(user_id);
CREATE TABLE IF NOT EXISTS qianchuan_accounts (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, id text NOT NULL,
    connection_id text NOT NULL REFERENCES qianchuan_connections(id) ON DELETE CASCADE,
    name text NOT NULL, authorized_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS qianchuan_datasets (
    user_id text NOT NULL, account_id text NOT NULL, kind text NOT NULL, scope text NOT NULL,
    synced_at timestamptz, last_error text,
    PRIMARY KEY(user_id, account_id, kind, scope),
    FOREIGN KEY(user_id, account_id) REFERENCES qianchuan_accounts(user_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS qianchuan_records (
    user_id text NOT NULL, account_id text NOT NULL, kind text NOT NULL, scope text NOT NULL,
    id text NOT NULL, name text NOT NULL, cost numeric, revenue numeric, orders numeric,
    impressions numeric, clicks numeric, roi numeric, payload jsonb NOT NULL,
    PRIMARY KEY(user_id, account_id, kind, scope, id),
    FOREIGN KEY(user_id, account_id, kind, scope) REFERENCES qianchuan_datasets(user_id, account_id, kind, scope) ON DELETE CASCADE
);
`;
