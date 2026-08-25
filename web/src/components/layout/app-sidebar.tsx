"use client";

import { ChevronRight, CircleHelp, Coins } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { SiteLogo } from "@/components/layout/site-logo";
import { formatCreditAmount } from "@/constant/credits";
import { navigationGroups, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";
import { userAvatarFallback } from "@/lib/user-avatar";

export function AppSidebar({ activeToolSlug, expanded }: { activeToolSlug?: NavigationToolSlug; expanded: boolean }) {
    const pathname = usePathname();
    const router = useRouter();
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const helpActive = pathname.startsWith("/help");
    const user = useUserStore((state) => state.user);
    const avatarFallback = userAvatarFallback(user?.displayName || user?.username || "用户");

    return (
        <aside className={cn("hidden h-full shrink-0 flex-col border-r border-[#e8ebf0] bg-[#fbfcfe] text-[#172033] transition-[width] duration-200 lg:flex dark:border-[#292d33] dark:bg-[#111316] dark:text-[#f3f5f7]", expanded ? "w-60" : "w-[72px]")}>
            <Link href="/create" className={cn("flex h-16 shrink-0 items-center border-b border-[#e8ebf0] px-3 dark:border-[#292d33]", expanded ? "justify-start px-5" : "justify-center")} aria-label={siteTitle}>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white shadow-[0_4px_16px_rgba(27,39,67,0.08)] ring-1 ring-[#e5e9f0] dark:bg-[#1c2025] dark:ring-[#30363e]">
                    <SiteLogo logoUrl={site.logoUrl} className="size-7" />
                </span>
                {expanded ? (
                    <span className="ml-3 min-w-0">
                        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{siteTitle}</span>
                        <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.18em] text-[#9aa3b0] dark:text-[#747d88]">Creative Studio</span>
                    </span>
                ) : null}
            </Link>

            <nav className={cn("hide-scrollbar min-h-0 flex-1 overflow-y-auto py-4", expanded ? "px-3" : "px-2")} aria-label="工作空间导航">
                {navigationGroups.map((group, groupIndex) => {
                    const tools = navigationTools.filter((tool) => tool.group === group.id);
                    return (
                        <div key={group.id} className={cn(groupIndex > 0 && "mt-[22px]")}>
                            {expanded ? <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a0a8b4] dark:text-[#737d89]">{group.label}</div> : null}
                            <div className="space-y-1">
                                {tools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    const primary = "primary" in tool && tool.primary;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            href={`/${tool.slug}`}
                                            prefetch
                                            title={tool.label}
                                            onMouseEnter={() => router.prefetch(`/${tool.slug}`)}
                                            onFocus={() => router.prefetch(`/${tool.slug}`)}
                                            className={cn(
                                                "group relative flex h-[42px] items-center rounded-xl px-2 text-sm font-medium transition-all duration-150",
                                                expanded ? "justify-start gap-3 px-3" : "justify-center",
                                                active
                                                    ? "bg-white text-[#1f2a44] shadow-[0_5px_18px_rgba(35,55,92,0.07)] ring-1 ring-[#e5e9f1] dark:bg-[#232731] dark:text-[#f3f5f7] dark:ring-[#343a45]"
                                                    : primary
                                                      ? "text-[#29344c] hover:bg-white hover:shadow-sm dark:text-[#d4d9df] dark:hover:bg-[#20242a]"
                                                      : "text-[#566175] hover:bg-white hover:text-[#1f2a44] hover:shadow-sm dark:text-[#c7cdd5] dark:hover:bg-[#20242a] dark:hover:text-[#f3f5f7]",
                                            )}
                                            aria-current={active ? "page" : undefined}
                                        >
                                            <Icon className={cn("size-[18px] shrink-0", active && "text-[#465bdb]")} />
                                            {expanded ? <span className="min-w-0 truncate">{tool.label}</span> : null}
                                            {active ? <span className="absolute right-2.5 h-[18px] w-0.5 rounded-full bg-[#465bdb]" /> : null}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </nav>

            <div className={cn("shrink-0 border-t border-[#e8ebf0] dark:border-[#292d33]", expanded ? "px-3 pb-3 pt-3" : "p-2")}>
                <Link
                    href="/help"
                    prefetch
                    title="帮助"
                    onMouseEnter={() => router.prefetch("/help")}
                    onFocus={() => router.prefetch("/help")}
                    className={cn(
                        "relative flex min-h-[46px] items-center rounded-lg px-2 text-sm font-medium text-[#111827] transition-colors duration-150 hover:bg-[#f8f9fb] dark:text-[#c7cdd5] dark:hover:bg-[#20242a] dark:hover:text-[#f3f5f7]",
                        expanded ? "justify-start gap-3 px-2" : "justify-center",
                        helpActive && "bg-[#f0f2f4] text-[#1d2127] dark:bg-[#22262c] dark:text-[#f3f5f7]",
                    )}
                    aria-current={helpActive ? "page" : undefined}
                >
                    <CircleHelp className="size-[18px] shrink-0" />
                    {expanded ? (
                        <>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate">帮助</span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-[#7f8995]" />
                        </>
                    ) : null}
                    {helpActive ? <span className="absolute right-0 h-4 w-0.5 rounded-full bg-[#5965ff]" /> : null}
                </Link>
                {expanded && user ? (
                    <div className="mt-2 rounded-2xl border border-[#e4e8ef] bg-white p-2.5 shadow-[0_8px_24px_rgba(35,55,92,0.055)] dark:border-[#30363e] dark:bg-[#191c21]">
                        <Link href="/profile" className="flex min-w-0 items-center gap-2.5 rounded-xl p-1 transition hover:bg-[#f5f7fa] dark:hover:bg-[#24282e]">
                            {user.avatarUrl ? (
                                <img src={user.avatarUrl} alt="" className="size-9 shrink-0 rounded-xl object-cover" referrerPolicy="no-referrer" />
                            ) : (
                                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e9edff] text-xs font-semibold text-[#465bdb] dark:bg-[#2d3350] dark:text-[#bdc5ff]">{avatarFallback}</span>
                            )}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold text-[#273149] dark:text-[#edf1f6]">{user.displayName || user.username}</span>
                                <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#8a94a3] dark:text-[#7e8895]">
                                    <Coins className="size-3" />
                                    {formatCreditAmount(user.pointsBalance)} 积分
                                </span>
                            </span>
                            <ChevronRight className="size-3.5 shrink-0 text-[#a1a9b5]" />
                        </Link>
                    </div>
                ) : null}
            </div>
        </aside>
    );
}
