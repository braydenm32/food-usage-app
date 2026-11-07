import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** The Supabase project (auth, data and realtime), when configured. */
function supabaseOrigins(): { https: string; wss: string } | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return { https: u.origin, wss: `wss://${u.host}` };
  } catch {
    return null;
  }
}
const supabase = supabaseOrigins();

// No nonces: pages are prerendered (cacheComponents), and a nonce needs a fresh value per request,
// which would make every page dynamic. So the inline scripts and styles Next writes into the
// prerendered HTML are allowed with 'unsafe-inline'. Everything else is locked to this origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.themealdb.com https://images.openfoodfacts.org",
  "font-src 'self'",
  "media-src 'self' blob:",
  `connect-src 'self'${supabase ? ` ${supabase.https} ${supabase.wss}` : ""}${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Other sites' windows can't keep a handle on ours (Supabase sign-in is a redirect, not a popup).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Our own responses (API JSON, icons, the manifest) can't be loaded by other sites. Images we
  // show from TheMealDB and Open Food Facts are their responses, so this doesn't affect them.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
