"use client";

import { AudioLines, Clapperboard, FileText, FolderOpen, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ResourceLibrarySection = "works" | "assets" | "image" | "text" | "audio";

const resourceSections = [
    { id: "works", label: "成片管理", href: "/works", icon: Clapperboard },
    { id: "assets", label: "素材管理", href: "/assets", icon: FolderOpen },
    { id: "image", label: "图片管理", href: "/assets?kind=image", icon: ImageIcon },
    { id: "text", label: "脚本管理", href: "/assets?kind=text", icon: FileText },
    { id: "audio", label: "音频管理", href: "/assets?kind=audio", icon: AudioLines },
] as const;

export function ResourceLibraryHeader({ active, actions, onNavigate }: { active: ResourceLibrarySection; actions?: ReactNode; onNavigate?: (section: ResourceLibrarySection) => void }) {
    const [optimisticActive, setOptimisticActive] = useState(active);

    useEffect(() => setOptimisticActive(active), [active]);

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
                    const selected = optimisticActive === section.id;
                    return (
                        <Link
                            key={section.id}
                            href={section.href}
                            aria-current={selected ? "page" : undefined}
                            onClick={(event) => {
                                if (!isDirectNavigation(event) || selected) return;
                                setOptimisticActive(section.id);
                                onNavigate?.(section.id);
                            }}
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

export function ResourceLibraryContentSkeleton({ label = "正在加载资源" }: { label?: string }) {
    return (
        <section className="grid min-h-40 grid-cols-1 gap-3 py-3 sm:min-h-56 sm:grid-cols-2 sm:py-5 lg:grid-cols-3 2xl:grid-cols-4" role="status" aria-label={label} aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="overflow-hidden rounded-xl border border-border bg-card motion-safe:animate-pulse">
                    <div className="aspect-[16/10] bg-muted" />
                    <div className="space-y-2.5 p-3.5">
                        <div className="h-4 w-2/3 rounded bg-muted" />
                        <div className="h-3 w-5/6 rounded bg-muted/80" />
                        <div className="flex gap-2 pt-1">
                            <div className="h-6 w-16 rounded-md bg-muted" />
                            <div className="h-6 w-12 rounded-md bg-muted/80" />
                        </div>
                    </div>
                </div>
            ))}
            <span className="sr-only">{label}</span>
        </section>
    );
}

function isDirectNavigation(event: MouseEvent<HTMLAnchorElement>) {
    return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
