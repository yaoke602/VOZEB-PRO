import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBodyResult } from "@/lib/auth/request";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { qianchuanQuerySchema } from "@/lib/qianchuan-contract";
import { QianchuanError } from "@/lib/server/qianchuan-provider";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { completeQianchuanAuthorization, disconnectQianchuan, qianchuanStatus, readQianchuanPage, refreshQianchuanAccounts, saveQianchuanSettings, startQianchuanAuthorization, syncQianchuan } from "@/lib/server/qianchuan-service";
import { askQianchuan, latestQianchuanAnalysis } from "@/lib/server/qianchuan-analysis-service";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { checkGenerationRateLimit } from "@/lib/server/security";

export const runtime = "nodejs";
export const maxDuration = 2400;
type Context = { params: Promise<{ action: string }> };
const json = (data: unknown, msg = "OK", status = 200) => NextResponse.json({ code: status === 200 ? 0 : status, data, msg }, { status, headers: { "Cache-Control": "private, no-store" } });
async function handle(request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return json(null, "请先登录", 401);
    const { action } = await context.params;
    const canConfigure = hasAdminPermission(user, "system.manage");
    try {
        if (request.method === "GET") {
            if (action === "status") return json(await qianchuanStatus(user.id, canConfigure));
            if (action === "analysis") return json(await latestQianchuanAnalysis(user.id, new URL(request.url).searchParams.get("accountId") || ""));
            if (action === "data") {
                const parsed = qianchuanQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
                if (!parsed.success) throw new QianchuanError(parsed.error.issues[0].message);
                return json(await readQianchuanPage(user.id, parsed.data));
            }
            if (action === "callback") {
                const params = new URL(request.url).searchParams;
                await completeQianchuanAuthorization(user.id, params.get("state") || "", params.get("auth_code") || "");
                return new NextResponse(null, { status: 303, headers: { Location: "/analytics?authorized=1", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
            }
        }
        if (request.method === "POST") {
            // Global proxy.ts enforces same-origin with the configured trusted-proxy boundary.
            const body = await readJsonBodyResult<unknown>(request);
            if (!body.ok) return json(null, body.message, body.status);
            if (action === "ask") {
                if (!(await checkGenerationRateLimit(user.id, request, "text")).allowed) throw new QianchuanError("查数请求过于频繁，请稍后重试", 429);
                return json(await askQianchuan({ userId: user.id, origin: resolveInternalOrigin(new URL(request.url).origin), cookie: request.headers.get("cookie") || "", signal: request.signal }, body.data));
            }
            if (action === "settings") {
                if (!canConfigure) throw new QianchuanError("需要系统管理权限", 403);
                await saveQianchuanSettings(body.data);
                await safeRecordAuditLog({ action: "admin.qianchuan.settings.update", actor: auditActorFromRequest(request, user), target: { type: "settings", id: "qianchuan" } });
                return json(await qianchuanStatus(user.id, canConfigure), "应用配置已保存");
            }
            if (action === "authorize") return json({ url: await startQianchuanAuthorization(user.id) });
            if (action === "accounts") {
                await refreshQianchuanAccounts(user.id);
                return json(await qianchuanStatus(user.id, canConfigure));
            }
            if (action === "disconnect") {
                const id = typeof body.data === "object" && body.data && "accountId" in body.data ? body.data.accountId : null;
                if (typeof id !== "string" || !id) throw new QianchuanError("请选择账户");
                await disconnectQianchuan(user.id, id);
                await safeRecordAuditLog({ action: "qianchuan.account.disconnect", actor: auditActorFromRequest(request, user), target: { type: "qianchuan_account", id } });
                return json(await qianchuanStatus(user.id, canConfigure));
            }
            if (action === "sync") {
                const parsed = qianchuanQuerySchema.safeParse(body.data);
                if (!parsed.success) throw new QianchuanError(parsed.error.issues[0].message);
                return json(await syncQianchuan(user.id, parsed.data), "同步完成");
            }
        }
        return json(null, "接口不存在", 404);
    } catch (error) {
        if (action === "settings") await safeRecordAuditLog({ action: "admin.qianchuan.settings.update", status: "failure", actor: auditActorFromRequest(request, user), target: { type: "settings", id: "qianchuan" } });
        if (action === "callback")
            return new NextResponse(null, {
                status: 303,
                headers: { Location: `/analytics?authorizationError=${encodeURIComponent(error instanceof QianchuanError ? error.message : "授权处理失败，请重新授权或刷新授权账户")}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
            });
        return json(null, error instanceof QianchuanError ? error.message : "千川数据操作失败，请检查数据库及服务端配置", error instanceof QianchuanError ? error.status : 500);
    }
}
export const GET = handle;
export const POST = handle;
