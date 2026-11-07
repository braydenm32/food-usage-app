import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { aiDailyLimit, authenticateAi, bearerToken, consumeAiCall, gateAi, secondsToSydneyMidnight } = await import("./server-auth");
type GateClient = import("./server-auth").GateClient;

function fakeClient({ user = "u1" as string | null, allowed = true as boolean | null, rpcError = false } = {}) {
  const rpc = vi.fn(async () => (rpcError ? { data: null, error: { message: "boom" } } : { data: allowed, error: null }));
  const getUser = vi.fn(async () => (user ? { data: { user: { id: user } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }));
  return { client: { auth: { getUser }, rpc } as unknown as GateClient, rpc, getUser };
}

const req = (auth?: string) => new Request("http://localhost/api/scan", { method: "POST", headers: auth ? { authorization: auth } : {} });

describe("bearerToken", () => {
  it("reads only a well-formed bearer header", () => {
    expect(bearerToken(req("Bearer abc.def"))).toBe("abc.def");
    expect(bearerToken(req("Bearer "))).toBe("");
    expect(bearerToken(req("Basic abc"))).toBe("");
    expect(bearerToken(req())).toBe("");
  });
});

describe("authenticateAi", () => {
  it("asks people to sign in when there's no token", async () => {
    const { client, getUser } = fakeClient();
    const r = await authenticateAi(req(), client);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      expect(await r.response.json()).toMatchObject({ error: "sign_in_required" });
    }
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a token Supabase doesn't accept", async () => {
    const r = await authenticateAi(req("Bearer nope"), fakeClient({ user: null }).client);
    expect(!r.ok && r.response.status).toBe(401);
  });

  it("fails closed when the server has no service key", async () => {
    const r = await authenticateAi(req("Bearer t"), null);
    expect(!r.ok && r.response.status).toBe(503);
  });

  it("returns the user id", async () => {
    const r = await authenticateAi(req("Bearer t"), fakeClient({ user: "abc" }).client);
    expect(r.ok && r.userId).toBe("abc");
  });
});

describe("consumeAiCall", () => {
  it("counts a call against the user's daily limit", async () => {
    const { client, rpc } = fakeClient();
    expect(await consumeAiCall({ userId: "u1", client }, 40)).toBeNull();
    expect(rpc).toHaveBeenCalledWith("consume_ai_call", { uid: "u1", daily_limit: 40 });
  });

  it("says when today's allowance is used up", async () => {
    const res = await consumeAiCall({ userId: "u1", client: fakeClient({ allowed: false }).client }, 40);
    expect(res?.status).toBe(429);
    expect(await res?.json()).toMatchObject({ error: "ai_quota" });
    expect(Number(res?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("fails closed when the count can't be kept", async () => {
    const res = await consumeAiCall({ userId: "u1", client: fakeClient({ rpcError: true }).client }, 40);
    expect(res?.status).toBe(503);
  });

  it("gateAi does both", async () => {
    expect((await gateAi(req("Bearer t"), fakeClient().client)).ok).toBe(true);
    expect((await gateAi(req("Bearer t"), fakeClient({ allowed: false }).client)).ok).toBe(false);
  });
});

describe("limits", () => {
  it("reads AI_DAILY_LIMIT with a safe default", () => {
    expect(aiDailyLimit({} as NodeJS.ProcessEnv)).toBe(40);
    expect(aiDailyLimit({ AI_DAILY_LIMIT: "10" } as unknown as NodeJS.ProcessEnv)).toBe(10);
    expect(aiDailyLimit({ AI_DAILY_LIMIT: "0" } as unknown as NodeJS.ProcessEnv)).toBe(40);
    expect(aiDailyLimit({ AI_DAILY_LIMIT: "lots" } as unknown as NodeJS.ProcessEnv)).toBe(40);
  });

  it("counts down to Sydney midnight", () => {
    // 23:00 in Sydney (AEDT, UTC+11) is 12:00 UTC.
    expect(secondsToSydneyMidnight(new Date("2026-11-07T12:00:00Z"))).toBe(3600);
  });
});
