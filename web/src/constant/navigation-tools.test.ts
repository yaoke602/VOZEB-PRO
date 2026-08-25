import { describe, expect, it } from "vitest";

import { landingNavigationTools, navigationGroups, navigationToolForPathname, navigationTools } from "./navigation-tools";

describe("user navigation order", () => {
    it("keeps the landing page entries in their dedicated order", () => {
        expect(landingNavigationTools).toEqual([
            { slug: "create", label: "Agent" },
            { slug: "drama", label: "短剧" },
            { slug: "gallery", label: "广场" },
        ]);
    });

    it("places the dedicated image and video workbenches before project tools", () => {
        expect(navigationGroups.map((group) => group.label)).toEqual(["创作", "项目", "资产", "社区"]);
        expect(navigationTools.filter((tool) => tool.group === "create").map((tool) => tool.slug)).toEqual(["create", "image", "video"]);
        expect(navigationTools.findIndex((tool) => tool.slug === "video")).toBeLessThan(navigationTools.findIndex((tool) => tool.slug === "canvas"));
    });

    it("combines published works and personal assets into the resource library", () => {
        expect(navigationTools.filter((tool) => tool.group === "assets").map((tool) => tool.label)).toEqual(["资源库", "提示词", "词库"]);
        expect(navigationToolForPathname("/works")?.slug).toBe("assets");
        expect(navigationToolForPathname("/assets")?.slug).toBe("assets");
        expect(navigationTools.filter((tool) => tool.group === "community").map((tool) => tool.label)).toEqual(["广场", "主页"]);
        expect(navigationTools.find((tool) => tool.group === "community")?.slug).toBe("community");
    });
});
