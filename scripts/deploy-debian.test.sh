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

assert_equal "installed" "$(classify_install_status '{"install":{"ready":true}}')" "installed status"
assert_equal "schema_pending" "$(classify_install_status '{"install":{"ready":false,"security":{"encryptionReady":true,"installTokenReady":true},"database":{"healthy":true,"schemaReady":false}}}')" "schema pending status"
assert_equal "admin_pending" "$(classify_install_status '{"install":{"ready":false,"firstAdminRequired":true,"security":{"encryptionReady":true,"installTokenReady":true},"database":{"healthy":true,"schemaReady":true}}}')" "admin pending status"
assert_fails "unhealthy database" classify_install_status '{"install":{"ready":false,"database":{"healthy":false,"schemaReady":false}}}'

printf 'deploy-debian behavior tests passed\n'
