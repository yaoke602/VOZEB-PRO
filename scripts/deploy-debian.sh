#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROJECT_ROOT="/opt/vozeb-pro"
readonly DEPLOY_REMOTE="origin"
readonly DEPLOY_BRANCH="main_yao_20260820"
readonly BACKUP_ROOT="${PROJECT_ROOT}/backups"
readonly LOCK_FILE="/var/lock/vozeb-pro-deploy.lock"
readonly LOG_FILE="/var/log/vozeb-pro-deploy.log"
readonly POSTGRES_VOLUME="vozeb-pro_vozeb-pro-postgres"
readonly DATA_VOLUME="vozeb-pro_vozeb-pro-data"

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
OLD_IMAGE_ID=""
HAD_APP=0
HAD_POSTGRES=0
POSTGRES_CONTAINER_BASELINE=""
POSTGRES_VOLUME_BASELINE=""
DATA_VOLUME_BASELINE=""
MUTATION_ACTIVE=0
ROLLBACK_RUNNING=0

usage() {
    printf '%s\n' \
        "Usage: sudo ./scripts/deploy-debian.sh [options]" \
        "" \
        "Options:" \
        "  --allow-version-change  Continue after reviewing VERSION and database compatibility" \
        "  --force-build           Build a uniquely tagged image even when origin has no new commit" \
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
    awk -v key="$key" '
        $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
            value=$0
            sub("^[[:space:]]*" key "[[:space:]]*=[[:space:]]*", "", value)
            sub(/[[:space:]]+#[^#]*$/, "", value)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
                (substr(value, 1, 1) == "\047" && substr(value, length(value), 1) == "\047")) {
                value=substr(value, 2, length(value)-2)
            }
        }
        END { print value }
    ' .env
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

validate_env_file() {
    local env_mode env_owner
    [[ -f .env && ! -L .env ]] || die "Production .env must be a regular file, not a symlink"
    env_mode="$(stat -c '%a' .env)"
    env_owner="$(stat -c '%u' .env)"
    [[ "$env_owner" == "0" ]] || die "Production .env must be owned by root"
    (( (8#$env_mode & 8#77) == 0 )) || die "Production .env must not be readable or writable by group/other users"
    [[ "$(read_env_value COMPOSE_PROJECT_NAME)" == "vozeb-pro" ]] || die "COMPOSE_PROJECT_NAME must be vozeb-pro"
    [[ -n "$(read_env_value VOZEB_PRO_IMAGE)" ]] || die "VOZEB_PRO_IMAGE is missing from .env"
}

validate_compose_topology() {
    local config
    docker compose config --quiet
    config="$(docker compose config)"
    grep -q '^name: vozeb-pro$' <<<"$config" || die "Resolved Compose project name is not vozeb-pro"
    grep -q 'source: vozeb-pro-postgres' <<<"$config" || die "PostgreSQL volume source changed"
    grep -q 'target: /var/lib/postgresql/data' <<<"$config" || die "PostgreSQL volume target changed"
    grep -q 'source: vozeb-pro-data' <<<"$config" || die "Application data volume source changed"
    grep -q 'target: /app/web/.data' <<<"$config" || die "Application data volume target changed"
}

capture_existing_deployment() {
    local app_container app_mount configured_image postgres_container tagged_image_id worker_container worker_image
    app_container="$(docker compose ps -a -q app)"
    postgres_container="$(docker compose ps -a -q postgres)"
    configured_image="$(read_env_value VOZEB_PRO_IMAGE)"
    if [[ -n "$app_container" ]]; then
        HAD_APP=1
        OLD_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$app_container")"
        OLD_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$app_container")"
        [[ "$configured_image" == "$OLD_IMAGE" ]] || die "VOZEB_PRO_IMAGE does not match the running App image"
        tagged_image_id="$(docker image inspect "$OLD_IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
        [[ "$tagged_image_id" == "$OLD_IMAGE_ID" ]] || die "The running App image tag no longer resolves to its container image ID"
        app_mount="$(container_volume_name "$app_container" /app/web/.data)"
        [[ "$app_mount" == "$DATA_VOLUME" ]] || die "Running App is not mounted to ${DATA_VOLUME}"
        worker_container="$(docker compose ps -a -q generation-worker)"
        if [[ -n "$worker_container" ]]; then
            worker_image="$(docker inspect --format '{{.Config.Image}}' "$worker_container")"
            [[ "$worker_image" == "$OLD_IMAGE" ]] || die "App and Generation Worker currently use different images"
        fi
    else
        OLD_IMAGE="$configured_image"
    fi
    if [[ -n "$postgres_container" || -n "$(volume_marker "$POSTGRES_VOLUME")" || -n "$(volume_marker "$DATA_VOLUME")" ]]; then
        HAD_POSTGRES=1
    fi
}

preflight() {
    local command current_root current_branch repository_status
    for command in git docker curl flock realpath awk sha256sum stat grep sed; do
        require_command "$command"
    done
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable"
    current_root="$(realpath "$PWD")"
    [[ "$current_root" == "$PROJECT_ROOT" ]] || die "Run from $PROJECT_ROOT"
    [[ -r VERSION ]] || die "VERSION is missing"
    [[ -r docker-compose.yml ]] || die "docker-compose.yml is missing"
    validate_env_file
    current_branch="$(git branch --show-current)"
    [[ "$current_branch" == "$DEPLOY_BRANCH" ]] || die "Expected branch $DEPLOY_BRANCH, got $current_branch"
    git remote get-url "$DEPLOY_REMOTE" >/dev/null 2>&1 || die "Git remote $DEPLOY_REMOTE is missing"
    repository_status="$(git status --porcelain --untracked-files=normal)"
    [[ -z "$repository_status" ]] || die "Tracked or untracked build-context files are present; commit or remove them before deploying"
    validate_compose_topology
    capture_existing_deployment
}

fetch_target() {
    OLD_COMMIT="$(git rev-parse HEAD)"
    git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"
    TARGET_COMMIT="$(git rev-parse FETCH_HEAD)"
    git merge-base --is-ancestor "$OLD_COMMIT" "$TARGET_COMMIT" || die "Remote update is not a fast-forward"
    git diff --quiet "$OLD_COMMIT" "$TARGET_COMMIT" -- docker-compose.yml || die "docker-compose.yml changed; the one-command updater refuses persistent-topology changes"
}

fast_forward_source() {
    if [[ "$OLD_COMMIT" == "$TARGET_COMMIT" ]]; then
        log "Source is already at ${TARGET_COMMIT}"
        return
    fi
    git merge --ff-only "$TARGET_COMMIT"
    [[ "$(git rev-parse HEAD)" == "$TARGET_COMMIT" ]] || die "HEAD does not match the fetched target"
    validate_compose_topology
}

parse_deployed_version() {
    local reference="$1" leaf tag
    leaf="${reference##*/}"
    [[ "$leaf" == *:* ]] || return 1
    tag="${leaf#*:}"
    [[ "$tag" != "local" && "$tag" != "latest" ]] || return 1
    if [[ "$leaf" == vozeb-pro:* && "$tag" =~ ^(.+)-([0-9a-f]{7,40})(-rebuild-[0-9]{8}T[0-9]{6}Z(-[0-9]+)?)?$ ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return
    fi
    if [[ "$tag" =~ ^v?[0-9]+([.][0-9]+)*([._-][A-Za-z0-9._-]+)?$ ]]; then
        printf '%s\n' "$tag"
        return
    fi
    return 1
}

select_target_image() {
    local base_image="$1" force_build="$2" stamp="$3"
    if ((force_build == 1)); then
        printf '%s-rebuild-%s\n' "$base_image" "$stamp"
    else
        printf '%s\n' "$base_image"
    fi
}

prepare_image_identity() {
    local deployed_version="" base_image stamp
    TARGET_VERSION="$(tr -d '[:space:]' < VERSION)"
    [[ "$TARGET_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "VERSION cannot be used in a Docker tag"
    TARGET_SHA="$(git rev-parse --short=12 HEAD)"
    base_image="vozeb-pro:${TARGET_VERSION}-${TARGET_SHA}"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    TARGET_IMAGE="$(select_target_image "$base_image" "$FORCE_BUILD" "$stamp")"
    if ((HAD_APP == 0 && HAD_POSTGRES == 1 && ALLOW_VERSION_CHANGE != 1)); then
        die "Persistent deployment data exists without an App container; the deployed version cannot be proven. Review compatibility and rerun with --allow-version-change"
    fi
    if ((HAD_APP == 1)); then
        if ! deployed_version="$(parse_deployed_version "$OLD_IMAGE")"; then
            ((ALLOW_VERSION_CHANGE == 1)) || die "Cannot establish the deployed version from ${OLD_IMAGE}; review compatibility and rerun with --allow-version-change"
        elif [[ "$deployed_version" != "$TARGET_VERSION" && $ALLOW_VERSION_CHANGE -ne 1 ]]; then
            die "VERSION changed from ${deployed_version} to ${TARGET_VERSION}; review CHANGELOG.md and rerun with --allow-version-change"
        fi
    fi
}

build_target_image() {
    local existing_revision=""
    if docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1; then
        existing_revision="$(docker image inspect "$TARGET_IMAGE" --format '{{index .Config.Labels "com.vozeb-pro.git-revision"}}')"
        [[ "$existing_revision" == "$TARGET_COMMIT" ]] || die "Existing image ${TARGET_IMAGE} does not match target commit ${TARGET_COMMIT}"
        log "Reusing existing local image ${TARGET_IMAGE}"
        return
    fi
    docker build \
        --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian \
        --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security \
        --label "com.vozeb-pro.version=${TARGET_VERSION}" \
        --label "com.vozeb-pro.git-revision=${TARGET_COMMIT}" \
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

wait_for_service_stable() {
    local service="$1" timeout_seconds="$2" stable_seconds="$3" deadline container_id status stable_since=0
    deadline=$((SECONDS + timeout_seconds))
    while ((SECONDS < deadline)); do
        container_id="$(docker compose ps -q "$service")"
        status=""
        if [[ -n "$container_id" ]]; then
            status="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
        fi
        if [[ "$status" == "running" ]]; then
            ((stable_since > 0)) || stable_since=$SECONDS
            if ((SECONDS - stable_since >= stable_seconds)); then return 0; fi
        else
            stable_since=0
            [[ "$status" != "exited" && "$status" != "dead" ]] || return 1
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

classify_install_status() {
    local compact="${1//[[:space:]]/}"
    if [[ "$compact" == *'"ready":true'* ]]; then
        printf 'installed\n'
    elif [[ "$compact" == *'"healthy":true'* && "$compact" == *'"schemaReady":false'* && "$compact" == *'"encryptionReady":true'* && "$compact" == *'"installTokenReady":true'* ]]; then
        printf 'schema_pending\n'
    elif [[ "$compact" == *'"firstAdminRequired":true'* && "$compact" == *'"healthy":true'* && "$compact" == *'"schemaReady":true'* && "$compact" == *'"encryptionReady":true'* && "$compact" == *'"installTokenReady":true'* ]]; then
        printf 'admin_pending\n'
    else
        return 1
    fi
}

wait_for_install_status() {
    local timeout_seconds="$1" deadline payload
    deadline=$((SECONDS + timeout_seconds))
    while ((SECONDS < deadline)); do
        payload="$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/api/install/status 2>/dev/null || true)"
        if [[ -n "$payload" ]] && classify_install_status "$payload" >/dev/null; then
            printf '%s\n' "$payload"
            return 0
        fi
        sleep 3
    done
    return 1
}

read_worker_heartbeat() {
    local payload
    payload="$(curl --silent --show-error --max-time 10 http://127.0.0.1:3000/api/health/ready 2>/dev/null || true)"
    sed -n 's/.*"lastHeartbeatAt":"\([^"]*\)".*/\1/p' <<<"$payload"
}

wait_for_worker_heartbeat_change() {
    local previous="$1" timeout_seconds="$2" deadline current
    deadline=$((SECONDS + timeout_seconds))
    while ((SECONDS < deadline)); do
        current="$(read_worker_heartbeat)"
        if [[ -n "$current" && "$current" != "$previous" ]]; then return 0; fi
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

volume_marker() {
    docker volume inspect "$1" --format '{{.CreatedAt}}' 2>/dev/null || true
}

container_volume_name() {
    local container_id="$1" destination="$2"
    docker inspect --format "{{range .Mounts}}{{if eq .Destination \"${destination}\"}}{{.Name}}{{end}}{{end}}" "$container_id" 2>/dev/null || true
}

capture_persistence_identity() {
    local postgres_mount
    POSTGRES_CONTAINER_BASELINE="$(docker compose ps -a -q postgres)"
    [[ -n "$POSTGRES_CONTAINER_BASELINE" ]] || die "PostgreSQL container is missing after startup"
    postgres_mount="$(container_volume_name "$POSTGRES_CONTAINER_BASELINE" /var/lib/postgresql/data)"
    [[ "$postgres_mount" == "$POSTGRES_VOLUME" ]] || die "PostgreSQL container is not mounted to ${POSTGRES_VOLUME}"
    POSTGRES_VOLUME_BASELINE="$(volume_marker "$POSTGRES_VOLUME")"
    [[ -n "$POSTGRES_VOLUME_BASELINE" ]] || die "PostgreSQL volume ${POSTGRES_VOLUME} is missing"
    DATA_VOLUME_BASELINE="$(volume_marker "$DATA_VOLUME")"
}

assert_persistence_identity() {
    local app_container postgres_mount app_mount
    [[ "$(docker compose ps -a -q postgres)" == "$POSTGRES_CONTAINER_BASELINE" ]] || die "PostgreSQL container identity changed during application deployment"
    postgres_mount="$(container_volume_name "$POSTGRES_CONTAINER_BASELINE" /var/lib/postgresql/data)"
    [[ "$postgres_mount" == "$POSTGRES_VOLUME" ]] || die "PostgreSQL container mount changed during application deployment"
    [[ "$(volume_marker "$POSTGRES_VOLUME")" == "$POSTGRES_VOLUME_BASELINE" ]] || die "PostgreSQL volume identity changed during application deployment"
    if [[ -n "$DATA_VOLUME_BASELINE" ]]; then
        [[ "$(volume_marker "$DATA_VOLUME")" == "$DATA_VOLUME_BASELINE" ]] || die "Application data volume identity changed during deployment"
    fi
    app_container="$(docker compose ps -a -q app)"
    if [[ -n "$app_container" ]]; then
        app_mount="$(container_volume_name "$app_container" /app/web/.data)"
        [[ "$app_mount" == "$DATA_VOLUME" ]] || die "Application data mount changed during deployment"
    fi
}

verify_runtime() {
    local install_payload install_state
    wait_for_service_health app 180 || return 1
    wait_for_http /api/health/live 60 || return 1
    install_payload="$(wait_for_install_status 60)" || return 1
    install_state="$(classify_install_status "$install_payload")" || return 1
    wait_for_service_stable generation-worker 90 15 || return 1
    if [[ "$install_state" == "installed" ]]; then
        wait_for_http /api/health/ready 120 || return 1
    else
        log "Application is running with installation state ${install_state}; complete setup at https://aigc.mutangtech.com/install"
    fi
}

ensure_current_services() {
    docker compose up -d --pull never --no-deps app
    docker compose up -d --pull never --no-deps generation-worker
    wait_for_service_health postgres 120 || die "PostgreSQL did not become healthy"
    verify_runtime || die "Current App/Worker runtime verification failed"
    assert_persistence_identity
    docker compose ps
}

create_backup() {
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_DIR="${BACKUP_ROOT}/${stamp}"
    install -d -m 700 "$BACKUP_DIR"
    docker compose exec -T postgres sh -c 'pg_dump --format=custom --create -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP_DIR/postgres.dump"
    test -s "$BACKUP_DIR/postgres.dump" || die "PostgreSQL backup is empty"
    cp --preserve=mode .env "$BACKUP_DIR/.env"
    cp VERSION CHANGELOG.md docker-compose.yml "$BACKUP_DIR/"
    git show "${OLD_COMMIT}:docker-compose.yml" > "$BACKUP_DIR/docker-compose.previous.yml"
    {
        printf 'OLD_COMMIT=%s\n' "$OLD_COMMIT"
        printf 'TARGET_COMMIT=%s\n' "$TARGET_COMMIT"
        printf 'OLD_IMAGE=%s\n' "$OLD_IMAGE"
        printf 'OLD_IMAGE_ID=%s\n' "$OLD_IMAGE_ID"
        printf 'TARGET_IMAGE=%s\n' "$TARGET_IMAGE"
        docker inspect vozeb-pro --format 'OLD_CONTAINER_IMAGE_ID={{.Image}}' 2>/dev/null || true
        printf 'POSTGRES_CONTAINER_ID=%s\n' "$POSTGRES_CONTAINER_BASELINE"
        printf 'POSTGRES_VOLUME_CREATED_AT=%s\n' "$POSTGRES_VOLUME_BASELINE"
        printf 'DATA_VOLUME_CREATED_AT=%s\n' "$DATA_VOLUME_BASELINE"
    } > "$BACKUP_DIR/deployment.txt"
    (
        cd "$BACKUP_DIR"
        sha256sum postgres.dump .env VERSION CHANGELOG.md docker-compose.yml docker-compose.previous.yml deployment.txt > SHA256SUMS
        sha256sum -c SHA256SUMS
    )
    chmod 600 "$BACKUP_DIR/.env" "$BACKUP_DIR/postgres.dump" "$BACKUP_DIR/deployment.txt" "$BACKUP_DIR/SHA256SUMS"
    log "Verified backup: ${BACKUP_DIR}"
}

set_image_in_env() {
    local image="$1" temp_env
    temp_env="$(mktemp "${PROJECT_ROOT}/.env.deploy.XXXXXX")"
    awk -v image="$image" '
        BEGIN { written=0 }
        /^[[:space:]]*VOZEB_PRO_IMAGE[[:space:]]*=/ {
            if (!written) print "VOZEB_PRO_IMAGE=" image
            written=1
            next
        }
        { print }
        END { if (!written) print "VOZEB_PRO_IMAGE=" image }
    ' .env > "$temp_env"
    chmod 600 "$temp_env"
    chown root:root "$temp_env"
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
    if ((HAD_APP == 0)); then
        docker compose rm --force --stop app generation-worker || return 1
        assert_persistence_identity || return 1
        log "Removed failed first-deployment App/Worker containers; PostgreSQL and volumes were preserved"
        return 0
    fi
    docker compose up -d --pull never --no-deps --force-recreate app || return 1
    docker compose up -d --pull never --no-deps --force-recreate generation-worker || return 1
    verify_runtime || return 1
    assert_persistence_identity || return 1
    log "Previous App and Worker image restored"
}

handle_transaction_exit() {
    local exit_code="$1"
    trap - EXIT INT TERM
    if ((MUTATION_ACTIVE == 1 && ROLLBACK_RUNNING == 0)); then
        ROLLBACK_RUNNING=1
        log "Deployment interrupted; attempting automatic rollback"
        rollback_deployment || log "ERROR: Automatic rollback after interruption failed; use ${BACKUP_DIR} for manual recovery"
    fi
    exit "$exit_code"
}

arm_transaction_traps() {
    trap 'handle_transaction_exit $?' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
}

disarm_transaction_traps() {
    MUTATION_ACTIVE=0
    trap - EXIT INT TERM
}

deploy_target() {
    local failed=0 previous_heartbeat install_payload install_state
    MUTATION_ACTIVE=1
    if [[ -n "$(docker compose ps -a -q generation-worker)" ]]; then
        docker compose stop generation-worker || failed=1
    fi
    if ((failed == 0)); then previous_heartbeat="$(read_worker_heartbeat)"; fi
    if ((failed == 0)); then set_image_in_env "$TARGET_IMAGE" || failed=1; fi
    if ((failed == 0)); then docker compose up -d --pull never --no-deps --force-recreate app || failed=1; fi
    if ((failed == 0)); then wait_for_service_health app 180 || failed=1; fi
    if ((failed == 0)); then wait_for_http /api/health/live 60 || failed=1; fi
    if ((failed == 0)); then install_payload="$(wait_for_install_status 60)" || failed=1; fi
    if ((failed == 0)); then install_state="$(classify_install_status "$install_payload")" || failed=1; fi
    if ((failed == 0)); then docker compose up -d --pull never --no-deps --force-recreate generation-worker || failed=1; fi
    if ((failed == 0)); then wait_for_service_stable generation-worker 90 15 || failed=1; fi
    if ((failed == 0)) && [[ "$install_state" != "schema_pending" ]]; then wait_for_worker_heartbeat_change "$previous_heartbeat" 120 || failed=1; fi
    if ((failed == 0)) && [[ "$install_state" == "installed" ]]; then wait_for_http /api/health/ready 120 || failed=1; fi
    if ((failed == 0)) && [[ "$install_state" != "installed" ]]; then
        log "Application deployed with installation state ${install_state}; complete setup at https://aigc.mutangtech.com/install"
    fi
    if ((failed == 0)); then assert_persistence_identity || failed=1; fi
    if ((failed != 0)); then
        log "New deployment failed; attempting image rollback"
        ROLLBACK_RUNNING=1
        if ! rollback_deployment; then
            MUTATION_ACTIVE=0
            disarm_transaction_traps
            die "Automatic rollback failed; use ${BACKUP_DIR} and DEPLOY-GUIDE.md for manual recovery"
        fi
        ROLLBACK_RUNNING=0
        disarm_transaction_traps
        die "New deployment failed and the previous image was restored"
    fi
    disarm_transaction_traps
    docker compose ps
}

main() {
    parse_args "$@"
    if ((DRY_RUN == 0)); then setup_mutating_run; fi
    preflight
    if ((DRY_RUN == 1)); then
        log "Would validate production data identity, fetch ${DEPLOY_REMOTE}/${DEPLOY_BRANCH}, build an immutable image, back up production, and update App then Worker"
        log "Dry run complete; no Git, Docker, .env, or backup state was changed"
        return
    fi
    log "Starting VOZEB PRO source deployment"
    ensure_postgres_running
    capture_persistence_identity
    fetch_target
    fast_forward_source
    assert_persistence_identity
    prepare_image_identity
    if [[ "$OLD_COMMIT" == "$TARGET_COMMIT" && "$OLD_IMAGE" == "$TARGET_IMAGE" && $FORCE_BUILD -eq 0 ]] && docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1; then
        log "Source and deployed image already match ${TARGET_IMAGE}; skipping build and deployment"
        ensure_current_services
        return
    fi
    log "Building ${TARGET_IMAGE} from ${TARGET_COMMIT}"
    build_target_image
    create_backup
    arm_transaction_traps
    deploy_target
    log "Deployment succeeded: ${TARGET_IMAGE}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
