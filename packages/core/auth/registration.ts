/**
 * Email domains allowed to create an account. The server enforces the same
 * list in `server/internal/handler/auth.go`; keep them in sync.
 */
export const REGISTRATION_EMAIL_DOMAINS = ["deloittecn.com.cn", "deloitte.com.hk"] as const;

/** Whether `email` belongs to one of the registration domains (exact domain match). */
export function isRegistrationEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = normalized.slice(at + 1);
  return REGISTRATION_EMAIL_DOMAINS.some((allowed) => allowed === domain);
}
