# Debian One-Command Source Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually triggered Debian 12 deployment command that fast-forwards to the latest approved GitHub commit, builds an immutable local image, backs up production state, updates App and Worker, verifies health, and restores the previous image configuration on failure.

**Architecture:** Keep `docker-compose.yml` image-driven and put production orchestration in one Bash script so PostgreSQL and named volumes remain independent from application builds. Exercise safety behavior with a Vitest contract test that reads the script as an artifact, then validate Bash syntax and Docker Compose resolution separately. Extend the existing deployment guide with first-use and routine-update commands.

**Tech Stack:** Bash 5, Git, Docker Engine, Docker Compose v2, PostgreSQL 16.6 tools inside the database container, curl, util-linux `flock`, Node.js/Vitest contract tests, Debian 12

> **Implementation status (2026-08-20):** The plan was executed, then hardened after production review. The final script additionally separates first-install status from readiness, verifies a new Worker heartbeat, fails closed on unknown deployed versions, gives forced rebuilds unique tags, rejects Compose topology changes, verifies persistent identities and `.env` permissions, and excludes `backups/` from the Docker context. Treat the committed script, behavior tests, design, and `DEPLOY-GUIDE.md` as the final source of truth rather than copying the incremental code snippets below.

---

## File map

- Create `scripts/deploy-debian.sh`: production CLI, preflight checks, fast-forward update, immutable image build, backup, staged switch, health checks, and rollback.
- Create `web/scripts/deploy-debian-contract.test.mjs`: static safety and workflow contract for the deploy script; it never reads `.env` values.
- Modify `DEPLOY-GUIDE.md`: server-side source build, first use, routine use, version gate, logs, rollback boundaries, and data preservation.
- Read `docs/superpowers/specs/2026-08-20-debian-one-command-source-deploy-design.md`: source of truth for behavior and exclusions.

### Task 1: Establish the deployment safety contract

**Files:**
- Create: `web/scripts/deploy-debian-contract.test.mjs`
- Test: `web/scripts/deploy-debian-contract.test.mjs`

- [ ] **Step 1: Write the failing script contract test**

Create `web/scripts/deploy-debian-contract.test.mjs` with:

```javascript
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const scriptPath = path.join(repoRoot, "scripts", "deploy-debian.sh");

function scriptSource() {
    expect(existsSync(scriptPath), "scripts/deploy-debian.sh must exist").toBe(true);
    return readFileSync(scriptPath, "utf8");
}

describe("Debian source deployment contract", () => {
    it("uses strict Bash execution, a private umask, and an exclusive deployment lock", () => {
        const source = scriptSource();
        expect(source).toMatch(/^#!\/usr\/bin\/env bash/m);
        expect(source).toContain("set -Eeuo pipefail");
        expect(source).toContain("umask 077");
        expect(source).toContain("flock -n");
        expect(source).toContain("/var/lock/vozeb-pro-deploy.lock");
    });

    it("does not contain destructive volume or broad cleanup commands", () => {
        const source = scriptSource();
        expect(source).not.toMatch(/docker\s+compose\s+down\s+[^\n]*-v/);
        expect(source).not.toMatch(/docker\s+volume\s+(rm|prune)/);
        expect(source).not.toMatch(/docker\s+image\s+prune\s+[^\n]*-a/);
        expect(source).not.toMatch(/rm\s+-rf/);
    });
});
```

- [ ] **Step 2: Run the contract test and confirm the missing-script failure**

Run:

```powershell
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
```

Expected: FAIL with `scripts/deploy-debian.sh must exist`. Keep the failing test uncommitted until Task 2 supplies the minimal implementation.

### Task 2: Add CLI parsing and production preflight checks

**Files:**
- Create: `scripts/deploy-debian.sh`
- Test: `web/scripts/deploy-debian-contract.test.mjs`

- [ ] **Step 1: Create the executable Bash entry point and preflight functions**

Create `scripts/deploy-debian.sh` with:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROJECT_ROOT="/opt/vozeb-pro"
readonly DEPLOY_REMOTE="origin"
readonly DEPLOY_BRANCH="main_yao_20260820"
readonly BACKUP_ROOT="${PROJECT_ROOT}/backups"
readonly LOCK_FILE="/var/lock/vozeb-pro-deploy.lock"
readonly LOG_FILE="/var/log/vozeb-pro-deploy.log"

ALLOW_VERSION_CHANGE=0
FORCE_BUILD=0
DRY_RUN=0
BACKUP_DIR=""
OLD_COMMIT=""
TARGET_COMMIT=""
TARGET_VERSION=""
TARGET_SHA=""
TARGET_IMAGE=""
OLD_IMAGE=""

usage() {
    printf '%s\n' \
        "Usage: sudo ./scripts/deploy-debian.sh [options]" \
        "" \
        "Options:" \
        "  --allow-version-change  Continue after reviewing VERSION and database compatibility" \
        "  --force-build           Build even when origin has no new commit" \
        "  --dry-run               Run read-only checks and show the planned action" \
        "  --help                  Show this help"
}

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

parse_args() {
    while (($#)); do
        case "$1" in
            --allow-version-change) ALLOW_VERSION_CHANGE=1 ;;
            --force-build) FORCE_BUILD=1 ;;
            --dry-run) DRY_RUN=1 ;;
            --help) usage; exit 0 ;;
            *) usage >&2; die "Unknown option: $1" ;;
        esac
        shift
    done
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"; }

read_env_value() {
    local key="$1"
    awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' .env
}

setup_mutating_run() {
    [[ ${EUID} -eq 0 ]] || die "Run the deployment with sudo"
    install -d -m 700 "$BACKUP_ROOT"
    touch "$LOG_FILE"
    chmod 600 "$LOG_FILE"
    exec > >(tee -a "$LOG_FILE") 2>&1
    exec 9>"$LOCK_FILE"
    flock -n 9 || die "Another VOZEB PRO deployment is running"
}

preflight() {
    local command current_root current_branch
    for command in git docker curl flock realpath awk sha256sum; do require_command "$command"; done
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable"
    current_root="$(realpath "$PWD")"
    [[ "$current_root" == "$PROJECT_ROOT" ]] || die "Run from $PROJECT_ROOT"
    [[ -f .env ]] || die "Production .env is missing"
    [[ -r VERSION ]] || die "VERSION is missing"
    [[ -r docker-compose.yml ]] || die "docker-compose.yml is missing"
    current_branch="$(git branch --show-current)"
    [[ "$current_branch" == "$DEPLOY_BRANCH" ]] || die "Expected branch $DEPLOY_BRANCH, got $current_branch"
    git remote get-url "$DEPLOY_REMOTE" >/dev/null 2>&1 || die "Git remote $DEPLOY_REMOTE is missing"
    git diff-index --quiet HEAD -- || die "Tracked files contain uncommitted changes"
    [[ -n "$(read_env_value VOZEB_PRO_IMAGE)" ]] || die "VOZEB_PRO_IMAGE is missing from .env"
    docker compose config --quiet
}

main() {
    parse_args "$@"
    if ((DRY_RUN == 0)); then setup_mutating_run; fi
    preflight
    log "Preflight checks passed for ${DEPLOY_REMOTE}/${DEPLOY_BRANCH}"
    if ((DRY_RUN == 1)); then
        log "Dry run complete; no Git, Docker, .env, or backup state was changed"
    fi
}

main "$@"
```

- [ ] **Step 2: Record the executable bit and run the safety contract**

```powershell
git update-index --add --chmod=+x scripts/deploy-debian.sh
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
```

Expected: both current safety tests pass.

- [ ] **Step 3: Commit the preflight slice**

```powershell
git diff --check -- scripts/deploy-debian.sh
git add -- scripts/deploy-debian.sh web/scripts/deploy-debian-contract.test.mjs
git commit -m "feat: add Debian deploy preflight"
```

Expected: executable mode `100755` is recorded.

### Task 3: Implement fast-forward update, version gate, and immutable build

**Files:**
- Modify: `scripts/deploy-debian.sh`
- Test: `web/scripts/deploy-debian-contract.test.mjs`

- [ ] **Step 1: Extend the contract with source-update and image-build requirements**

Insert these tests before the closing `});` in `web/scripts/deploy-debian-contract.test.mjs`:

```javascript
    it("only accepts a fast-forward from the fixed production branch", () => {
        const source = scriptSource();
        expect(source).toContain('DEPLOY_REMOTE="origin"');
        expect(source).toContain('DEPLOY_BRANCH="main_yao_20260820"');
        expect(source).toContain('git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"');
        expect(source).toContain("git merge-base --is-ancestor");
        expect(source).toContain('git merge --ff-only "$DEPLOY_REMOTE/$DEPLOY_BRANCH"');
        expect(source).not.toMatch(/git\s+(reset\s+--hard|checkout\s+--force|clean\s+-f)/);
    });

    it("builds a local immutable image, gates VERSION changes, and can resume an interrupted release", () => {
        const source = scriptSource();
        expect(source).toContain("--allow-version-change");
        expect(source).toContain("--force-build");
        expect(source).toContain('TARGET_IMAGE="vozeb-pro:${TARGET_VERSION}-${TARGET_SHA}"');
        expect(source).toContain('"$OLD_IMAGE" == "$TARGET_IMAGE"');
        expect(source).toContain('docker image inspect "$TARGET_IMAGE"');
        expect(source).toContain("docker build");
        expect(source).toContain("DEBIAN_MIRROR=http://mirrors.aliyun.com/debian");
        expect(source).toContain("DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security");
    });
```

- [ ] **Step 2: Run the new contract and verify it fails**

```powershell
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
```

Expected: the two new tests fail because fetch, fast-forward, version identity, and build functions are absent.

- [ ] **Step 3: Add Git update and target image functions before `main`**

Insert:

```bash
fetch_target() {
    OLD_COMMIT="$(git rev-parse HEAD)"
    git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"
    TARGET_COMMIT="$(git rev-parse "$DEPLOY_REMOTE/$DEPLOY_BRANCH")"
    git merge-base --is-ancestor "$OLD_COMMIT" "$TARGET_COMMIT" || die "Remote update is not a fast-forward"
}

fast_forward_source() {
    if [[ "$OLD_COMMIT" == "$TARGET_COMMIT" ]]; then
        log "Source is already at ${TARGET_COMMIT}"
        return
    fi
    git merge --ff-only "$DEPLOY_REMOTE/$DEPLOY_BRANCH"
    [[ "$(git rev-parse HEAD)" == "$TARGET_COMMIT" ]] || die "HEAD does not match the fetched target"
}

prepare_image_identity() {
    local deployed_version=""
    TARGET_VERSION="$(tr -d '[:space:]' < VERSION)"
    [[ "$TARGET_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "VERSION cannot be used in a Docker tag"
    TARGET_SHA="$(git rev-parse --short=12 HEAD)"
    TARGET_IMAGE="vozeb-pro:${TARGET_VERSION}-${TARGET_SHA}"
    OLD_IMAGE="$(read_env_value VOZEB_PRO_IMAGE)"
    if [[ "$OLD_IMAGE" =~ ^vozeb-pro:([^-]+)-[0-9a-f]{7,40}$ ]]; then
        deployed_version="${BASH_REMATCH[1]}"
    fi
    if [[ -n "$deployed_version" && "$deployed_version" != "$TARGET_VERSION" && $ALLOW_VERSION_CHANGE -ne 1 ]]; then
        die "VERSION changed from ${deployed_version} to ${TARGET_VERSION}; review CHANGELOG.md and rerun with --allow-version-change"
    fi
}

build_target_image() {
    if docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1 && ((FORCE_BUILD == 0)); then
        log "Reusing existing local image ${TARGET_IMAGE}"
        return
    fi
    docker build \
        --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian \
        --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security \
        --tag "$TARGET_IMAGE" \
        .
    docker image inspect "$TARGET_IMAGE" >/dev/null
}
```

- [ ] **Step 4: Replace `main` with the flow through the build boundary**

```bash
main() {
    parse_args "$@"
    if ((DRY_RUN == 0)); then setup_mutating_run; fi
    preflight
    if ((DRY_RUN == 1)); then
        log "Would fetch ${DEPLOY_REMOTE}/${DEPLOY_BRANCH}, enforce fast-forward history, build an immutable image, back up production, and update App then Worker"
        log "Dry run complete; no Git, Docker, .env, or backup state was changed"
        return
    fi
    fetch_target
    fast_forward_source
    prepare_image_identity
    if [[ "$OLD_COMMIT" == "$TARGET_COMMIT" && "$OLD_IMAGE" == "$TARGET_IMAGE" && $FORCE_BUILD -eq 0 ]] && docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1; then
        log "Source and deployed image already match ${TARGET_IMAGE}; skipping build and deployment"
        ensure_current_services
        return
    fi
    log "Building ${TARGET_IMAGE} from ${TARGET_COMMIT}"
    build_target_image
    create_backup
    deploy_target
    log "Deployment succeeded: ${TARGET_IMAGE}"
}
```

The next task defines the three workflow functions referenced here. This intermediate state is intentionally not ready for production execution.

- [ ] **Step 5: Run the focused test and confirm the source/build contract passes**

```powershell
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
```

Expected: all tests currently present pass.

- [ ] **Step 6: Commit the source-update and build slice**

```powershell
git diff --check -- scripts/deploy-debian.sh
git add -- scripts/deploy-debian.sh web/scripts/deploy-debian-contract.test.mjs
git commit -m "feat: build immutable server images"
```

### Task 4: Implement backup, health checks, staged switch, and rollback

**Files:**
- Modify: `scripts/deploy-debian.sh`
- Test: `web/scripts/deploy-debian-contract.test.mjs`

- [ ] **Step 1: Extend the contract with backup, staged switch, and rollback requirements**

Insert these tests before the closing `});` in `web/scripts/deploy-debian-contract.test.mjs`:

```javascript
    it("backs up PostgreSQL and production configuration before switching images", () => {
        const source = scriptSource();
        expect(source).toContain("pg_dump --format=custom --create");
        expect(source).toContain('cp --preserve=mode .env "$BACKUP_DIR/.env"');
        expect(source).toContain("sha256sum");
        expect(source).toContain('test -s "$BACKUP_DIR/postgres.dump"');
    });

    it("updates App before Worker, verifies both health endpoints, and can restore the old image", () => {
        const source = scriptSource();
        const appSwitch = source.indexOf("--force-recreate app");
        const workerSwitch = source.indexOf("--force-recreate generation-worker");
        expect(appSwitch).toBeGreaterThan(-1);
        expect(workerSwitch).toBeGreaterThan(appSwitch);
        expect(source).toContain("--pull never");
        expect(source).toContain("/api/health/live");
        expect(source).toContain("/api/health/ready");
        expect(source).toContain("rollback_deployment");
        expect(source).toContain('cp --preserve=mode "$BACKUP_DIR/.env" .env');
    });
```

- [ ] **Step 2: Run the new contract and verify it fails**

```powershell
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
```

Expected: the new backup and deployment tests fail while safety and source-build tests still pass.

- [ ] **Step 3: Add container and HTTP health helpers before `main`**

```bash
wait_for_service_health() {
    local service="$1" timeout_seconds="$2" deadline container_id status
    deadline=$((SECONDS + timeout_seconds))
    while ((SECONDS < deadline)); do
        container_id="$(docker compose ps -q "$service")"
        if [[ -n "$container_id" ]]; then
            status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
            if [[ "$status" == "healthy" || "$status" == "running" ]]; then return 0; fi
            [[ "$status" != "unhealthy" && "$status" != "exited" && "$status" != "dead" ]] || return 1
        fi
        sleep 3
    done
    return 1
}

wait_for_http() {
    local path="$1" timeout_seconds="$2" deadline
    deadline=$((SECONDS + timeout_seconds))
    while ((SECONDS < deadline)); do
        if curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:3000${path}" >/dev/null; then return 0; fi
        sleep 3
    done
    return 1
}

ensure_current_services() {
    docker compose up -d --pull never
    wait_for_service_health postgres 120 || die "PostgreSQL did not become healthy"
    wait_for_service_health app 180 || die "App did not become healthy"
    wait_for_http /api/health/live 60 || die "Live health endpoint failed"
    wait_for_http /api/health/ready 60 || die "Ready health endpoint failed"
    docker compose ps
}
```

- [ ] **Step 4: Add the verified production backup function**

```bash
create_backup() {
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_DIR="${BACKUP_ROOT}/${stamp}"
    install -d -m 700 "$BACKUP_DIR"
    docker compose up -d postgres
    wait_for_service_health postgres 120 || die "PostgreSQL did not become healthy for backup"
    docker compose exec -T postgres sh -c 'pg_dump --format=custom --create -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP_DIR/postgres.dump"
    test -s "$BACKUP_DIR/postgres.dump" || die "PostgreSQL backup is empty"
    cp --preserve=mode .env "$BACKUP_DIR/.env"
    cp VERSION CHANGELOG.md docker-compose.yml "$BACKUP_DIR/"
    git show "${OLD_COMMIT}:docker-compose.yml" > "$BACKUP_DIR/docker-compose.previous.yml"
    {
        printf 'OLD_COMMIT=%s\n' "$OLD_COMMIT"
        printf 'TARGET_COMMIT=%s\n' "$TARGET_COMMIT"
        printf 'OLD_IMAGE=%s\n' "$OLD_IMAGE"
        printf 'TARGET_IMAGE=%s\n' "$TARGET_IMAGE"
        docker inspect vozeb-pro --format 'OLD_CONTAINER_IMAGE_ID={{.Image}}' 2>/dev/null || true
    } > "$BACKUP_DIR/deployment.txt"
    (
        cd "$BACKUP_DIR"
        sha256sum postgres.dump .env VERSION CHANGELOG.md docker-compose.yml docker-compose.previous.yml deployment.txt > SHA256SUMS
    )
    chmod 600 "$BACKUP_DIR/.env" "$BACKUP_DIR/postgres.dump" "$BACKUP_DIR/deployment.txt" "$BACKUP_DIR/SHA256SUMS"
    log "Verified backup: ${BACKUP_DIR}"
}
```

- [ ] **Step 5: Add atomic `.env` selection and rollback functions**

```bash
set_image_in_env() {
    local image="$1" temp_env
    temp_env="$(mktemp "${PROJECT_ROOT}/.env.deploy.XXXXXX")"
    awk -v image="$image" '
        BEGIN { written=0 }
        /^VOZEB_PRO_IMAGE=/ {
            if (!written) print "VOZEB_PRO_IMAGE=" image
            written=1
            next
        }
        { print }
        END { if (!written) print "VOZEB_PRO_IMAGE=" image }
    ' .env > "$temp_env"
    chmod --reference=.env "$temp_env"
    if ! docker compose --env-file "$temp_env" config --quiet; then
        rm -f "$temp_env"
        die "Candidate .env does not produce a valid Compose configuration"
    fi
    mv -f "$temp_env" .env
    [[ "$(read_env_value VOZEB_PRO_IMAGE)" == "$image" ]] || die "Failed to update VOZEB_PRO_IMAGE"
}

rollback_deployment() {
    log "Restoring previous image configuration ${OLD_IMAGE}"
    cp --preserve=mode "$BACKUP_DIR/.env" .env
    docker compose config --quiet || return 1
    docker compose up -d --pull never --no-deps --force-recreate app || return 1
    wait_for_service_health app 180 || return 1
    wait_for_http /api/health/live 60 || return 1
    wait_for_http /api/health/ready 60 || return 1
    docker compose up -d --pull never --no-deps --force-recreate generation-worker || return 1
    log "Previous App and Worker image restored"
}
```

- [ ] **Step 6: Add staged App/Worker deployment with explicit rollback**

```bash
deploy_target() {
    local failed=0
    set_image_in_env "$TARGET_IMAGE"
    docker compose up -d --pull never --no-deps --force-recreate app || failed=1
    if ((failed == 0)); then wait_for_service_health app 180 || failed=1; fi
    if ((failed == 0)); then wait_for_http /api/health/live 60 || failed=1; fi
    if ((failed == 0)); then wait_for_http /api/health/ready 60 || failed=1; fi
    if ((failed == 0)); then docker compose up -d --pull never --no-deps --force-recreate generation-worker || failed=1; fi
    if ((failed == 0)); then wait_for_service_health generation-worker 60 || failed=1; fi
    if ((failed != 0)); then
        log "New deployment failed; attempting image rollback"
        rollback_deployment || die "Automatic rollback failed; use ${BACKUP_DIR} and DEPLOY-GUIDE.md for manual recovery"
        die "New deployment failed and the previous image was restored"
    fi
    docker compose ps
}
```

- [ ] **Step 7: Run contract, formatting, and Debian syntax checks**

Windows checks:

```powershell
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
git diff --check -- scripts/deploy-debian.sh web/scripts/deploy-debian-contract.test.mjs
```

Debian checks before production execution:

```bash
bash -n scripts/deploy-debian.sh
./scripts/deploy-debian.sh --help
./scripts/deploy-debian.sh --dry-run
```

Expected: Vitest passes, Bash reports no syntax error, help exits without requiring root, and dry-run changes no Git, Docker, `.env`, or backup state.

- [ ] **Step 8: Commit the transactional deployment workflow**

```powershell
git add -- scripts/deploy-debian.sh web/scripts/deploy-debian-contract.test.mjs
git commit -m "feat: deploy Debian source updates safely"
```

### Task 5: Document first use, routine updates, and recovery boundaries

**Files:**
- Modify: `DEPLOY-GUIDE.md`
- Read: `docs/superpowers/specs/2026-08-20-debian-one-command-source-deploy-design.md`
- Test: `web/scripts/deploy-debian-contract.test.mjs`

- [ ] **Step 1: Replace the short server-source warning with the supported workflow**

Use this content in section 15.2:

````markdown
### 15.2 服务器源码一键构建与更新

如果明确选择“服务器从 GitHub 拉取源码并本地构建镜像”，固定使用：

```bash
cd /opt/vozeb-pro
git branch --show-current
git remote -v
sudo ./scripts/deploy-debian.sh --dry-run
sudo ./scripts/deploy-debian.sh
```

日常更新仍然执行最后一条命令。脚本会从 `origin/main_yao_20260820` 快进到最新提交，在服务器本地构建 `vozeb-pro:<VERSION>-<Git SHA>`，完成 PostgreSQL 与配置备份，然后依次更新 App 和 Worker。应用切换使用 `--pull never`，不会下载 VOZEB PRO 应用镜像。

如果 `VERSION` 改变，先阅读 `CHANGELOG.md`、README 和对应版本说明。确认数据库支持原地升级后才执行：

```bash
sudo ./scripts/deploy-debian.sh --allow-version-change
```

服务器重启不会拉取 GitHub 最新代码；Compose 的 `restart: unless-stopped` 会恢复上一次验证通过的镜像。发布日志位于 `/var/log/vozeb-pro-deploy.log`，升级备份位于 `/opt/vozeb-pro/backups/`。

```bash
tail -n 200 /var/log/vozeb-pro-deploy.log
docker compose ps
docker compose logs --tail 100 app generation-worker
```

脚本的自动回滚只切换应用镜像。如果新版本执行了不兼容 Schema 变化，必须使用第十二节的数据库、媒体、`.env` 和旧镜像成套恢复流程。
````

- [ ] **Step 2: Add safety bullets to the existing update rules**

Add:

```markdown
- 一键脚本只在人工执行时拉取代码；不要把它加入服务器开机任务或无限循环。
- 服务器上的已跟踪源码有未提交修改时脚本会拒绝更新；先审查并提交或移走这些修改，禁止用强制 Git 清理覆盖现场修改。
- 脚本快速备份 PostgreSQL、`.env` 和部署元数据；外部 COS/OSS Bucket 与仍在本地卷中的不可再生媒体需要独立备份策略。
```

- [ ] **Step 3: Run documentation and contract checks**

```powershell
git diff --check -- DEPLOY-GUIDE.md
rg -n "deploy-debian.sh|--allow-version-change|--pull never|vozeb-pro-deploy.log" DEPLOY-GUIDE.md
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs
```

Expected: no whitespace errors; first-use, version-gate, local-image, and log instructions are present; contract tests pass.

- [ ] **Step 4: Commit the operator guide**

```powershell
git add -- DEPLOY-GUIDE.md
git commit -m "docs: add one-command Debian source updates"
```

### Task 6: Perform final repository and production validation

**Files:**
- Read: `scripts/deploy-debian.sh`
- Read: `web/scripts/deploy-debian-contract.test.mjs`
- Read: `DEPLOY-GUIDE.md`
- Read: `docs/superpowers/specs/2026-08-20-debian-one-command-source-deploy-design.md`

- [ ] **Step 1: Run focused and repository consistency checks**

```powershell
pnpm --dir web exec vitest run scripts/deploy-debian-contract.test.mjs scripts/compose-contract.test.mjs
git diff --check
git status --short --branch
git log -6 --oneline --decorate
```

Expected: both test files pass, no whitespace errors exist, and only intentional plan bookkeeping may remain.

- [ ] **Step 2: Verify forbidden operations are absent**

```powershell
rg -n "docker compose down.*-v|docker volume (rm|prune)|git reset --hard|docker image prune.*-a|rm -rf" scripts/deploy-debian.sh
```

Expected: no matches.

- [ ] **Step 3: Verify the production dry run on Debian 12**

After the commits are pushed and cloned at `/opt/vozeb-pro`, run:

```bash
cd /opt/vozeb-pro
sudo bash -n scripts/deploy-debian.sh
sudo ./scripts/deploy-debian.sh --dry-run
docker compose ps
```

Expected: syntax and read-only checks pass; no image is built, `.env` is unchanged, no backup directory is created, and current containers remain unchanged.

- [ ] **Step 4: Execute the first real server update and record evidence**

Run only after checking `CHANGELOG.md` and database compatibility:

```bash
cd /opt/vozeb-pro
sudo ./scripts/deploy-debian.sh
docker inspect vozeb-pro --format 'AppImage={{.Config.Image}} Health={{.State.Health.Status}}'
docker inspect vozeb-pro-generation-worker --format 'WorkerImage={{.Config.Image}} Status={{.State.Status}}'
curl --fail --silent --show-error https://aigc.mutangtech.com/api/health/live
curl --fail --silent --show-error https://aigc.mutangtech.com/api/health/ready
```

Expected: App and Worker use the same local immutable `vozeb-pro:<VERSION>-<Git SHA>` image, App is healthy, Worker is running, both public health endpoints succeed, PostgreSQL remains healthy, and the script prints a verified backup directory.

- [ ] **Step 5: Record remaining production-only evidence**

Record the deployed Git commit, image tag and image ID, backup directory, Compose service state, health responses, PostgreSQL container ID before/after, named-volume names, and object-storage backup evidence. Do not copy database passwords, encryption keys, tokens, or provider secrets into logs or Git.
