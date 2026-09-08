import { describe, expect, it } from "vitest";
import { emptyRemake, parseRemakeAnalysis, remakeBusy, remakeShotPrompt, remakeSubjectDescription, type RemakeSubject } from "./remake-contract";

const frame = { assetId: "frame", url: "/api/reference-assets/permanent/frame.jpg", title: "画面", time: 0 };
const analysis = { subjects: [{ id: "shot-1", type: "person", name: "人物", description: "演员", frameIndex: 0 }], shots: [{ title: "镜头", description: "人物看镜头", dialogue: "", start: 0, duration: 5, subjectIds: ["shot-1"] }] };
describe("remake analysis contract", () => {
    it("parses fenced results, binds real frames and namespaces IDs", () => {
        const result = parseRemakeAnalysis(`\u0060\u0060\u0060json\n${JSON.stringify(analysis)}\n\u0060\u0060\u0060`, [frame], 5);
        expect(result.subjects[0]).toMatchObject({ id: "subject-shot-1", original: frame });
        expect(result.shots[0]).toMatchObject({ id: "shot-1", subjectIds: ["subject-shot-1"], dialogue: "" });
    });
    it("rejects invented frames, duplicate subjects and unknown shot references", () => {
        expect(() => parseRemakeAnalysis(JSON.stringify(analysis), [], 5)).toThrow();
        expect(() => parseRemakeAnalysis(JSON.stringify({ ...analysis, subjects: [...analysis.subjects, ...analysis.subjects] }), [frame], 5)).toThrow();
        expect(() => parseRemakeAnalysis(JSON.stringify({ ...analysis, shots: [{ ...analysis.shots[0], subjectIds: ["missing"] }] }), [frame], 5)).toThrow();
        expect(() => parseRemakeAnalysis(JSON.stringify({ ...analysis, shots: [{ ...analysis.shots[0], start: 7 }] }), [frame], 5)).toThrow();
    });
    it("uses deduplicated media aliases and supports text-only subjects", () => {
        const subjects: RemakeSubject[] = [
            { id: "a", type: "person", name: "角色", description: "", original: frame },
            { id: "b", type: "scene", name: "场景", description: "", original: frame },
            { id: "c", type: "product", name: "商品", description: "", replacement: { ...frame, assetId: "new" } },
            { id: "d", type: "product", name: "道具", description: "" },
        ];
        const prompt = remakeShotPrompt({ ...analysis.shots[0], id: "shot", subjectIds: ["a", "b", "c", "d"] }, subjects, "中文");
        expect(prompt).toContain("图片1：角色");
        expect(prompt).toContain("图片1：场景");
        expect(prompt).toContain("图片2：商品");
        expect(prompt).toContain("文字设定：道具");
        expect(prompt).not.toContain("图片3");
    });
    it("derives busy state from real work only", () => {
        expect(remakeBusy(emptyRemake())).toBe(false);
        expect(remakeBusy({ ...emptyRemake(), analysis: { status: "running", taskId: "t" } })).toBe(true);
        expect(remakeBusy({ ...emptyRemake(), render: { id: "r", status: "success", url: "/api/x" } })).toBe(false);
    });

    it("treats the original shot as staging only and replaces stale appearance descriptions with new reference bindings", () => {
        const subjects: RemakeSubject[] = [
            { id: "person", type: "person", name: "人物", description: "旧白衣和旧发型", original: frame, replacement: { ...frame, assetId: "new-person" } },
            { id: "product", type: "product", name: "梦畅苹果汁", description: "原桑椹汁的紫色液体", original: frame, replacement: { ...frame, assetId: "new-product" } },
            { id: "unselected", type: "product", name: "未选中的商品", description: "不应加入", replacement: frame },
            { id: "scene", type: "scene", name: "房间", description: "保留青绿墙和花卉", original: frame },
        ];
        const prompt = remakeShotPrompt({ ...analysis.shots[0], id: "shot", subjectIds: ["person", "product", "scene"], description: "原人物托着桑椹汁篮子，固定中景。", dialogue: "欢迎了解" }, subjects, "中文");
        const currentSubjects = prompt.split("本镜头当前主体设定：")[1];
        expect(prompt).toContain("不代表替换后的主体外观");
        expect(currentSubjects).toContain("图片1：人物");
        expect(currentSubjects).toContain("图片2：梦畅苹果汁");
        expect(currentSubjects).toContain("保留青绿墙和花卉");
        expect(currentSubjects).not.toMatch(/旧白衣|旧发型|紫色液体|未选中的商品/);
        expect(prompt).toContain("对白/旁白：欢迎了解");
        expect(remakeSubjectDescription({ ...subjects[0], replacement: undefined })).toContain("旧白衣和旧发型");
        const unchangedName = remakeSubjectDescription({ ...subjects[1], name: "原桑椹汁" });
        expect(unchangedName).toContain("可能仍来自原视频");
        expect(unchangedName).toContain("品名、外形、包装、材质、颜色及风格以本轮替换图片为准");
        expect(unchangedName).not.toContain("当前商品/道具名称为");
    });
});
