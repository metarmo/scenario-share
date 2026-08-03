export const ALLOWED_LOGIN_EMAILS = Object.freeze([
  "kevin34320710@gmail.com",
  "nekoya404@gmail.com",
]);

const allowedLoginEmails = new Set(ALLOWED_LOGIN_EMAILS);

export function normalizeLoginEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isAllowedLoginEmail(value) {
  return allowedLoginEmails.has(normalizeLoginEmail(value));
}

export function sessionHasLoginAccess(session) {
  return Boolean(session?.user && isAllowedLoginEmail(session.user.email));
}
