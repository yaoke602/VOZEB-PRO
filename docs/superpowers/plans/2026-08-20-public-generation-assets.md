# Public Generation Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generation log media anonymously readable and convert its relative/internal URLs to the configured public site origin before sending references to external providers.

**Architecture:** Add one server helper that recognizes only `/api/generation-log-assets/` and rebuilds it on a validated public origin. The media Route becomes public while retaining the existing storage, path, concurrency, and rate-limit boundaries; image and video submission paths reuse the helper.

**Tech Stack:** Next.js Route Handlers, TypeScript, Vitest, S3-compatible object storage redirects.

---

### Task 1: Public generation URL normalization

**Files:**
- Create: `web/src/lib/server/generation-asset-access.ts`
- Create: `web/src/lib/server/generation-asset-access.test.ts`

- [ ] **Step 1: Write failing URL normalization tests**

Cover relative URLs, loopback absolute URLs, already-public URLs, query strings, unrelated URLs, and invalid public origins. The expected generation URL uses `https://aigc.mutangtech.com` supplied as the function argument; unrelated URLs remain unchanged.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --dir web exec vitest run src/lib/server/generation-asset-access.test.ts
```

Expected: failure because the helper does not exist.

- [ ] **Step 3: Implement the minimal helper**

Export `publicGenerationAssetInputUrl(value: string, publicOrigin: string)`. Parse `publicOrigin` as HTTP(S), parse `value` relative to it, and only rebuild URLs whose pathname starts with `/api/generation-log-assets/`. Preserve path and search parameters; return unrelated or unparseable input unchanged.

- [ ] **Step 4: Run the focused test**

Expected: all helper cases pass.

### Task 2: Anonymous generation media route

**Files:**
- Modify: `web/src/app/api/generation-log-assets/[...path]/route.ts`
- Modify: `web/src/app/api/generation-log-assets/[...path]/route.test.ts`

- [ ] **Step 1: Change tests to the public contract**

Remove Session and ownership mocks. Assert anonymous local GET, anonymous object-storage redirect, anonymous HEAD, public-resource rate limiting, concurrency rejection, and path traversal rejection.

- [ ] **Step 2: Run the Route test and verify failure**

Run:

```bash
pnpm --dir web exec vitest run 'src/app/api/generation-log-assets/[...path]/route.test.ts'
```

Expected: existing implementation still requests a Session and ownership.

- [ ] **Step 3: Implement anonymous reads**

Remove `getCurrentUser()` and `canAccessGenerationAsset()`. Call `checkPublicMediaRateLimit(assetUrl, request)`, use a public resource concurrency identity, and leave local reads, object redirects, HEAD responses, content disposition, path containment, and security headers intact.

- [ ] **Step 4: Run the Route test**

Expected: all anonymous access and safety cases pass.

### Task 3: External provider reference URLs

**Files:**
- Modify: `web/src/app/api/image-tasks/image-task-reference-urls.ts`
- Create: `web/src/app/api/image-tasks/image-task-reference-urls.test.ts`
- Modify: `web/src/app/api/video-generation-tasks/video-generation-route.ts`
- Modify: `web/src/app/api/video-generation-tasks/route.test.ts`

- [ ] **Step 1: Add failing image and video reference tests**

Assert that `/api/generation-log-assets/permanent/example.png` and its internal loopback form become `https://aigc.mutangtech.com/api/generation-log-assets/permanent/example.png`. Keep ordinary remote URLs and signed reference asset URLs unchanged.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm --dir web exec vitest run src/app/api/image-tasks/image-task-reference-urls.test.ts src/app/api/video-generation-tasks/route.test.ts
```

- [ ] **Step 3: Reuse the shared helper**

Apply `publicGenerationAssetInputUrl()` to image candidate URLs before external-public filtering. Apply it after `signReferenceAssetInputUrl()` in the video Route, using the value from `resolvePublicRequestOrigin(request)`.

- [ ] **Step 4: Run focused and related provider tests**

Expected: image, video, provider URL, and public-origin tests pass.

### Task 4: Documentation and quality gates

**Files:**
- Modify: `DEPLOY-GUIDE.md`
- Modify: `docs/content/docs/progress/pending-test.mdx`
- Inspect: `docs/content/docs/progress/todo.mdx`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the public media boundary**

State that all `/api/generation-log-assets/**` URLs are anonymously readable, while the Bucket stays private and list/delete/admin APIs stay protected. State that `NEXT_PUBLIC_SITE_URL` supplies provider-facing absolute URLs.

- [ ] **Step 2: Run focused tests, typecheck, lint, and full tests**

Run:

```bash
pnpm --dir web exec vitest run src/lib/server/generation-asset-access.test.ts 'src/app/api/generation-log-assets/[...path]/route.test.ts' src/app/api/image-tasks/image-task-reference-urls.test.ts src/app/api/video-generation-tasks/route.test.ts src/lib/server/provider-task-config.test.ts src/lib/server/public-request-origin.test.ts
pnpm --dir web run typecheck
pnpm --dir web run lint
pnpm --dir web test
```

Expected: all commands pass.

- [ ] **Step 3: Check text and diff integrity**

Run strict UTF-8 decoding for changed text files, scan for replacement characters and mojibake markers, then run `git diff --check`.

- [ ] **Step 4: Commit implementation**

Commit only the public generation asset implementation, tests, and documentation.
