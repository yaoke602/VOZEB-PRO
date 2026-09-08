import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRemake, type RemakeProject } from "@/lib/remake-contract";

const mocks = vi.hoisted(() => ({ getProject: vi.fn(), update: vi.fn(), asset: vi.fn(), assets: vi.fn(), run: vi.fn(), text: vi.fn(), render: vi.fn(), fetch: vi.fn() }));
vi.mock("./drama-project-store", () => ({ getDramaProject: mocks.getProject, updateDramaProject: mocks.update }));
vi.mock("./drama-project-service", () => ({
    createDramaProjectForUser: vi.fn(),
    DramaProjectServiceError: class extends Error {
        constructor(
            message: string,
            public status: number,
        ) {
            super(message);
        }
    },
}));
vi.mock("./creative-runtime-store", () => ({ getCreativeAsset: mocks.asset, getCreativeAssetsByIds: mocks.assets }));
vi.mock("./agent-run-store", () => ({ getAgentRunByClientRequestId: mocks.run }));
vi.mock("./text-task-store", () => ({ getTextTask: mocks.text, createTextTask: vi.fn() }));
vi.mock("./drama-render-store", () => ({ getDramaRenderTask: mocks.render }));
vi.mock("./remake-analysis", () => ({ prepareRemakeAnalysis: vi.fn() }));
vi.mock("./internal-origin", () => ({ fetchInternalApi: mocks.fetch }));
vi.mock("./generation-task-scheduler", () => ({ scheduleGenerationTask: vi.fn() }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: vi.fn() }));
vi.mock("./logical-model-router", () => ({ resolveLogicalModelCandidates: vi.fn() }));
vi.mock("./generation-channel", () => ({ toSystemGenerationChannel: vi.fn() }));
import { editRemake, getRemakeProject, ownedMedia, publicRemakeProject, recoverRemakeSubmissions, refreshRemake, startRemakeGeneration } from "./remake-service";

const clip = { assetId: "clip", title: "视频", url: "/api/reference-assets/permanent/clip.mp4" };
function fixture(): RemakeProject {
    return {
        id: "p",
        title: "复刻",
        summary: "",
        style: "真实",
        ratio: "9:16",
        status: "active",
        characters: [],
        scenes: [],
        props: [],
        clues: [],
        defaultVideoMode: "direct",
        episodes: [],
        creativeConversationId: "c",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        remake: {
            ...emptyRemake(),
            step: 2,
            source: clip,
            shots: [{ id: "shot", title: "镜头", description: "动作", dialogue: "", start: 0, duration: 5, subjectIds: [], selected: clip, job: { requestId: "request", status: "success", results: [clip] } }],
            render: { id: "render", status: "success", url: clip.url },
        },
    };
}
function edit(p: RemakeProject) {
    return { title: p.title, ratio: p.ratio, ...p.remake, shots: p.remake.shots.map((s) => ({ ...s, selectedAssetId: s.selected?.assetId })) };
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockResolvedValue(fixture());
    mocks.update.mockImplementation(async (_u, p) => p);
    mocks.asset.mockResolvedValue({ id: "clip", userId: "u", type: "video", status: "ready", title: "视频", serverUrl: clip.url });
    mocks.assets.mockResolvedValue([]);
    mocks.run.mockResolvedValue(null);
});

it("marks only new remake shot submissions and preserves the marker for stable recovery", async () => {
    const project = fixture();
    mocks.fetch.mockResolvedValue(Response.json({ code: 0 }));
    await startRemakeGeneration("u", project, "shot", "http://local.test", "session");
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(request.snapshot.workflow).toBe("remake");
    expect(request.preferences.mode).toBe("video");
    expect(project.remake.shots[0].job?.request?.snapshot).toMatchObject({ workflow: "remake" });
});

it("submits only selected current subjects and removes replaced appearance from the planner snapshot", async () => {
    const project = fixture();
    const image = { assetId: "new-person", title: "新人物", url: "/api/reference-assets/new.png" };
    project.remake.subjects = [
        { id: "person", type: "person", name: "人物", description: "原来的白衣服", replacement: image },
        { id: "product", type: "product", name: "苹果汁", description: "旧桑椹汁", replacement: { ...image, assetId: "new-product" } },
        { id: "other", type: "scene", name: "未选择的场景", description: "不应自动加入" },
    ];
    project.remake.shots[0].subjectIds = ["person", "product"];
    mocks.fetch.mockResolvedValue(Response.json({ code: 0 }));
    await startRemakeGeneration("u", project, "shot", "http://local.test", "session");
    const request = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(request.assetIds).toEqual(["new-person", "new-product"]);
    expect(request.snapshot.scenes).toEqual([]);
    expect(request.snapshot.props[0].name).toBe("苹果汁");
    expect(JSON.stringify([request.snapshot.characters, request.snapshot.props])).not.toMatch(/原来的白衣服|旧桑椹汁/);
    expect(request.snapshot.shots[0].descriptionSource).toBe("original-video");
    expect(project.remake.subjects[0].description).toBe("原来的白衣服");
});
describe("remake server boundaries", () => {
    it("fills the selected replacement shot with the public rewritten prompt while generation is running", async () => {
        const p = fixture();
        p.remake.subjects = [{ id: "product", type: "product", name: "梦畅苹果汁", description: "原桑椹汁", replacement: { ...clip, assetId: "apple" } }];
        p.remake.shots[0].subjectIds = ["product"];
        p.remake.shots[0].description = "手持桑椹汁，固定中景";
        mocks.fetch.mockResolvedValue(Response.json({ code: 0 }));
        await startRemakeGeneration("u", p, "shot", "http://local.test", "session");
        mocks.getProject.mockResolvedValue(p);
        mocks.run.mockResolvedValue({ id: "run", status: "running", assetIds: [], tasks: [{ type: "video", optimizedPrompt: "手持图片1中的梦畅苹果汁，固定中景", prompt: "不公开的执行附加内容" }] });
        const result = await refreshRemake("u", "p");
        expect(result.remake.shots[0].description).toBe("手持图片1中的梦畅苹果汁，固定中景");
        expect(result.remake.shots[0].job?.status).toBe("running");
        expect(result.remake.shots[0].job?.request?.snapshot).toMatchObject({ shots: [{ description: "手持桑椹汁，固定中景" }] });
        expect(result.remake.shots[0].dialogue).toBe("");
        expect(mocks.update).toHaveBeenLastCalledWith(
            "u",
            expect.objectContaining({ remake: expect.objectContaining({ shots: expect.arrayContaining([expect.objectContaining({ description: "手持图片1中的梦畅苹果汁，固定中景" })]) }) }),
            expect.any(String),
        );
        // Refreshes must not start another AI request or overwrite a newer edit.
        result.remake.shots[0].description = "用户后续修改";
        await refreshRemake("u", "p");
        expect(result.remake.shots[0].description).toBe("用户后续修改");
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it.each(["unselected", "planning", "multiple", "ordinary", "edited"])("preserves the draft when automatic replacement is not applicable: %s", async (scenario) => {
        const p = fixture();
        p.remake.subjects = [{ id: "product", type: "product", name: "苹果汁", description: "", replacement: clip }];
        p.remake.shots[0].subjectIds = scenario === "unselected" ? [] : ["product"];
        mocks.fetch.mockResolvedValue(Response.json({ code: 0 }));
        await startRemakeGeneration("u", p, "shot", "http://local.test", "session");
        if (scenario === "ordinary") p.remake.shots[0].job!.request!.snapshot = {};
        if (scenario === "edited") p.remake.shots[0].description = "新的手动修改";
        const before = p.remake.shots[0].description;
        mocks.getProject.mockResolvedValue(p);
        const task = { type: "video", optimizedPrompt: "新的描述" };
        mocks.run.mockResolvedValue({ id: "run", status: "running", assetIds: [], tasks: scenario === "planning" ? [] : scenario === "multiple" ? [task, task] : [task] });
        expect((await refreshRemake("u", "p")).remake.shots[0].description).toBe(before);
    });

    it("rejects another user's/missing project and media", async () => {
        mocks.getProject.mockResolvedValue(null);
        await expect(getRemakeProject("u", "foreign")).rejects.toMatchObject({ status: 404 });
        expect(mocks.getProject).toHaveBeenCalledWith("foreign", "u");
        mocks.asset.mockResolvedValue(null);
        await expect(ownedMedia("u", "foreign", "image")).rejects.toThrow();
        expect(mocks.asset).toHaveBeenCalledWith("foreign", "u");
    });
    it("invalidates stale final after duration change but preserves on title/step edit", async () => {
        const p = fixture();
        const same = await editRemake("u", p, { ...edit(p), title: "新标题" });
        expect(same.remake.render?.id).toBe("render");
        const modified = edit(p);
        modified.shots[0].duration = 10;
        expect((await editRemake("u", p, modified)).remake.render).toBeUndefined();
    });
    it("does not accept forged results or cross-list ID collisions", async () => {
        const p = fixture();
        const input = edit(p);
        input.shots[0].selectedAssetId = "forged";
        await expect(editRemake("u", p, input)).rejects.toThrow("本镜头");
        await expect(editRemake("u", p, { ...edit(p), subjects: [{ id: "shot", type: "person", name: "角色", description: "" }] })).rejects.toThrow("不能相同");
    });
    it("recovers local Agent submission with the same saved request identity", async () => {
        const p = fixture();
        const request = { clientRequestId: "stable", surface: "drama" as const, projectId: "p", prompt: "生成视频", assetIds: [], skillIds: [], modelIds: [] };
        p.remake.shots[0].job = { requestId: "stable", status: "pending", results: [], request };
        mocks.getProject.mockResolvedValue(p);
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {} })));
        await recoverRemakeSubmissions("u", "p", "http://localhost:3277", "fixture-cookie");
        expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual(request);
        expect(publicRemakeProject(p).remake.shots[0].job).not.toHaveProperty("request");
        expect(p.remake.shots[0].job.request).toEqual(request);
    });
    it("keeps previous versions and uses actual completed run duration", async () => {
        const p = fixture();
        p.remake.shots[0].job = { requestId: "new", status: "running", results: [clip] };
        mocks.getProject.mockResolvedValue(p);
        mocks.run.mockResolvedValue({ id: "run", status: "completed", assetIds: ["new-clip"], tasks: [{ type: "video", seconds: 8 }] });
        mocks.assets.mockResolvedValue([{ id: "new-clip", type: "video", status: "ready", title: "新视频", serverUrl: "/api/reference-assets/permanent/new.mp4" }]);
        const result = await refreshRemake("u", "p");
        expect(result.remake.shots[0].duration).toBe(8);
        expect(result.remake.shots[0].job?.results).toHaveLength(2);
        expect(result.remake.shots[0].selected?.assetId).toBe("new-clip");
    });
});
