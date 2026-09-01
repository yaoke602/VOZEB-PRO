import { NextResponse } from "next/server";

import { authorizedMcpUserId } from "@/lib/server/mcp-auth";
import { vozebMcpHandler } from "@/lib/server/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400;

async function handle(request: Request) {
    const auth = await authorizedMcpUserId(request);
    if (auth.status !== 200) return NextResponse.json({ code: auth.status, data: null, msg: auth.message }, { status: auth.status });
    return vozebMcpHandler.fetch(request, { authInfo: { token: "configured", clientId: auth.userId, scopes: ["mcp"] } });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
