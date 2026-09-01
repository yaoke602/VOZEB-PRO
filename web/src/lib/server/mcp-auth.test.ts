import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPublicUsersByIds: vi.fn() }));

vi.mock("@/lib/auth/store", () => ({ getPublicUsersByIds: mocks.getPublicUsersByIds }));

import { authorizedMcpUserId } from "./mcp-auth";

const token = "mcp-token-0123456789abcdef0123456789";

describe("MCP authentication", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("VOZEB_PRO_MCP_TOKEN", token);
        vi.stubEnv("VOZEB_PRO_MCP_USER_ID", "user-one");
        mocks.getPublicUsersByIds.mockResolvedValue([{ id: "user-one", status: "active" }]);
    });

    afterEach(() => vi.unstubAllEnvs());

    it("binds a valid bearer token to the configured active user", async () => {
        await expect(authorizedMcpUserId(request(token))).resolves.toEqual({ status: 200, userId: "user-one" });
    });

    it("rejects an invalid token without reading the user", async () => {
        await expect(authorizedMcpUserId(request("wrong-token"))).resolves.toMatchObject({ status: 401 });
        expect(mocks.getPublicUsersByIds).not.toHaveBeenCalled();
    });

    it("reports an unavailable binding when the configured user is inactive", async () => {
        mocks.getPublicUsersByIds.mockResolvedValue([{ id: "user-one", status: "disabled" }]);
        await expect(authorizedMcpUserId(request(token))).resolves.toMatchObject({ status: 503 });
    });
});

function request(value: string) {
    return new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer ${value}` } });
}
