import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./endpoint";

describe("push endpoint allowlist", () => {
  it("accepts the browser push services", () => {
    for (const e of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://web.push.apple.com/QGx",
      "https://api.push.apple.com/3/device/x",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isAllowedPushEndpoint(e), e).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const e of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://evil.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "https://notify.windows.com/x",
      "https://evilpush.apple.com/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "not a url",
      42,
    ]) {
      expect(isAllowedPushEndpoint(e), String(e)).toBe(false);
    }
  });
});
