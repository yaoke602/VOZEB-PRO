const GENERATION_ASSET_PREFIX = "/api/generation-log-assets/";

export function publicGenerationAssetInputUrl(value: string, publicOrigin: string) {
    const raw = value.trim();
    const origin = externalPublicOrigin(publicOrigin);
    if (!raw || !origin) return raw;
    try {
        const source = new URL(raw, origin);
        if (!source.pathname.startsWith(GENERATION_ASSET_PREFIX)) return raw;
        if (!canPublishOnConfiguredOrigin(raw, source, origin)) return raw;
        return `${origin}${source.pathname}${source.search}${source.hash}`;
    } catch {
        return raw;
    }
}

function canPublishOnConfiguredOrigin(raw: string, source: URL, publicOrigin: string) {
    if (source.protocol !== "http:" && source.protocol !== "https:") return false;
    if (source.username || source.password) return false;
    const isRelative = !/^[a-z][a-z\d+.-]*:/i.test(raw) && !raw.startsWith("//");
    return isRelative || source.origin === publicOrigin || !isExternalPublicHost(source.hostname);
}

function externalPublicOrigin(value: string) {
    try {
        const url = new URL(value.trim());
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !isExternalPublicHost(url.hostname)) return "";
        return url.origin;
    } catch {
        return "";
    }
}

function isExternalPublicHost(hostname: string) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1") return false;
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    const parts = host.split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
        const [a, b] = parts;
        return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
    }
    return host.includes(".") || host.includes(":");
}
