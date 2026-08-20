import { describe, expect, it } from "vitest";

import { publicGenerationAssetInputUrl } from "./generation-asset-access";

describe("publicGenerationAssetInputUrl", () => {
    const publicOrigin = "https://aigc.mutangtech.com";

    it("builds a public absolute URL for a relative generation asset", () => {
        expect(publicGenerationAssetInputUrl("/api/generation-log-assets/permanent/2026/08/20/images/result.png?format=webp&width=1920", publicOrigin)).toBe(
            "https://aigc.mutangtech.com/api/generation-log-assets/permanent/2026/08/20/images/result.png?format=webp&width=1920",
        );
    });

    it("replaces an internal loopback origin with the configured public origin", () => {
        expect(publicGenerationAssetInputUrl("http://127.0.0.1:3000/api/generation-log-assets/permanent/result.png", publicOrigin)).toBe("https://aigc.mutangtech.com/api/generation-log-assets/permanent/result.png");
    });

    it("keeps an existing URL on the configured public origin", () => {
        expect(publicGenerationAssetInputUrl("https://aigc.mutangtech.com/api/generation-log-assets/permanent/result.mp4", publicOrigin)).toBe("https://aigc.mutangtech.com/api/generation-log-assets/permanent/result.mp4");
    });

    it("does not rewrite a third-party URL that happens to use the same path", () => {
        expect(publicGenerationAssetInputUrl("https://provider.example/api/generation-log-assets/permanent/result.mp4", publicOrigin)).toBe("https://provider.example/api/generation-log-assets/permanent/result.mp4");
    });

    it("leaves unrelated URLs unchanged", () => {
        expect(publicGenerationAssetInputUrl("https://cdn.example.com/reference.png", publicOrigin)).toBe("https://cdn.example.com/reference.png");
        expect(publicGenerationAssetInputUrl("/api/reference-assets/permanent/reference.png", publicOrigin)).toBe("/api/reference-assets/permanent/reference.png");
    });

    it("leaves input unchanged when the configured public origin is invalid", () => {
        expect(publicGenerationAssetInputUrl("/api/generation-log-assets/permanent/result.png", "http://127.0.0.1:3000")).toBe("/api/generation-log-assets/permanent/result.png");
        expect(publicGenerationAssetInputUrl("/api/generation-log-assets/permanent/result.png", "not-a-url")).toBe("/api/generation-log-assets/permanent/result.png");
    });
});
