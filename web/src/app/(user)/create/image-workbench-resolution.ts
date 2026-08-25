export const imageWorkbenchRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export const imageWorkbenchResolutions = ["1K", "2K", "4K"] as const;

export type ImageWorkbenchRatio = (typeof imageWorkbenchRatios)[number];
export type ImageWorkbenchResolution = (typeof imageWorkbenchResolutions)[number];

const dimensions: Record<ImageWorkbenchResolution, Record<ImageWorkbenchRatio, string>> = {
    "1K": {
        "1:1": "1024x1024",
        "16:9": "1824x1024",
        "9:16": "1024x1824",
        "4:3": "1360x1024",
        "3:4": "1024x1360",
        "3:2": "1536x1024",
        "2:3": "1024x1536",
    },
    "2K": {
        "1:1": "2048x2048",
        "16:9": "2048x1152",
        "9:16": "1152x2048",
        "4:3": "2048x1536",
        "3:4": "1536x2048",
        "3:2": "2048x1360",
        "2:3": "1360x2048",
    },
    "4K": {
        "1:1": "4096x4096",
        "16:9": "3840x2160",
        "9:16": "2160x3840",
        "4:3": "3840x2880",
        "3:4": "2880x3840",
        "3:2": "3840x2560",
        "2:3": "2560x3840",
    },
};

export function imageWorkbenchSize(ratio: ImageWorkbenchRatio, resolution: ImageWorkbenchResolution) {
    return dimensions[resolution][ratio];
}

export function imageWorkbenchSizeLabel(ratio: ImageWorkbenchRatio, resolution: ImageWorkbenchResolution) {
    return `${ratio} · ${resolution} · ${imageWorkbenchSize(ratio, resolution).replace("x", "×")}`;
}
