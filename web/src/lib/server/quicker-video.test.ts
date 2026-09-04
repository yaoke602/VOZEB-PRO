import { describe, expect, it } from "vitest";
import { readQuickerVideoResponse } from "./quicker-video";
import { applyChannelProtocol, channelProtocolValidationErrors, channelSupportsModelCatalog, emptyAdvancedConfig, resolveChannelModelAdvancedConfig } from "@/lib/channel-protocol-registry";
import { normalizeSystemChannelAdvancedConfig } from "@/lib/auth/store-normalizers-channel";
import { assertVideoReferenceRoles, buildVideoProviderRequest } from "./provider-task-config";

describe("Quicker video contract", () => {
    it("uses only nested taskId and rejects missing job identity instead of requestId fallback", () => {
        expect(readQuickerVideoResponse({ requestId: "request", operationStatus: "SUCCEEDED", data: [{ taskId: "task", taskStatus: "QUEUED", url: null }] }).taskId).toBe("task");
        expect(() => readQuickerVideoResponse({ requestId: "request", operationStatus: "SUCCEEDED", data: [{ taskStatus: "QUEUED" }] })).toThrow("taskId");
    });
    it("persists a video-only preset without guessing a model catalog or first/last frame roles", () => {
        const channel = applyChannelProtocol({ id: "fixture", name: "快客云", models: ["bytedance/doubao-seedance-2-0-260128/e00e2"], baseUrl: "", apiKey: "fixture", enabled: true, apiFormat: "openai" }, "quicker");
        const config = normalizeSystemChannelAdvancedConfig(channel.advancedConfig)!;
        expect(config.protocol).toBe("quicker");
        expect(channelSupportsModelCatalog({ advancedConfig: config })).toBe(false);
        expect(channel.baseUrl).toBe("http://www.51quicker.com:18090/hyperone/xapi/api/v1");
        expect(applyChannelProtocol({ ...channel, baseUrl: `${channel.baseUrl}/videos` }, "quicker").baseUrl).toBe(channel.baseUrl);
        expect(channelProtocolValidationErrors({ ...channel, advancedConfig: config })).toEqual([]);
        const savedModel = config.modelConfigs![channel.models[0]];
        const oldTemplate = JSON.parse(savedModel.requestTemplate!);
        delete oldTemplate.resolution;
        const oldConfig = { ...config, modelConfigs: { ...config.modelConfigs, [channel.models[0]]: { ...savedModel, requestTemplate: JSON.stringify(oldTemplate) } } };
        expect(channelProtocolValidationErrors({ ...channel, advancedConfig: oldConfig })).toEqual([]);
        expect(resolveChannelModelAdvancedConfig(oldConfig, channel.models[0])?.requestTemplate).toContain('"resolution":"{{resolution}}"');
        expect(() => assertVideoReferenceRoles(config, [{ type: "image", url: "https://example.com/ref.png", role: "first_frame" }])).toThrow();
        const media = [
            { type: "image", url: "https://example.com/ref.png" },
            { type: "video", url: "https://example.com/ref.mp4" },
            { type: "audio", url: "https://example.com/ref.mp3" },
        ];
        expect(buildVideoProviderRequest(config.requestTemplate, {}, { model: "video-model", prompt: "测试视频", duration: 5, generate_audio: false, resolution: "720p", media })).toEqual({
            model: "video-model",
            prompt: "测试视频",
            duration: 5,
            generate_audio: false,
            resolution: "720p",
            media,
        });
        expect(emptyAdvancedConfig().protocol).toBe("auto");
        const switched = applyChannelProtocol({ ...channel, advancedConfig: { ...config, protocol: "custom", cancelPath: "/old/:task_id/cancel", cancelMethod: "DELETE" } }, "quicker");
        const restored = normalizeSystemChannelAdvancedConfig(switched.advancedConfig)!;
        expect(restored.cancelPath).toBeUndefined();
        expect(restored.cancelMethod).toBeUndefined();
        expect(resolveChannelModelAdvancedConfig({ ...restored, cancelPath: "/stale/cancel" }, channel.models[0])?.cancelPath).toBeUndefined();
    });
});
