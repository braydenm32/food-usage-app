import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readCapped, readCappedForm, readCappedJson, sniffImageType } from "./http-body";

/** A request whose body arrives in chunks with no Content-Length, like a chunked upload. */
function chunked(parts: Uint8Array[], headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
  return new Request("http://localhost/x", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit);
}

describe("readCapped", () => {
  it("reads a body under the cap", async () => {
    const out = await readCapped(chunked([new Uint8Array([1, 2]), new Uint8Array([3])]), 3);
    expect([...out]).toEqual([1, 2, 3]);
  });

  it("stops a chunked body that passes the cap, without Content-Length", async () => {
    const big = new Uint8Array(1024);
    await expect(readCapped(chunked([big, big, big]), 2000)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("refuses a declared length over the cap before reading", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "hello", headers: { "content-length": "999999" } });
    await expect(readCapped(req, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("parses JSON and form data", async () => {
    expect(await readCappedJson(new Request("http://localhost/x", { method: "POST", body: '{"a":1}' }), 100)).toEqual({ a: 1 });
    const form = new FormData();
    form.append("kind", "list");
    form.append("image", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "p.jpg");
    const parsed = await readCappedForm(new Request("http://localhost/x", { method: "POST", body: form }), 10_000);
    expect(parsed.get("kind")).toBe("list");
    expect((parsed.get("image") as File).size).toBe(4);
  });
});

describe("sniffImageType", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const ascii = (s: string) => new TextEncoder().encode(s);
  it("knows the photo formats by their first bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xdb))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(ascii("GIF89a..."))).toBe("image/gif");
  });

  it("rejects anything else, whatever it claims to be", () => {
    expect(sniffImageType(ascii("<svg xmlns="))).toBeNull();
    expect(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WAVE"))).toBeNull();
    expect(sniffImageType(ascii("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});
