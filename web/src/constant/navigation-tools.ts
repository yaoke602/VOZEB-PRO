import { BookMarked, Clapperboard, Compass, FileText, FolderHeart, ImageIcon, Maximize2, Sparkles, UserRound, Video } from "lucide-react";

export const navigationGroups = [
    { id: "create", label: "创作" },
    { id: "projects", label: "项目" },
    { id: "assets", label: "资产" },
    { id: "community", label: "社区" },
] as const;

export const landingNavigationTools = [
    { slug: "create", label: "Agent" },
    { slug: "drama", label: "短剧" },
    { slug: "gallery", label: "广场" },
] as const;

export const navigationTools = [
    {
        slug: "create",
        label: "Agent 创作",
        description: "统一创作入口",
        group: "create",
        icon: Sparkles,
        primary: true,
    },
    {
        slug: "image",
        label: "AI 生图",
        description: "图片生成与编辑",
        group: "create",
        icon: ImageIcon,
    },
    {
        slug: "video",
        label: "AI 视频",
        description: "文本与图片生成视频",
        group: "create",
        icon: Video,
    },
    {
        slug: "canvas",
        label: "画布",
        description: "节点式多媒体创作",
        group: "projects",
        icon: Maximize2,
    },
    {
        slug: "drama",
        label: "短剧",
        description: "剧本、分镜与成片",
        group: "projects",
        icon: Clapperboard,
    },
    {
        slug: "assets",
        label: "资源库",
        description: "成片、素材与脚本",
        group: "assets",
        icon: FolderHeart,
    },
    {
        slug: "my-prompts",
        label: "提示词",
        description: "个人提示词",
        group: "assets",
        icon: BookMarked,
    },
    {
        slug: "prompts",
        label: "词库",
        description: "公共提示词",
        group: "assets",
        icon: FileText,
    },
    {
        slug: "community",
        label: "广场",
        description: "发现公开作品",
        group: "community",
        icon: Compass,
    },
    {
        slug: "me",
        label: "主页",
        description: "已发布与我的喜欢",
        group: "community",
        icon: UserRound,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
export type NavigationGroupId = (typeof navigationGroups)[number]["id"];

export function navigationToolForPathname(pathname: string) {
    const slug = pathname.split("/").filter(Boolean)[0];
    if (slug === "works") return navigationTools.find((tool) => tool.slug === "assets");
    return navigationTools.find((tool) => tool.slug === slug);
}
