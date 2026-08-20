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

log() {
    printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
    log "ERROR: $*" >&2
    exit 1
}

parse_args() {
    while (($#)); do
        case "$1" in
            --allow-version-change) ALLOW_VERSION_CHANGE=1 ;;
            --force-build) FORCE_BUILD=1 ;;
            --dry-run) DRY_RUN=1 ;;
            --help)
                usage
                exit 0
                ;;
            *)
                usage >&2
                die "Unknown option: $1"
                ;;
        esac
        shift
    done
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"
}

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
    for command in git docker curl flock realpath awk sha256sum; do
        require_command "$command"
    done
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

wait_for_service_health() {
    local service="$1" timeout_seconds="$2" deadline container_id status
    deadline=$((SECONDS + timeout_seconds))
    while ((SECONDS < deadline)); do
        container_id="$(docker compose ps -q "$service")"
        if [[ -n "$container_id" ]]; then
            status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
            if [[ "$status" == "healthy" || "$status" == "running" ]]; then
                return 0
            fi
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
        if curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:3000${path}" >/dev/null; then
            return 0
        fi
        sleep 3
    done
    return 1
}

ensure_postgres_running() {
    if [[ -n "$(docker compose ps -a -q postgres)" ]]; then
        docker compose start postgres
    else
        docker compose up -d postgres
    fi
    wait_for_service_health postgres 120 || die "PostgreSQL did not become healthy"
}

ensure_current_services() {
    docker compose up -d --pull never
    wait_for_service_health postgres 120 || die "PostgreSQL did not become healthy"
    wait_for_service_health app 180 || die "App did not become healthy"
    wait_for_http /api/health/live 60 || die "Live health endpoint failed"
    wait_for_http /api/health/ready 60 || die "Ready health endpoint failed"
    docker compose ps
}

create_backup() {
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_DIR="${BACKUP_ROOT}/${stamp}"
    install -d -m 700 "$BACKUP_DIR"
    ensure_postgres_running
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

main() {
    parse_args "$@"
    if ((DRY_RUN == 0)); then
        setup_mutating_run
    fi
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

main "$@"
