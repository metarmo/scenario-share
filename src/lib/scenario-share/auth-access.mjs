export const ALLOWED_LOGIN_EMAILS = Object.freeze([
  "kevin34320710@gmail.com",
  "nekoya404@gmail.com",
]);

const allowedLoginEmails = new Set(ALLOWED_LOGIN_EMAILS);
const identityMetadataKeys = Object.freeze([
  "full_name",
  "name",
  "display_name",
  "avatar_url",
  "picture",
  "avatar",
]);

export function normalizeLoginEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isAllowedLoginEmail(value) {
  return allowedLoginEmails.has(normalizeLoginEmail(value));
}

export function sessionHasLoginAccess(session) {
  return Boolean(session?.user && isAllowedLoginEmail(session.user.email));
}

/**
 * Auth token refreshes replace the Supabase user object even when the profile
 * shown by ScenarioShare has not changed. Keep that identity stable so a
 * TOKEN_REFRESHED/SIGNED_IN event does not remount the realtime editor.
 */
export function hasSameScenarioShareUserIdentity(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.id !== right.id) return false;
  if (normalizeLoginEmail(left.email) !== normalizeLoginEmail(right.email)) {
    return false;
  }

  const leftMetadata = left.user_metadata || {};
  const rightMetadata = right.user_metadata || {};
  return identityMetadataKeys.every(
    (key) => (leftMetadata[key] ?? null) === (rightMetadata[key] ?? null),
  );
}
