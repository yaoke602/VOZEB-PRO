import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("dedicated workbench routes", () => {
    it.each(["image", "video"])("reuses the production creative runtime on /%s", async (route) => {
        const page = await readFile(resolve(process.cwd(), `src/app/(user)/${route}/page.tsx`), "utf8");

        expect(page).toContain('export { default } from "../create/page"');
        expect(page).not.toContain('"use client"');
        expect(page).not.toContain("redirect(");
    });

    it("locks each route to its matching workbench mode", async () => {
        const page = await readFile(resolve(process.cwd(), "src/app/(user)/create/page.tsx"), "utf8");
        const imageWorkbench = await readFile(resolve(process.cwd(), "src/app/(user)/create/components/image-workbench-view.tsx"), "utf8");
        const videoWorkbench = await readFile(resolve(process.cwd(), "src/app/(user)/create/components/video-workbench-view.tsx"), "utf8");
        const historyList = await readFile(resolve(process.cwd(), "src/app/(user)/create/components/workbench-generation-history-list.tsx"), "utf8");

        expect(page).toContain('pathname === "/image" ? "image" : pathname === "/video" ? "video"');
        expect(page).toContain("<ImageWorkbenchView");
        expect(page).toContain("<VideoWorkbenchView");
        expect(imageWorkbench).toContain('data-testid="image-workbench-view"');
        expect(videoWorkbench).toContain('data-testid="video-workbench-view"');
        expect(imageWorkbench).toContain('<WorkbenchGenerationHistoryList kind="image"');
        expect(videoWorkbench).toContain('<WorkbenchGenerationHistoryList kind="video"');
        expect(historyList).toContain('data-testid="workbench-generation-history-list"');
        expect(historyList).toContain("设为参考 →");
        expect(videoWorkbench).toContain('"reference", "first_frame", "first_last"');
        expect(videoWorkbench).toContain("onPreferenceChange({ generateAudio: checked })");
        expect(page).toContain("modeLocked={Boolean(workspaceMode)}");
    });
});
