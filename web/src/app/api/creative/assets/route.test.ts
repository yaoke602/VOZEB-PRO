import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    listRecentAssetsForUser: vi.fn(),
    uploadAssetForUser: vi.fn(),
    importLibraryAssetForUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/creative-runtime-service", () => ({
    CreativeRuntimeServiceError: class CreativeRuntimeServiceError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    },
    listRecentAssetsForUser: mocks.listRecentAssetsForUser,
    uploadAssetForUser: mocks.uploadAssetForUser,
    importLibraryAssetForUser: mocks.importLibraryAssetForUser,
}));

import { GET, POST } from "./route";

describe("GET /api/creative/assets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.listRecentAssetsForUser.mockResolvedValue([{ id: "asset-one", type: "image" }]);
    });

    it("returns recent generated media without opening each conversation", async () => {
        const response = await GET(new Request("http://localhost/api/creative/assets?limit=40"));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ code: 0, data: { assets: [{ id: "asset-one" }] } });
        expect(mocks.listRecentAssetsForUser).toHaveBeenCalledWith("user-one", 40);
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/creative/assets"));

        expect(response.status).toBe(401);
        expect(mocks.listRecentAssetsForUser).not.toHaveBeenCalled();
    });
});

describe("POST /api/creative/assets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.uploadAssetForUser.mockResolvedValue({ id: "asset-one", type: "audio" });
        mocks.importLibraryAssetForUser.mockResolvedValue({ id: "asset-library", type: "image" });
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await POST(request("conversation-one", new File(["audio"], "voice.mp3", { type: "audio/mpeg" })));

        expect(response.status).toBe(401);
        expect(mocks.uploadAssetForUser).not.toHaveBeenCalled();
    });

    it("passes a multipart media file to the owned conversation", async () => {
        const file = new File(["audio"], "voice.mp3", { type: "audio/mpeg" });
        const response = await POST(request("conversation-one", file));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ code: 0, data: { asset: { id: "asset-one" } } });
        expect(mocks.uploadAssetForUser).toHaveBeenCalledWith("user-one", "conversation-one", expect.objectContaining({ name: "voice.mp3", type: "audio/mpeg" }));
    });

    it("imports an owned library resource as a creative reference", async () => {
        const response = await POST(
            new Request("http://localhost/api/creative/assets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: "conversation-one", libraryAssetId: "library-one" }),
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ code: 0, data: { asset: { id: "asset-library" } }, msg: "素材已引用" });
        expect(mocks.importLibraryAssetForUser).toHaveBeenCalledWith("user-one", "conversation-one", "library-one");
        expect(mocks.uploadAssetForUser).not.toHaveBeenCalled();
    });

    it("rejects a missing conversation before calling the service", async () => {
        const response = await POST(request("", new File(["video"], "clip.mp4", { type: "video/mp4" })));

        expect(response.status).toBe(400);
        expect(mocks.uploadAssetForUser).not.toHaveBeenCalled();
    });

    it("rejects an oversized multipart request before parsing it", async () => {
        const response = await POST(
            new Request("http://localhost/api/creative/assets", {
                method: "POST",
                headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(20 * 1024 * 1024 + 64 * 1024 + 1) },
                body: "--test--",
            }),
        );

        expect(response.status).toBe(413);
        expect((await response.json()).msg).toBe("单个素材不能超过 20MB");
        expect(mocks.uploadAssetForUser).not.toHaveBeenCalled();
    });
});

function request(conversationId: string, file: File) {
    const body = new FormData();
    body.set("conversationId", conversationId);
    body.set("file", file);
    return new Request("http://localhost/api/creative/assets", { method: "POST", body });
}
