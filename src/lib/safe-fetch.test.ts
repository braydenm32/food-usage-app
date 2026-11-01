import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isBlockedAddress } from "./safe-fetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.0.1", "198.18.0.1",
    "::1", "::", "::ffff:7f00:1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "fc00::1", "fe80::1", "fec0::1", "2001:db8::1", "2001::1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["1.1.1.1", "142.250.70.4", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});
