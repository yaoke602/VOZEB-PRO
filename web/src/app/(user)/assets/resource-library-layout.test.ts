import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("resource library layout", () => {
    it("shares one five-section resource navigation across works and assets", async () => {
        const [header, works, assets] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/assets/resource-library-header.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/works/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/assets/page.tsx"), "utf8"),
        ]);

        expect(header).toContain('label: "成片管理"');
        expect(header).toContain('label: "素材管理"');
        expect(header).toContain('label: "图片管理"');
        expect(header).toContain('label: "脚本管理"');
        expect(header).toContain('label: "音频管理"');
        expect(works).toContain("<ResourceLibraryHeader");
        expect(works).toContain('active="works"');
        expect(works).toContain("listWorkPublications");
        expect(assets).toContain("<ResourceLibraryHeader");
        expect(assets).toContain("useAssetPage");
        expect(assets).toContain('{ label: "脚本", value: "text" }');
    });

    it("keeps publication actions and material actions on their original data flows", async () => {
        const [works, assets] = await Promise.all([readFile(resolve(process.cwd(), "src/app/(user)/works/page.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/(user)/assets/page.tsx"), "utf8")]);

        expect(works).toContain("submitWorkPublication");
        expect(works).toContain("revokeWorkPublication");
        expect(works).toContain("relistWorkPublication");
        expect(assets).toContain("listAllLibraryAssets");
        expect(assets).toContain("addAsset");
        expect(assets).toContain("removeAsset");
    });
});
