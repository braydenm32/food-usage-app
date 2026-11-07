import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { deleteAccount, fromThisSite } = await import("./handler");

const URL_ = "https://larder.example.com/api/account/delete";

function req(headers: Record<string, string>) {
  return new Request(URL_, { method: "POST", headers: { host: "larder.example.com", ...headers } });
}

function fakeAdmin(user: { id: string } | null, deleteError: unknown = null) {
  const deleted: string[] = [];
  return {
    deleted,
    auth: {
      getUser: vi.fn(async (token: string) =>
        token === "good" && user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "bad jwt" } },
      ),
      admin: {
        deleteUser: vi.fn(async (id: string) => {
          if (!deleteError) deleted.push(id);
          return { error: deleteError };
        }),
      },
    },
  };
}

describe("POST /api/account/delete", () => {
  it("deletes the caller's own account", async () => {
    const admin = fakeAdmin({ id: "u1" });
    const res = await deleteAccount(req({ authorization: "Bearer good", origin: "https://larder.example.com", "sec-fetch-site": "same-origin" }), admin);
    expect(res.status).toBe(200);
    expect(admin.deleted).toEqual(["u1"]);
  });

  it("fails closed without the service key", async () => {
    const res = await deleteAccount(req({ authorization: "Bearer good" }), null);
    expect(res.status).toBe(503);
  });

  it("needs a valid access token", async () => {
    const admin = fakeAdmin({ id: "u1" });
    expect((await deleteAccount(req({}), admin)).status).toBe(401);
    expect((await deleteAccount(req({ authorization: "Bearer stolen-cookie" }), admin)).status).toBe(401);
    expect(admin.deleted).toEqual([]);
  });

  it("refuses other sites", async () => {
    const admin = fakeAdmin({ id: "u1" });
    expect((await deleteAccount(req({ authorization: "Bearer good", origin: "https://evil.example" }), admin)).status).toBe(403);
    expect((await deleteAccount(req({ authorization: "Bearer good", "sec-fetch-site": "cross-site" }), admin)).status).toBe(403);
    expect((await deleteAccount(req({ authorization: "Bearer good", "sec-fetch-site": "same-site" }), admin)).status).toBe(403);
    expect(admin.deleted).toEqual([]);
  });

  it("reports a failed delete without claiming success", async () => {
    const res = await deleteAccount(req({ authorization: "Bearer good" }), fakeAdmin({ id: "u1" }, { message: "db down" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).not.toContain("db down");
  });

  it("checks the origin against the host", () => {
    expect(fromThisSite(req({ origin: "https://larder.example.com" }))).toBe(true);
    expect(fromThisSite(req({ origin: "null" }))).toBe(false);
    expect(fromThisSite(req({ "sec-fetch-site": "none" }))).toBe(true);
  });
});
