import type { QianchuanAnalysis, QianchuanAsk, QianchuanPage, QianchuanQuery, QianchuanSettings, QianchuanStatus } from "@/lib/qianchuan-contract";
async function request<T>(action: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(`/api/qianchuan/${action}`, { cache: "no-store", signal, ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw new Error(payload.msg || "千川请求失败");
    return payload.data as T;
}
export const getQianchuanStatus = (signal?: AbortSignal) => request<QianchuanStatus>("status", undefined, signal);
export const getQianchuanData = (q: QianchuanQuery, signal?: AbortSignal) => request<QianchuanPage>(`data?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`, undefined, signal);
export const syncQianchuanData = (q: QianchuanQuery) => request<QianchuanPage>("sync", q);
export const saveQianchuanConfig = (s: Omit<QianchuanSettings, "hasSecret"> & { secret: string }) => request<QianchuanStatus>("settings", s);
export const authorizeQianchuan = () => request<{ url: string }>("authorize", {});
export const refreshQianchuanAccounts = () => request<QianchuanStatus>("accounts", {});
export const disconnectQianchuanAccount = (accountId: string) => request<QianchuanStatus>("disconnect", { accountId });
export const askQianchuanData = (input: QianchuanAsk) => request<QianchuanAnalysis>("ask", input);
export const getLatestQianchuanAnalysis = (accountId: string, signal?: AbortSignal) => request<QianchuanAnalysis | null>(`analysis?${new URLSearchParams({ accountId })}`, undefined, signal);
