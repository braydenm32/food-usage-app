"use client";

import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { getSupabase, providerEnabled } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";

const RESEND_SECONDS = 60;

/** Auth errors in plain words. */
export function authMessage(e: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Connect to the internet and try again.";
  const err = e as { message?: string; status?: number; code?: string } | null;
  const msg = err?.message ?? "";
  if (err?.status === 429 || /rate limit|only request this after|security purposes/i.test(msg)) {
    const secs = msg.match(/after (\d+) seconds?/)?.[1];
    return secs
      ? `Too many tries. Wait ${secs} seconds, then try again.`
      : "Too many emails sent recently. Wait a few minutes, then try again.";
  }
  if (/expired|invalid|otp/i.test(msg) && /token|otp|code/i.test(msg)) return "That code didn't work. It may have expired: check it, or send a new one.";
  if (/flow state|code verifier|both auth code and code verifier/i.test(msg)) {
    return "That sign-in link was opened in a different browser from the one that asked for it. Enter the code from the email instead, or send a new one from here.";
  }
  if (/signups not allowed|signup is disabled/i.test(msg)) return "New accounts aren't being accepted on this server right now.";
  if (/provider is not enabled|unsupported provider/i.test(msg)) return "Google sign-in isn't switched on for Larder yet. Use your email instead.";
  if (/invalid email|unable to validate email|email address .* is invalid/i.test(msg)) return "That email address doesn't look right. Check it and try again.";
  if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) {
    return "Couldn't reach the sign-in server. Check your connection and try again.";
  }
  return msg ? `Couldn't sign in: ${msg}` : "Couldn't sign in. Try again.";
}

function GoogleMark() {
  // Google's "G" in its brand colours (allowed exception to theme tokens: it's a logo).
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/**
 * Email one-time code (works inside an installed PWA, where magic links would open the
 * browser instead) plus "Continue with Google". `returnPath` is where links and Google send
 * the user back to, e.g. "/account" or "/join/abc".
 */
export function AuthPanel({ returnPath, intro }: { returnPath: string; intro?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const client = getSupabase();
  const redirectTo = () => `${window.location.origin}${returnPath}`;

  const send = async () => {
    const address = email.trim();
    if (!client || !address) return;
    setBusy("send");
    setError(null);
    try {
      const { error: err } = await client.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true, emailRedirectTo: redirectTo() },
      });
      if (err) throw err;
      setStep("code");
      setCode("");
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    const token = code.replace(/\D/g, "");
    if (!client || token.length < 6) return;
    setBusy("verify");
    setError(null);
    try {
      const { error: err } = await client.auth.verifyOtp({ email: email.trim(), token, type: "email" });
      if (err) throw err;
      // The session arrives through onAuthStateChange; the screen moves on by itself.
    } catch (e) {
      setError(authMessage(e));
      setBusy(null);
    }
  };

  const google = async () => {
    if (!client) return;
    setBusy("google");
    setError(null);
    const enabled = await providerEnabled("google");
    if (enabled === false) {
      setError("Google sign-in isn't switched on for Larder yet. Use your email instead.");
      setBusy(null);
      return;
    }
    const { error: err } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (err) {
      setError(authMessage(err));
      setBusy(null);
    }
    // Otherwise the browser is on its way to Google.
  };

  return (
    <Card className="p-5">
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex flex-col gap-4"
        >
          {intro && <p className="text-[15px] text-ink-2">{intro}</p>}
          <Field label="Email" hint="We'll email you a 6-digit code. No password needed.">
            {(id) => (
              <Input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>
          <Button type="submit" block disabled={!email.trim() || busy !== null}>
            <Mail size={18} aria-hidden />
            {busy === "send" ? "Sending…" : "Email me a code"}
          </Button>
          <div className="flex items-center gap-3 text-sm text-ink-3" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" block onClick={() => void google()} disabled={busy !== null}>
            <GoogleMark />
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <p className="font-display text-xl text-ink">Check your email</p>
            <p className="mt-1 text-[15px] text-ink-2">
              We sent a code to <span className="font-medium text-ink">{email.trim()}</span>. It can take a minute to arrive;
              check your junk folder too. You can also tap the link in the email if it opens on this device.
            </p>
          </div>
          <Field label="Code from the email">
            {(id) => (
              <Input
                id={id}
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={9}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
                placeholder="123456"
                className="text-center font-semibold tracking-[0.4em] tabular-nums text-xl"
              />
            )}
          </Field>
          <Button type="submit" block disabled={code.replace(/\D/g, "").length < 6 || busy !== null}>
            {busy === "verify" ? "Checking…" : "Sign in"}
          </Button>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => void send()} disabled={cooldown > 0 || busy !== null}>
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-spoiled-soft px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}
    </Card>
  );
}
