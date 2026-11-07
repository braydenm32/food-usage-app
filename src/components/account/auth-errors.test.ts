import { describe, expect, it } from "vitest";
import { authMessage, authReturnMessage } from "@/components/account/auth-errors";

describe("auth error copy", () => {
  it("maps known redirect codes to fixed sentences", () => {
    expect(authReturnMessage("otp_expired")).toMatch(/expired/);
    expect(authReturnMessage("ACCESS_DENIED")).toMatch(/cancelled/);
  });

  it("never echoes text from the address bar or the server", () => {
    const phish = "Your account is locked. Call 1800 000 000 to restore it";
    expect(authReturnMessage(phish)).not.toContain("1800");
    expect(authReturnMessage("__proto__")).toMatch(/Couldn't sign in/);
    expect(authReturnMessage(null)).toMatch(/Couldn't sign in/);
    expect(authMessage({ message: phish })).not.toContain("1800");
    expect(authMessage({ message: phish, code: "nope" })).toMatch(/Couldn't sign in/);
  });

  it("still explains common failures", () => {
    expect(authMessage({ message: "Token has expired or is invalid" })).toMatch(/code didn't work/);
    expect(authMessage({ status: 429, message: "For security purposes, you can only request this after 42 seconds." })).toMatch(/42 seconds/);
    expect(authMessage(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });
});
