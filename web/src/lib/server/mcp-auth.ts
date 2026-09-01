import { createHash, timingSafeEqual } from "node:crypto";

import { getPublicUsersByIds } from "@/lib/auth/store";

const MIN_TOKEN_LENGTH = 32;

export async function authorizedMcpUserId(request: Request) {
    const token = process.env.VOZEB_PRO_MCP_TOKEN?.trim() || "";
    const userId = process.env.VOZEB_PRO_MCP_USER_ID?.trim().slice(0, 160) || "";
    if (token.length < MIN_TOKEN_LENGTH || !userId) return { status: 503, message: "MCP 服务尚未配置" } as const;

    const authorization = request.headers.get("authorization")?.trim() || "";
    const provided = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    if (!provided || !timingSafeEqual(digest(token), digest(provided))) return { status: 401, message: "MCP 令牌无效" } as const;

    const user = (await getPublicUsersByIds([userId]))[0];
    if (!user || user.status !== "active") return { status: 503, message: "MCP 绑定用户不存在或已停用" } as const;
    return { status: 200, userId } as const;
}

function digest(value: string) {
    return createHash("sha256").update(value).digest();
}
