import { describe, expect, it } from "vitest";

import { imageWorkbenchSize, imageWorkbenchSizeLabel } from "./image-workbench-resolution";

describe("image workbench resolution presets", () => {
    it("maps 1K, 2K and 4K ratios to exact image dimensions", () => {
        expect(imageWorkbenchSize("1:1", "1K")).toBe("1024x1024");
        expect(imageWorkbenchSize("16:9", "2K")).toBe("2048x1152");
        expect(imageWorkbenchSize("16:9", "4K")).toBe("3840x2160");
        expect(imageWorkbenchSize("9:16", "4K")).toBe("2160x3840");
    });

    it("provides a compact visible summary", () => {
        expect(imageWorkbenchSizeLabel("3:4", "2K")).toBe("3:4 · 2K · 1536×2048");
    });
});
