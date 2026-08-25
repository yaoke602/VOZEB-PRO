"use client";

import { AudioLines, Clapperboard, FileText, FolderOpen, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ResourceLibrarySection = "works" | "assets" | "image" | "text" | "audio";

const resourceSections = [
    { id: "works", label: "成片管理", href: "/works", icon: Clapperboard },
    { id: "assets", label: "素材管理", href: "/assets", icon: FolderOpen },
    { id: "image", label: "图片管理", href: "/assets?kind=image", icon: ImageIcon },
    { id: "text", label: "脚本管理", href: "/assets?kind=text", icon: FileText },
    { id: "audio", label: "音频管理", href: "/assets?kind=audio", icon: AudioLines },
] as const;

export function ResourceLibraryHeader({ active, actions }: { active: ResourceLibrarySection; actions?: ReactNode }) {
    return (
        <header className="border-b border-border pb-3 sm:pb-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">资源库</h1>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">统一管理成片、素材、脚本、图片与音频</p>
                </div>
                {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
            </div>

            <nav className="mt-4 flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="资源库分类">
                {resourceSections.map((section) => {
                    const Icon = section.icon;
                    const selected = active === section.id;
                    return (
                        <Link
                            key={section.id}
                            href={section.href}
                            aria-current={selected ? "page" : undefined}
                            className={cn(
                                "flex h-11 min-w-[132px] flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selected && "bg-primary/10 text-primary shadow-[inset_0_-2px_0_currentColor] hover:bg-primary/10 hover:text-primary",
                            )}
                        >
                            <Icon className="size-4 shrink-0" />
                            <span className="whitespace-nowrap">{section.label}</span>
                        </Link>
                    );
                })}
            </nav>
        </header>
    );
}
