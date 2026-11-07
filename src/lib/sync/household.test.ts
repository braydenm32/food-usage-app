import { describe, expect, it } from "vitest";
import { checkInvite } from "./household";

/** Same contract as peek_household_invite and join_household in the security migration. */
function client(opts: { member: boolean; usable: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn === "peek_household_invite") {
        return { data: [{ household_id: opts.usable ? "h1" : null, household_name: "The Lees", expired: !opts.usable }], error: null };
      }
      if (fn === "join_household") {
        if (opts.member) return { data: "h1", error: null };
        return { data: null, error: { code: "P0002", message: "This invite link has expired or is not valid" } };
      }
      return { data: null, error: { message: "unknown" } };
    },
  };
}

describe("checkInvite", () => {
  it("a usable invite is only peeked at", async () => {
    const c = client({ member: false, usable: true });
    expect(await checkInvite(c as never, "t")).toEqual({ householdId: "h1", householdName: "The Lees", expired: false });
    expect(c.calls).toEqual(["peek_household_invite"]);
  });

  it("a used invite opened again by a member says they're already in", async () => {
    const c = client({ member: true, usable: false });
    expect(await checkInvite(c as never, "t")).toMatchObject({ householdId: "h1", expired: false, alreadyMember: true });
  });

  it("a used invite for anyone else stays spent", async () => {
    const c = client({ member: false, usable: false });
    expect(await checkInvite(c as never, "t")).toEqual({ householdId: null, householdName: "The Lees", expired: true });
  });
});
