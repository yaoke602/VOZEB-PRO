import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const scriptPath = path.join(repoRoot, "scripts", "deploy-debian.sh");
const dockerIgnorePath = path.join(repoRoot, ".dockerignore");
const gitIgnorePath = path.join(repoRoot, ".gitignore");

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
        expect(source).toContain('PROJECT_ROOT="/root/mutangaigc/VOZEB-PRO"');
        expect(source).not.toContain('PROJECT_ROOT="/opt/vozeb-pro"');
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

    it("only accepts a fast-forward from the fixed production branch", () => {
        const source = scriptSource();
        expect(source).toContain('DEPLOY_REMOTE="origin"');
        expect(source).toContain('DEPLOY_BRANCH="main_yao_20260820"');
        expect(source).toContain('git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"');
        expect(source).toContain("git merge-base --is-ancestor");
        expect(source).toContain('git merge --ff-only "$TARGET_COMMIT"');
        expect(source).not.toMatch(/git\s+(reset\s+--hard|checkout\s+--force|clean\s+-f)/);
    });

    it("builds a local immutable image, gates VERSION changes, and can resume an interrupted release", () => {
        const source = scriptSource();
        expect(source).toContain("--allow-version-change");
        expect(source).toContain("--force-build");
        expect(source).toContain('base_image="vozeb-pro:${TARGET_VERSION}-${TARGET_SHA}"');
        expect(source).toContain('"$OLD_IMAGE" == "$TARGET_IMAGE"');
        expect(source).toContain('docker image inspect "$TARGET_IMAGE"');
        expect(source).toContain("docker build");
        expect(source).toContain("DEBIAN_MIRROR=http://mirrors.aliyun.com/debian");
        expect(source).toContain("DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security");
        expect(source).toContain("select_target_image");
        expect(source).toContain("com.vozeb-pro.git-revision");
    });

    it("backs up PostgreSQL and production configuration before switching images", () => {
        const source = scriptSource();
        expect(source).toContain("pg_dump --format=custom --create");
        expect(source).toContain('cp --preserve=mode .env "$BACKUP_DIR/.env"');
        expect(source).toContain("sha256sum");
        expect(source).toContain('test -s "$BACKUP_DIR/postgres.dump"');
    });

    it("updates App before Worker, verifies both health endpoints, and can restore the old image", () => {
        const source = scriptSource();
        const deployBody = source.match(/deploy_target\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
        const appSwitch = deployBody.indexOf("--force-recreate app");
        const workerSwitch = deployBody.indexOf("--force-recreate generation-worker");
        const readyCheck = deployBody.lastIndexOf("wait_for_http /api/health/ready");
        const workerStop = deployBody.indexOf("docker compose stop generation-worker");
        const heartbeatBaseline = deployBody.indexOf('previous_heartbeat="$(read_worker_heartbeat)"');
        expect(appSwitch).toBeGreaterThan(-1);
        expect(workerSwitch).toBeGreaterThan(appSwitch);
        expect(readyCheck).toBeGreaterThan(workerSwitch);
        expect(workerStop).toBeGreaterThan(-1);
        expect(heartbeatBaseline).toBeGreaterThan(workerStop);
        expect(source).toContain("--pull never");
        expect(source).toContain("/api/health/live");
        expect(source).toContain("/api/health/ready");
        expect(source).toContain("classify_install_status");
        expect(source).toContain("wait_for_worker_heartbeat_change");
        expect(source).toContain("rollback_deployment");
        expect(source).toContain('cp --preserve=mode "$BACKUP_DIR/.env" "$restore_env"');
    });

    it("fails closed around production configuration, persistent topology, and untracked build inputs", () => {
        const source = scriptSource();
        expect(source).toContain('COMPOSE_PROJECT_NAME)" == "vozeb-pro"');
        expect(source).toContain("stat -c '%a' .env");
        expect(source).toContain("--untracked-files=normal");
        expect(source).toContain('git diff --quiet "$OLD_COMMIT" "$TARGET_COMMIT" -- docker-compose.yml');
        expect(source).toContain("capture_persistence_identity");
        expect(source).toContain("assert_persistence_identity");
        expect(source).toContain('volume_marker "$POSTGRES_VOLUME"');
        expect(source).toContain("container_volume_name");
        expect(source).toContain("Persistent deployment data exists without an App container");
        expect(source).toContain("HAD_APP == 0 && HAD_POSTGRES == 1");
        expect(source).toContain("VOZEB_PRO_IMAGE does not match the running App image");
        expect(source).toContain("App and Generation Worker currently use different images");
    });

    it("rolls back interrupted mutations and handles a failed first deployment without an old image", () => {
        const source = scriptSource();
        expect(source).toContain("trap 'handle_transaction_exit $?' EXIT");
        expect(source).toContain("MUTATION_ACTIVE=1");
        expect(source).toContain("if ((HAD_APP == 0)); then");
        expect(source).toContain("docker compose rm --force --stop app generation-worker");
        expect(source).toContain('.env.rollback.XXXXXX');
        expect(source).toContain('docker compose --env-file "$restore_env" config --quiet');
    });

    it("does not let the no-update path recreate PostgreSQL", () => {
        const source = scriptSource();
        const body = source.match(/ensure_current_services\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
        expect(body).toContain("--no-deps app");
        expect(body).toContain("--no-deps generation-worker");
        expect(body).toContain("assert_persistence_identity");
        expect(body).not.toContain("docker compose up -d --pull never\n");
        expect(source).toContain('[[ "$HAD_APP" -eq 1 && "$OLD_COMMIT" == "$TARGET_COMMIT"');
        expect(source).toContain('com.vozeb-pro.git-revision');
    });

    it("normalizes spaced VOZEB_PRO_IMAGE assignments when updating .env", () => {
        expect(scriptSource()).toContain("/^[[:space:]]*VOZEB_PRO_IMAGE[[:space:]]*=/");
    });

    it("excludes deployment backups from Git and the Docker build context", () => {
        expect(readFileSync(dockerIgnorePath, "utf8")).toMatch(/^\/?backups\/?$/m);
        expect(readFileSync(gitIgnorePath, "utf8")).toMatch(/^\/?backups\/?$/m);
    });

    it("verifies the backup checksums it creates", () => {
        expect(scriptSource()).toContain("sha256sum -c SHA256SUMS");
    });
});
