# Docker Debian Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the current VOZEB PRO source as `vozeb-pro:local` with a configurable Debian package mirror, then deploy it with the existing Compose data volumes.

**Architecture:** Keep Debian's official repositories as Dockerfile defaults and expose separate build arguments for the main and security repositories. The local Windows build passes Aliyun mirror URLs, while the standard Compose topology continues to provide PostgreSQL, loopback-only application access, persistent volumes, and the Generation Worker.

**Tech Stack:** Docker BuildKit, multi-stage Dockerfile, Docker Compose, Node.js 22, Next.js, PostgreSQL 16.6, PowerShell

---

### Task 1: Make Debian repositories configurable

**Files:**
- Modify: `Dockerfile:31-46`

- [ ] **Step 1: Confirm the current failure is isolated to the Debian repository**

Run:

```powershell
docker build --tag vozeb-pro:local .
```

Expected before the change: the runtime stage fails at `apt-get update` with a 502 response from `http://deb.debian.org`, while the Dockerfile parses successfully.

- [ ] **Step 2: Add repository build arguments and source replacement**

Insert the following after `WORKDIR /app` in the runtime stage and replace the existing one-line `apt-get` command:

```dockerfile
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security

RUN sed -i \
      -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
      -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-cjk postgresql-client \
    && rm -rf /var/lib/apt/lists/*
```

The security URI replacement must appear first because the main repository URI is its string prefix.

- [ ] **Step 3: Validate Dockerfile formatting**

Run:

```powershell
git diff --check -- Dockerfile
docker build --check .
```

Expected: both commands exit successfully with no Dockerfile warnings or errors.

- [ ] **Step 4: Commit the Dockerfile change**

```powershell
git add -- Dockerfile
git commit -m "build: support configurable Debian mirrors"
```

Expected: one commit containing only the Dockerfile change.

### Task 2: Build the current source image

**Files:**
- Read: `.env`
- Read: `Dockerfile`

- [ ] **Step 1: Confirm the deployment points to the local image without printing secrets**

Run:

```powershell
Get-Content -LiteralPath '.env' -Encoding UTF8 |
  Where-Object { $_ -match '^VOZEB_PRO_IMAGE=' }
```

Expected: `VOZEB_PRO_IMAGE=vozeb-pro:local`.

- [ ] **Step 2: Build the image with the verified Aliyun repositories**

Run:

```powershell
docker build `
  --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian `
  --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security `
  --tag vozeb-pro:local `
  .
```

Expected: package installation, `pnpm install --frozen-lockfile`, TypeScript type checking, Next.js production build, Sharp runtime validation, and image export all succeed.

- [ ] **Step 3: Inspect the resulting local image**

Run:

```powershell
docker image inspect vozeb-pro:local --format 'Image={{.Id}} Created={{.Created}}'
```

Expected: one local image ID and creation timestamp.

### Task 3: Deploy and verify the services

**Files:**
- Read: `.env`
- Read: `docker-compose.yml`

- [ ] **Step 1: Validate the resolved Compose configuration**

Run:

```powershell
docker compose config --quiet
```

Expected: exit code 0 without configuration errors.

- [ ] **Step 2: Start the deployment while preserving volumes**

Run:

```powershell
docker compose up -d
```

Expected: existing stopped v0.0.4 application containers are recreated with `vozeb-pro:local`; PostgreSQL reuses the existing named volume; no volume deletion occurs.

- [ ] **Step 3: Verify container and volume state**

Run:

```powershell
docker compose ps
docker inspect vozeb-pro --format 'Image={{.Config.Image}} Health={{.State.Health.Status}}'
docker inspect vozeb-pro-generation-worker --format 'Image={{.Config.Image}} Status={{.State.Status}}'
docker volume inspect vozeb-pro_vozeb-pro-data vozeb-pro_vozeb-pro-postgres --format '{{.Name}}'
```

Expected: PostgreSQL and the application are healthy, the Worker is running, both application containers use `vozeb-pro:local`, and both named volumes exist.

- [ ] **Step 4: Verify the application endpoint**

Run:

```powershell
$response = Invoke-WebRequest `
  -Uri 'http://127.0.0.1:3000/api/health/live' `
  -UseBasicParsing
$response.StatusCode
$response.Content
```

Expected: HTTP 200 and a VOZEB health payload with `code` equal to `0`.

- [ ] **Step 5: Check startup logs for fatal failures**

Run:

```powershell
docker logs --tail 100 vozeb-pro
docker logs --tail 100 vozeb-pro-generation-worker
```

Expected: no crash loop, missing-secret error, database connection failure, or fatal Worker authentication error.

### Task 4: Final repository and deployment checks

**Files:**
- Read: `docs/superpowers/specs/2026-08-19-docker-debian-mirror-design.md`
- Read: `docs/superpowers/plans/2026-08-19-docker-debian-mirror.md`

- [ ] **Step 1: Check repository consistency and secret isolation**

Run:

```powershell
git diff --check
git check-ignore .env
git status --short --branch
```

Expected: no whitespace errors, `.env` is ignored, and no unexpected files are modified.

- [ ] **Step 2: Record the final deployment state**

Report the source commit, local image ID, container health, health endpoint result, preserved volume names, and any verification gaps. Do not print `.env` values or tokens.
