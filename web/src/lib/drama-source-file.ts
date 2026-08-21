import { strFromU8, unzipSync } from "fflate";

type DocxTextExtractor = (file: File) => Promise<string>;
const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export async function readDramaSourceText(file: File, extractDocxText: DocxTextExtractor = extractDocxRawText) {
    if (!file.name.toLowerCase().endsWith(".docx")) return file.text();

    try {
        return await extractDocxText(file);
    } catch {
        throw new Error("Word 文档读取失败，请确认文件是有效的 .docx 格式");
    }
}

async function extractDocxRawText(file: File) {
    const document = unzipSync(new Uint8Array(await file.arrayBuffer()))["word/document.xml"];
    if (!document) throw new Error("missing Word document");
    const xml = new DOMParser().parseFromString(strFromU8(document), "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("invalid Word document");
    return Array.from(xml.getElementsByTagNameNS(WORD_NAMESPACE, "p"))
        .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "t"), (text) => text.textContent || "").join(""))
        .join("\n\n");
}
