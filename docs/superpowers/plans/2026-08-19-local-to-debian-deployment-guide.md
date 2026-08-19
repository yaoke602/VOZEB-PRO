# Local-to-Debian Deployment Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a root-level Chinese runbook for building VOZEB PRO locally on Windows, transferring the tested Linux amd64 image to Debian 12, and operating it safely behind Nginx HTTPS.

**Architecture:** The guide treats the application image as an immutable artifact identified by project version and Git commit. PostgreSQL, media, `.env`, and encryption keys remain server-side persistent state; deployment, update, backup, rollback, and restore procedures preserve that boundary.

**Tech Stack:** Markdown, Windows PowerShell, Docker Desktop, Docker Engine, Docker Compose v2, Debian 12, PostgreSQL 16.6, Nginx, Certbot, SCP

---

### Task 1: Create the deployment runbook

**Files:**
- Create: `DEPLOY-GUIDE.md`
- Read: `Dockerfile`
- Read: `docker-compose.yml`
- Read: `.env.example`
- Read: `CHANGELOG.md`
- Read: `docs/content/docs/overview/docker.mdx`
- Read: `docs/content/docs/overview/configuration.mdx`
- Read: `docs/content/docs/overview/production-readiness.mdx`

- [ ] **Step 1: Document scope, topology, and data boundaries**

The opening sections must state:

```text
Windows Docker Desktop builds one Linux amd64 application image.
The image contains App/Worker runtime files, FFmpeg, fonts, Sharp, and dependencies.
The image does not contain PostgreSQL data, media volumes, .env, or secrets.
Debian runs postgres + app + generation-worker with docker-compose.yml.
Nginx proxies the loopback-only 127.0.0.1:3000 endpoint to an HTTPS domain.
```

Include a table distinguishing source/image state from PostgreSQL, media, configuration, and encryption keys. State that replacing an image does not delete volumes, but does not prove schema compatibility.

- [ ] **Step 2: Add the Windows local build and artifact commands**

Define the build variables and use the configurable Debian mirrors already supported by `Dockerfile`:

```powershell
$projectRoot = 'F:\yaoaitest16\VOZEB-PRO'
Set-Location -LiteralPath $projectRoot
$version = (Get-Content -LiteralPath 'VERSION' -Raw -Encoding UTF8).Trim()
$gitSha = (git rev-parse --short=12 HEAD).Trim()
$imageTag = "vozeb-pro:${version}-${gitSha}"

docker build `
  --platform linux/amd64 `
  --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian `
  --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security `
  --tag $imageTag `
  .

docker image inspect $imageTag --format 'ID={{.Id}} Architecture={{.Architecture}} Created={{.Created}}'
New-Item -ItemType Directory -Force -Path 'dist' | Out-Null
$archive = "dist\vozeb-pro-${version}-${gitSha}-linux-amd64.tar"
docker save --output $archive $imageTag
$archiveName = Split-Path -Leaf $archive
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$archiveHash  $archiveName" | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
Get-Content -LiteralPath "$archive.sha256"
```

Explain that `dist/` is an artifact directory and must not be committed. Require a clean or intentionally reviewed source tree before building.

- [ ] **Step 3: Add server transfer, verification, and first deployment**

Use SCP to transfer the tar, checksum, `docker-compose.yml`, `.env.example`, `VERSION`, and `CHANGELOG.md`. On Debian, place persistent deployment files under `/opt/vozeb-pro`, verify `amd64`, verify SHA-256, and load the image:

```bash
dpkg --print-architecture
sha256sum -c vozeb-pro-image.sha256
docker load --input vozeb-pro-image.tar
docker image inspect "vozeb-pro:v0.0.6-0123456789ab" --format 'ID={{.Id}} Architecture={{.Architecture}}'
```

The example image tag is illustrative; the guide must tell the operator to use the actual value printed during the local build.

Document Docker Engine installation from Docker's official Debian apt repository and link to `https://docs.docker.com/engine/install/debian/`. Verify with `docker version` and `docker compose version`.

Create `.env` from `.env.example` with mode `600`. Generate five independent 32-byte hex values using `openssl rand -hex 32`. Set the HTTPS site URL, PostgreSQL identity, immutable image tag, trusted proxy hops, and five secrets without printing real values into the guide.

Validate and start:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
```

- [ ] **Step 4: Add Nginx, HTTPS, and first-install checks**

Provide an Nginx server block that proxies to `http://127.0.0.1:3000` and preserves:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Link to `https://nginx.org/en/docs/http/ngx_http_proxy_module.html` and the Certbot instruction selector at `https://certbot.eff.org/instructions`. State that HTTP port 80 must already reach Nginx for the normal HTTP challenge, unless DNS validation is used.

After `/install`, verify the App health, database readiness, homepage, and Worker status:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/ready
docker inspect vozeb-pro --format '{{.State.Health.Status}}'
docker inspect vozeb-pro-generation-worker --format '{{.State.Status}}'
```

- [ ] **Step 5: Add daily operations, backup, update, and rollback**

Document start, stop, status, and bounded log commands. Backups must include a PostgreSQL custom-format dump, media volume archive, `.env`, Compose file, source commit, image tag, and image ID.

Use this database backup pattern so credentials remain inside the PostgreSQL container:

```bash
docker compose exec -T postgres sh -c 'pg_dump --format=custom --create -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_dir/postgres.dump"
```

Stop App and Worker while archiving the media volume and use the already-declared PostgreSQL image as the tar helper:

```bash
docker compose stop app generation-worker
docker run --rm --user 0 \
  -v vozeb-pro_vozeb-pro-data:/source:ro \
  -v "$backup_dir":/backup \
  --entrypoint tar postgres:16.6-alpine \
  -czf /backup/vozeb-pro-data.tar.gz -C /source .
docker compose start app generation-worker
```

The update procedure must verify backup completion and release compatibility before loading the new image and changing only `VOZEB_PRO_IMAGE`. It must use `docker compose up -d`, never `down -v`.

Image-only rollback changes `VOZEB_PRO_IMAGE` back to the previous immutable tag. State explicitly that a schema-incompatible update requires matching database/media restoration and cannot be fixed by image rollback alone.

- [ ] **Step 6: Add Agent safety rules and troubleshooting**

Add explicit prohibitions against printing secrets, changing the encryption key, deleting volumes, clearing databases, overwriting `.env`, or upgrading without backups and compatibility review. Include troubleshooting for architecture mismatch, TLS/image download errors, port conflicts, unhealthy PostgreSQL/App, Worker authentication, Nginx 502, and failed readiness checks.

State the known compatibility boundary: project documentation explicitly rejects an in-place `0.0.2` to `0.0.6` upgrade.

### Task 2: Verify and commit the runbook

**Files:**
- Test: `DEPLOY-GUIDE.md`

- [ ] **Step 1: Check required coverage and dangerous-command placement**

Run:

```powershell
rg -n "linux/amd64|docker save|sha256sum|docker load|Debian 12|Nginx|HTTPS|pg_dump|vozeb-pro-data|VOZEB_PRO_ENCRYPTION_KEY|down -v|health/live|health/ready|0\.0\.2" DEPLOY-GUIDE.md
```

Expected: every required topic appears. `docker compose down -v` may appear only inside warnings or prohibited-action sections.

- [ ] **Step 2: Verify commands against current project files**

Run:

```powershell
docker build --check .
docker compose config --quiet
rg -n "DEBIAN_MIRROR|DEBIAN_SECURITY_MIRROR" Dockerfile
rg -n "vozeb-pro-postgres|vozeb-pro-data|127\.0\.0\.1:3000|generation-worker" docker-compose.yml
rg -n "VOZEB_PRO_IMAGE|VOZEB_PRO_INSTALL_TOKEN|VOZEB_PRO_MAINTENANCE_TOKEN|VOZEB_PRO_WORKER_TOKEN" .env.example
```

Expected: Dockerfile and Compose validation pass; all referenced variables, services, ports, and volumes exist.

- [ ] **Step 3: Check Markdown quality and repository consistency**

Run:

```powershell
git diff --check
rg -n "TBD|TODO|待定|稍后补充" DEPLOY-GUIDE.md
git status --short
```

Expected: no whitespace errors, no incomplete sections, and only the intended guide is uncommitted.

- [ ] **Step 4: Commit the guide**

```powershell
git add -- DEPLOY-GUIDE.md
git commit -m "docs: add local and Debian deployment runbook"
```

Expected: one commit containing the root deployment guide.
