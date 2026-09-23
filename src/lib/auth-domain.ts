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

/**
 * Post-login redirect target. Only same-site paths are honored — an
 * absolute or protocol-relative `next` would make login an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/admin";
  }
  return next;
}
