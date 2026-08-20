#!/usr/bin/env bash
set -Eeuo pipefail

readonly TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${TEST_ROOT}/deploy-debian.sh"

assert_equal() {
    local expected="$1" actual="$2" label="$3"
    if [[ "$actual" != "$expected" ]]; then
        printf 'FAIL: %s\nExpected: %s\nActual:   %s\n' "$label" "$expected" "$actual" >&2
        exit 1
    fi
}

assert_fails() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        printf 'FAIL: %s unexpectedly succeeded\n' "$label" >&2
        exit 1
    fi
}

assert_equal "v0.0.6" "$(parse_deployed_version 'vozeb-pro:v0.0.6-bfe52ee6d381')" "local immutable version"
assert_equal "v1-beta" "$(parse_deployed_version 'vozeb-pro:v1-beta-abcdef012345')" "hyphenated local version"
assert_equal "v1-beta" "$(parse_deployed_version 'vozeb-pro:v1-beta-abcdef012345-rebuild-20260820T010203Z-42')" "forced rebuild version"
assert_equal "v0.0.6" "$(parse_deployed_version 'ghcr.io/csyqlz/vozeb-pro:v0.0.6')" "registry release version"
assert_fails "mutable local image" parse_deployed_version "vozeb-pro:local"

assert_equal "vozeb-pro:v0.0.6-abcdef012345" "$(select_target_image 'vozeb-pro:v0.0.6-abcdef012345' 0 '20260820T010203Z')" "normal immutable image"
assert_equal "vozeb-pro:v0.0.6-abcdef012345-rebuild-20260820T010203Z-42" "$(select_target_image 'vozeb-pro:v0.0.6-abcdef012345' 1 '20260820T010203Z-42')" "forced rebuild image"

if (
    cd "${TEST_ROOT}/.."
    git() { printf 'abcdef012345\n'; }
    HAD_APP=0
    HAD_POSTGRES=1
    ALLOW_VERSION_CHANGE=0
    prepare_image_identity
) >/dev/null 2>&1; then
    printf 'FAIL: persistent data without an App container bypassed the version gate\n' >&2
    exit 1
fi

(
    cd "${TEST_ROOT}/.."
    git() { printf 'abcdef012345\n'; }
    HAD_APP=0
    HAD_POSTGRES=1
    ALLOW_VERSION_CHANGE=1
    prepare_image_identity
    [[ -n "$TARGET_IMAGE" ]]
)

assert_equal "installed" "$(classify_install_status '{"install":{"ready":true}}')" "installed status"
assert_equal "schema_pending" "$(classify_install_status '{"install":{"ready":false,"security":{"encryptionReady":true,"installTokenReady":true},"database":{"healthy":true,"schemaReady":false}}}')" "schema pending status"
assert_equal "admin_pending" "$(classify_install_status '{"install":{"ready":false,"firstAdminRequired":true,"security":{"encryptionReady":true,"installTokenReady":true},"database":{"healthy":true,"schemaReady":true}}}')" "admin pending status"
assert_fails "unhealthy database" classify_install_status '{"install":{"ready":false,"database":{"healthy":false,"schemaReady":false}}}'

assert_transaction_rollback() {
    local trigger="$1" expected_status="$2" label="$3" event_log status
    event_log="$(mktemp)"
    set +e
    (
        rollback_deployment() { printf 'rollback\n' >> "$event_log"; }
        log() { :; }
        MUTATION_ACTIVE=1
        ROLLBACK_RUNNING=0
        arm_transaction_traps
        case "$trigger" in
            exit) false ;;
            INT) kill -INT "$BASHPID" ;;
            TERM) kill -TERM "$BASHPID" ;;
        esac
    )
    status=$?
    set -e
    assert_equal "$expected_status" "$status" "${label} exit status"
    assert_equal "rollback" "$(paste -sd, "$event_log")" "${label} rollback"
}

assert_transaction_rollback exit 1 "unexpected exit"
assert_transaction_rollback INT 130 "INT signal"
assert_transaction_rollback TERM 143 "TERM signal"

(
    test_dir="$(mktemp -d)"
    cd "$test_dir"
    printf 'COMPOSE_PROJECT_NAME=vozeb-pro\nVOZEB_PRO_IMAGE=vozeb-pro:v0.0.6-abcdef012345\n' > .env
    docker() {
        case "$*" in
            "compose ps -a -q app"|"compose ps -a -q postgres") return 0 ;;
            "volume inspect ${POSTGRES_VOLUME} --format {{.CreatedAt}}") printf '2026-08-20T00:00:00Z\n' ;;
            "volume inspect ${DATA_VOLUME} --format {{.CreatedAt}}") return 0 ;;
            *) printf 'Unexpected docker command: %s\n' "$*" >&2; return 1 ;;
        esac
    }
    HAD_APP=0
    HAD_POSTGRES=0
    capture_existing_deployment
    assert_equal "1" "$HAD_POSTGRES" "preserved PostgreSQL volume triggers existing-deployment gate"
)

(
    event_log="$(mktemp)"
    docker() {
        case "$*" in
            "compose ps -a -q generation-worker") printf 'worker-container\n' ;;
            "compose stop generation-worker") printf 'stop-worker\n' >> "$event_log" ;;
            *"--force-recreate app") printf 'start-app\n' >> "$event_log" ;;
            *"--force-recreate generation-worker") printf 'start-worker\n' >> "$event_log" ;;
            "compose ps") return 0 ;;
            *) printf 'Unexpected docker command: %s\n' "$*" >&2; return 1 ;;
        esac
    }
    read_worker_heartbeat() { printf 'heartbeat-baseline\n' >> "$event_log"; printf 'old-heartbeat\n'; }
    set_image_in_env() { printf 'set-env\n' >> "$event_log"; }
    wait_for_service_health() { return 0; }
    wait_for_http() { return 0; }
    wait_for_install_status() { printf '{"install":{"ready":true}}\n'; }
    wait_for_service_stable() { return 0; }
    wait_for_worker_heartbeat_change() { printf 'new-heartbeat\n' >> "$event_log"; }
    assert_persistence_identity() { printf 'persistence-ok\n' >> "$event_log"; }
    TARGET_IMAGE="vozeb-pro:v0.0.6-abcdef012345"
    deploy_target
    assert_equal "stop-worker,heartbeat-baseline,set-env,start-app,start-worker,new-heartbeat,persistence-ok" "$(paste -sd, "$event_log")" "deployment command order"
)

(
    test_dir="$(mktemp -d)"
    BACKUP_DIR="${test_dir}/backup"
    mkdir -p "$BACKUP_DIR"
    printf 'VOZEB_PRO_IMAGE=vozeb-pro:v0.0.6-oldold1\n' > "$BACKUP_DIR/.env"
    cd "$test_dir"
    event_log="$(mktemp)"
    docker() { printf '%s\n' "$*" >> "$event_log"; }
    chown() { :; }
    assert_persistence_identity() { return 0; }
    HAD_APP=0
    OLD_IMAGE="vozeb-pro:v0.0.6-oldold1"
    rollback_deployment
    grep -q '^compose rm --force --stop app generation-worker$' "$event_log"
    assert_equal "VOZEB_PRO_IMAGE=vozeb-pro:v0.0.6-oldold1" "$(<.env)" "atomic .env rollback"
    if grep -q -- '--force-recreate app' "$event_log"; then
        printf 'FAIL: fresh deployment rollback attempted to recreate an old App\n' >&2
        exit 1
    fi
)

printf 'deploy-debian behavior tests passed\n'
