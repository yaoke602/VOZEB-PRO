import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorizedMcpUserId: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/server/mcp-auth", () => ({ authorizedMcpUserId: mocks.authorizedMcpUserId }));
vi.mock("@/lib/server/mcp-server", () => ({ vozebMcpHandler: { fetch: mocks.fetch } }));

import { maxDuration, POST } from "./route";

describe("POST /api/mcp", () => {
    beforeEach(() => vi.clearAllMocks());

    it("keeps asynchronous Agent recovery within the long route lifecycle", () => {
        expect(maxDuration).toBeGreaterThanOrEqual(40 * 60);
    });

    it("rejects requests before entering the MCP handler when the token is invalid", async () => {
        mocks.authorizedMcpUserId.mockResolvedValue({ status: 401, message: "MCP 令牌无效" });
        const response = await POST(request());
        expect(response.status).toBe(401);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("passes the configured user identity to the MCP handler", async () => {
        mocks.authorizedMcpUserId.mockResolvedValue({ status: 200, userId: "user-one" });
        mocks.fetch.mockResolvedValue(new Response("ok"));
        const input = request();
        const response = await POST(input);
        expect(await response.text()).toBe("ok");
        expect(mocks.fetch).toHaveBeenCalledWith(input, { authInfo: { token: "configured", clientId: "user-one", scopes: ["mcp"] } });
    });
});

function request() {
    return new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" }, body: "{}" });
}
