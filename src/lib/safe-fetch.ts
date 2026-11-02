import "server-only";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

/**
 * Fetch a user-supplied web page without letting it reach private networks (SSRF).
 * The address check runs inside the socket's own DNS lookup, so the IP that is checked is the
 * IP that is dialled (no DNS-rebinding gap), and every redirect hop is checked again.
 */

export class SafeFetchError extends Error {
  constructor(
    public code: "bad_url" | "blocked" | "timeout" | "http" | "not_html" | "too_many_redirects" | "network",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function v4Private(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** IPv6 text to 16 bytes, or null. Handles "::", embedded IPv4 and zone ids. */
function v6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const tail: number[] = [];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    tail.push(...v4[1].split(".").map(Number));
    s = s.slice(0, -v4[1].length) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(":").map((x) => parseInt(x, 16)) : []);
  const head = parse(halves[0]);
  const back = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - back.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill(0), ...back];
  if (groups.some((g) => !Number.isFinite(g) || g < 0 || g > 0xffff)) return null;
  const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return v4Private(ip);
  if (family !== 6) return true;
  const b = v6Bytes(ip);
  if (!b) return true;
  const v4At = (i: number) => `${b[i]}.${b[i + 1]}.${b[i + 2]}.${b[i + 3]}`;
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4Private(v4At(12));
  if (zero(0, 12)) return true;
  // NAT64 64:ff9b::/96 and 6to4 2002::/16 carry an IPv4 address
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return v4Private(v4At(12));
  if (b[0] === 0x20 && b[1] === 0x02) return v4Private(v4At(2));
  // Only global unicast 2000::/3, minus Teredo 2001::/32 and documentation 2001:db8::/32
  if ((b[0] & 0xe0) !== 0x20) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && ((b[2] === 0 && b[3] === 0) || (b[2] === 0x0d && b[3] === 0xb8))) return true;
  return false;
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

interface Page {
  html: string;
  url: string;
}

function once(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; location?: string; type: string; body?: string }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlockedAddress(host)) return reject(new SafeFetchError("blocked", "That address isn't allowed."));
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; LarderRecipeImport/1.0; +https://github.com/braydenm32/food-usage-app)",
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, type });
        }
        if (status < 200 || status >= 300 || !/html|xml/i.test(type)) {
          res.resume();
          return resolve({ status, type });
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            // Recipe data is usually near the top of a page; keep what we have.
            req.destroy();
            resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(c);
        });
        stream.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
        stream.on("error", (e) => reject(new SafeFetchError("network", e.message)));
      },
    );
    req.on("timeout", () => req.destroy(new SafeFetchError("timeout", "The page took too long to respond.")));
    req.on("error", (e) => {
      if (e instanceof SafeFetchError) return reject(e);
      if ((e as { code?: string }).code === "EBLOCKED") return reject(new SafeFetchError("blocked", "That address isn't allowed."));
      reject(new SafeFetchError("network", e.message));
    });
    req.end();
  });
}

export async function safeFetchPage(raw: string, { maxBytes = 3 * 1024 * 1024, timeoutMs = 10_000, maxRedirects = 4 } = {}): Promise<Page> {
  let current: URL;
  try {
    current = new URL(raw);
  } catch {
    throw new SafeFetchError("bad_url", "That isn't a web link.");
  }
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") throw new SafeFetchError("bad_url", "Only web links work.");
    if (current.username || current.password || (current.port && current.port !== "80" && current.port !== "443")) {
      throw new SafeFetchError("blocked", "That address isn't allowed.");
    }
    const r = await once(current, maxBytes, timeoutMs);
    if (r.location !== undefined) {
      current = new URL(r.location, current);
      continue;
    }
    if (r.body === undefined) {
      if (r.status >= 200 && r.status < 300) throw new SafeFetchError("not_html", "That link isn't a web page.");
      throw new SafeFetchError("http", `The site answered ${r.status}.`, r.status);
    }
    return { html: r.body, url: current.toString() };
  }
  throw new SafeFetchError("too_many_redirects", "That link redirects too many times.");
}
