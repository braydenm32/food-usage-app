/**
 * Sign-in errors in plain words. Only fixed sentences ever reach the screen: the text in an
 * error redirect (`?error_description=…`) can be written by anyone who sends a link to our
 * site, so it is never shown, and neither are raw server messages.
 */

const GENERIC = "Couldn't sign in. Try again, or send a new code.";

/** Supabase Auth error codes that come back on a redirect (`error_code`, or `error`). */
const RETURN_CODES: Record<string, string> = {
  otp_expired: "That sign-in link has expired or was already used. Send a new code from here.",
  flow_state_expired: "That sign-in link has expired. Send a new code from here.",
  flow_state_not_found:
    "That sign-in link was opened in a different browser from the one that asked for it. Enter the code from the email instead, or send a new one from here.",
  bad_code_verifier:
    "That sign-in link was opened in a different browser from the one that asked for it. Enter the code from the email instead, or send a new one from here.",
  access_denied: "Sign-in was cancelled. Try again when you're ready.",
  bad_oauth_state: "Sign-in with Google didn't finish. Try again.",
  bad_oauth_callback: "Sign-in with Google didn't finish. Try again.",
  oauth_provider_not_supported: "Google sign-in isn't switched on for Larder yet. Use your email instead.",
  provider_disabled: "Google sign-in isn't switched on for Larder yet. Use your email instead.",
  signup_disabled: "Larder isn't taking new accounts right now. Try again later.",
  user_banned: "This account can't sign in right now.",
  email_not_confirmed: "Your email address hasn't been confirmed yet. Send a new code from here.",
  over_email_send_rate_limit: "Too many emails sent recently. Wait a few minutes, then try again.",
  over_request_rate_limit: "Too many tries. Wait a few minutes, then try again.",
  server_error: "Larder couldn't sign you in just now. Try again in a minute.",
  temporarily_unavailable: "Larder couldn't sign you in just now. Try again in a minute.",
  unexpected_failure: "Larder couldn't sign you in just now. Try again in a minute.",
};

export const RETURN_CODE_PROVIDER_OFF = RETURN_CODES.provider_disabled;

/** The message for an error redirect, from its code alone. */
export function authReturnMessage(code: string | null | undefined): string {
  const key = (code ?? "").trim().toLowerCase();
  return Object.hasOwn(RETURN_CODES, key) ? RETURN_CODES[key] : GENERIC;
}

/** Auth errors from our own calls, in plain words. */
export function authMessage(e: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. Connect to the internet and try again.";
  const err = e as { message?: string; status?: number; code?: string } | null;
  const msg = err?.message ?? "";
  if (err?.code && Object.hasOwn(RETURN_CODES, err.code)) return RETURN_CODES[err.code];
  if (err?.status === 429 || /rate limit|only request this after|security purposes/i.test(msg)) {
    const secs = msg.match(/after (\d+) seconds?/)?.[1];
    return secs
      ? `Too many tries. Wait ${secs} seconds, then try again.`
      : "Too many emails sent recently. Wait a few minutes, then try again.";
  }
  if (/expired|invalid|otp/i.test(msg) && /token|otp|code/i.test(msg)) return "That code didn't work. It may have expired: check it, or send a new one.";
  if (/flow state|code verifier|both auth code and code verifier/i.test(msg)) return RETURN_CODES.flow_state_not_found;
  if (/signups not allowed|signup is disabled/i.test(msg)) return RETURN_CODES.signup_disabled;
  if (/provider is not enabled|unsupported provider/i.test(msg)) return RETURN_CODES.provider_disabled;
  if (/invalid email|unable to validate email|email address .* is invalid/i.test(msg)) return "That email address doesn't look right. Check it and try again.";
  if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) {
    return "Couldn't reach Larder to sign you in. Check your connection and try again.";
  }
  return GENERIC;
}
