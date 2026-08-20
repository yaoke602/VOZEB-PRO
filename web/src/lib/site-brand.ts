export const DEFAULT_SITE_TITLE = "梦畅AIGC";

export function resolveSiteTitle(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SITE_TITLE;
}
