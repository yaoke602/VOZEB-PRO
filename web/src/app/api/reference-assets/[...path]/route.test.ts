import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    registration: vi.fn(),
    read: vi.fn(),
    isValidPath: vi.fn(),
    stream: vi.fn(),
    disposition: vi.fn(),
    rate: vi.fn(),
    externalRead: vi.fn(),
    acquire: vi.fn(),
    wrap: vi.fn(),
    head: vi.fn(),
    release: vi.fn(),
}));

vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.registration }));
vi.mock("@/lib/server/reference-asset-store", () => ({ isReferenceAssetPath: mocks.isValidPath, readReferenceAsset: mocks.read }));
vi.mock("@/lib/server/local-media-response", () => ({
    createLocalMediaResponse: mocks.stream,
    createMediaHeadResponse: mocks.head,
    mediaContentDisposition: mocks.disposition,
}));
vi.mock("@/lib/server/media-concurrency", () => ({ acquireMediaConcurrency: mocks.acquire, withMediaConcurrency: mocks.wrap }));
vi.mock("@/lib/server/security", () => ({ checkPublicMediaRateLimit: mocks.rate, rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })) }));
vi.mock("@/lib/server/object-storage-service", () => ({ createExternalMediaReadUrl: mocks.externalRead }));

import { GET, HEAD } from "./route";

const context = { params: Promise.resolve({ path: ["permanent", "2026", "07", "20", "images", "file.png"] }) };
const assetUrl = "/api/reference-assets/permanent/2026/07/20/images/file.png";

describe("public reference asset access", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isValidPath.mockReturnValue(true);
        mocks.read.mockResolvedValue({ filePath: "asset.png", size: 5, mimeType: "image/png" });
        mocks.stream.mockResolvedValue(new Response("image"));
        mocks.registration.mockResolvedValue({ scope: "reference", ownerUserId: "owner", mimeType: "image/png" });
        mocks.disposition.mockReturnValue('inline; filename="file.png"');
        mocks.rate.mockResolvedValue({ allowed: true, remaining: 239, resetAt: Date.now() + 60_000 });
        mocks.externalRead.mockResolvedValue("https://storage.example/signed");
        mocks.acquire.mockReturnValue({ release: mocks.release });
        mocks.wrap.mockImplementation((response: Response) => response);
        mocks.head.mockReturnValue(new Response(null, { status: 200, headers: { "Content-Type": "image/png", "Content-Length": "5" } }));
    });

    it("rejects malformed paths before rate limiting or registration lookup", async () => {
        mocks.isValidPath.mockReturnValue(false);
        const response = await GET(new Request("http://localhost/api/reference-assets/not-valid"), { params: Promise.resolve({ path: ["not-valid"] }) });
        expect(response.status).toBe(404);
        expect(mocks.rate).not.toHaveBeenCalled();
        expect(mocks.registration).not.toHaveBeenCalled();
    });

    it("streams registered reference media without a login session", async () => {
        const response = await GET(new Request(`http://localhost${assetUrl}`), context);
        expect(response.status).toBe(200);
        expect(mocks.rate).toHaveBeenCalledWith(assetUrl, expect.any(Request));
        expect(mocks.acquire).toHaveBeenCalledWith("public", assetUrl);
        expect(mocks.disposition).toHaveBeenCalledWith("inline", "file.png", "image/png", "");
        expect(mocks.stream).toHaveBeenCalled();
    });

    it("continues to accept legacy signed query parameters without requiring them", async () => {
        const response = await GET(new Request(`http://localhost${assetUrl}?purpose=provider-read&expires=1&signature=legacy`), context);
        expect(response.status).toBe(200);
        expect(mocks.rate).toHaveBeenCalledWith(assetUrl, expect.any(Request));
    });

    it("does not expose a generation registration through the reference route", async () => {
        mocks.registration.mockResolvedValue({ scope: "generation", storageProvider: "object", externalObjectKey: "bucket/generation.png" });
        const getResponse = await GET(new Request(`http://localhost${assetUrl}`), context);
        const headResponse = await HEAD(new Request(`http://localhost${assetUrl}`, { method: "HEAD" }), context);
        expect(getResponse.status).toBe(404);
        expect(headResponse.status).toBe(404);
        expect(mocks.externalRead).not.toHaveBeenCalled();
        expect(mocks.head).not.toHaveBeenCalled();
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it("does not expose an unregistered file", async () => {
        mocks.registration.mockResolvedValue(null);
        const response = await GET(new Request(`http://localhost${assetUrl}`), context);
        expect(response.status).toBe(404);
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it("does not expose expired temporary media through local or object GET/HEAD paths", async () => {
        mocks.registration.mockResolvedValue({ scope: "reference", storageProvider: "object", externalObjectKey: "bucket/expired.png", expiresAt: "2020-01-01T00:00:00.000Z" });
        const getResponse = await GET(new Request(`http://localhost${assetUrl}`), context);
        const headResponse = await HEAD(new Request(`http://localhost${assetUrl}`, { method: "HEAD" }), context);
        expect(getResponse.status).toBe(404);
        expect(headResponse.status).toBe(404);
        expect(mocks.externalRead).not.toHaveBeenCalled();
        expect(mocks.head).not.toHaveBeenCalled();
        expect(mocks.read).not.toHaveBeenCalled();
        expect(mocks.stream).not.toHaveBeenCalled();
    });

    it("redirects an object-backed reference to a short-lived object url", async () => {
        mocks.registration.mockResolvedValue({ scope: "reference", ownerUserId: "owner", storageProvider: "object", externalObjectKey: "bucket/file.png" });
        const response = await GET(new Request(`http://localhost${assetUrl}`), context);
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://storage.example/signed");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-site");
        expect(mocks.read).not.toHaveBeenCalled();
    });

    it("answers object-backed HEAD without creating a GET signature", async () => {
        mocks.registration.mockResolvedValue({ scope: "reference", ownerUserId: "owner", storageProvider: "object", mimeType: "image/png", bytes: 5, originalName: "file.png" });
        const response = await HEAD(new Request(`http://localhost${assetUrl}`, { method: "HEAD" }), context);
        expect(response.status).toBe(200);
        expect(mocks.head).toHaveBeenCalled();
        expect(mocks.externalRead).not.toHaveBeenCalled();
        expect(mocks.acquire).not.toHaveBeenCalled();
    });

    it("allows anonymous original HEAD downloads", async () => {
        mocks.registration.mockResolvedValue({ scope: "reference", ownerUserId: "owner", storageProvider: "object", mimeType: "video/quicktime", bytes: 5, originalName: "generated-video" });
        await HEAD(new Request(`http://localhost${assetUrl}?download=original`, { method: "HEAD" }), context);
        expect(mocks.disposition).toHaveBeenCalledWith("attachment", "generated-video", "video/quicktime", "permanent/2026/07/20/images/file.png");
    });

    it("rejects excess public concurrency before opening local media", async () => {
        mocks.acquire.mockReturnValue(null);
        const response = await GET(new Request(`http://localhost${assetUrl}`), context);
        expect(response.status).toBe(429);
        expect(mocks.read).not.toHaveBeenCalled();
    });

    it("rate limits public access before reading the registration", async () => {
        mocks.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
        const response = await GET(new Request(`http://localhost${assetUrl}`), context);
        expect(response.status).toBe(429);
        expect(mocks.registration).not.toHaveBeenCalled();
        expect(mocks.read).not.toHaveBeenCalled();
        expect(mocks.stream).not.toHaveBeenCalled();
    });
});
