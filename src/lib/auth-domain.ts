/** Only Forza Payments Google Workspace accounts may sign in with Google. */
export const STAFF_EMAIL_DOMAIN = "forzapayments.com";

/** The single org every staff account belongs to. */
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

export function isAllowedStaffEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  return email.slice(at + 1).toLowerCase() === STAFF_EMAIL_DOMAIN;
}

const NEXT_FALLBACK = "/admin";
const PROBE_ORIGIN = "https://same-site.invalid";

/**
 * Post-login redirect target. Only same-site paths are honored — an
 * absolute or protocol-relative `next` would make login an open redirect.
 * The candidate is resolved exactly as the browser/URL parser will resolve
 * it (which strips tabs/newlines and treats `\` as `/`) and must keep our
 * origin; the normalized path is returned, never the raw input.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return NEXT_FALLBACK;
  let resolved: URL;
  try {
    resolved = new URL(next, PROBE_ORIGIN);
  } catch {
    return NEXT_FALLBACK;
  }
  if (resolved.origin !== PROBE_ORIGIN) return NEXT_FALLBACK;
  return resolved.pathname + resolved.search + resolved.hash;
}
