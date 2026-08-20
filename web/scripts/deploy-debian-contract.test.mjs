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
});
