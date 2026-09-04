import { z } from "zod";

const taskSchema = z.object({ taskId: z.string().trim().min(1), taskStatus: z.string(), url: z.string().nullable().optional() });
const responseSchema = z.object({ operationStatus: z.string(), data: z.array(taskSchema).min(1), error: z.object({ type: z.string().optional(), retryable: z.boolean().optional() }).nullable().optional() });

// requestId identifies the API call, never the video job. Do not use recursive fallbacks.
export function readQuickerVideoResponse(value: unknown) {
    const parsed = responseSchema.safeParse(value);
    if (!parsed.success) throw new Error("快客云响应缺少有效的 data[0].taskId 或任务状态，提交/查询结果无法确认");
    const task = parsed.data.data[0];
    return { ...task, operationStatus: parsed.data.operationStatus, error: parsed.data.error };
}
