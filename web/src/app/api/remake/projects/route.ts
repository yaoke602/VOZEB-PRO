import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBody } from "@/lib/auth/request";
import { createRemakeProject } from "@/lib/server/remake-service";
import { listDramaProjectSummaries } from "@/lib/server/drama-project-store";

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const page = Number(new URL(request.url).searchParams.get("page")) || 1;
    const result = await listDramaProjectSummaries(user.id, { page, pageSize: 12, remake: true });
    return NextResponse.json({ code: 0, data: result, msg: "OK" });
}

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const body = await readJsonBody<{ title?: string }>(request);
    const project = await createRemakeProject(user.id, typeof body.title === "string" ? body.title.trim() : "");
    return NextResponse.json({ code: 0, data: { project }, msg: "复刻任务已创建" });
}
