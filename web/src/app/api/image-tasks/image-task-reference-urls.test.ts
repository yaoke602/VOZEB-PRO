import { describe, expect, it } from "vitest";

import { publicImageReferenceRequestUrl } from "./image-task-reference-urls";

const context = { ownerUserId: "user-one", taskId: "task-one" };

describe("publicImageReferenceRequestUrl", () => {
    it("publishes a generation asset on the configured public site origin", async () => {
        await expect(publicImageReferenceRequestUrl({ dataUrl: "/api/generation-log-assets/permanent/2026/08/20/images/result.png", type: "image/png" } as never, "http://127.0.0.1:3000", "https://aigc.mutangtech.com", context)).resolves.toBe(
            "https://aigc.mutangtech.com/api/generation-log-assets/permanent/2026/08/20/images/result.png",
        );
    });

    it("keeps an ordinary external provider-readable image URL", async () => {
        await expect(publicImageReferenceRequestUrl({ dataUrl: "https://cdn.example.com/reference.png", type: "image/png" } as never, "http://127.0.0.1:3000", "https://aigc.mutangtech.com", context)).resolves.toBe("https://cdn.example.com/reference.png");
    });
});
