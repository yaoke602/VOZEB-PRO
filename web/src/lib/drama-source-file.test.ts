import { describe, expect, it, vi } from "vitest";

import { readDramaSourceText } from "./drama-source-file";

describe("readDramaSourceText", () => {
    it("keeps plain text files on the native text path", async () => {
        const file = { name: "剧本.txt", text: vi.fn(async () => "第一章\n正文") } as unknown as File;

        await expect(readDramaSourceText(file)).resolves.toBe("第一章\n正文");
        expect(file.text).toHaveBeenCalledOnce();
    });

    it("extracts raw text from docx files", async () => {
        const file = { name: "剧本.DOCX" } as File;
        const extractDocxText = vi.fn(async () => "第一章\n\n正文");

        await expect(readDramaSourceText(file, extractDocxText)).resolves.toBe("第一章\n\n正文");
        expect(extractDocxText).toHaveBeenCalledWith(file);
    });

    it("returns a clear error for invalid docx files", async () => {
        const file = { name: "损坏.docx" } as File;
        const extractDocxText = vi.fn(async () => {
            throw new Error("invalid zip");
        });

        await expect(readDramaSourceText(file, extractDocxText)).rejects.toThrow("Word 文档读取失败，请确认文件是有效的 .docx 格式");
    });
});
