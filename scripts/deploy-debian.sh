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

main() {
    parse_args "$@"
    if ((DRY_RUN == 0)); then
        setup_mutating_run
    fi
    preflight
    log "Preflight checks passed for ${DEPLOY_REMOTE}/${DEPLOY_BRANCH}"
    if ((DRY_RUN == 1)); then
        log "Dry run complete; no Git, Docker, .env, or backup state was changed"
    fi
}

main "$@"
