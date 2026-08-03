import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SCENARIO_SHARE_BASE_PATH = "/scenario-share";
export const ACCESS_UNLOCK_PATH = `${SCENARIO_SHARE_BASE_PATH}/unlock`;
export const ACCESS_UNLOCK_API_PATH = `${SCENARIO_SHARE_BASE_PATH}/api/access/unlock`;
export const ACCESS_COOKIE_NAME = "scenario_share_gate";
export const ACCESS_SESSION_TTL_SECONDS = 60 * 60 * 12;

const TOKEN_VERSION = "v1";
const TOKEN_CLOCK_SKEW_SECONDS = 60;
const MINIMUM_SIGNING_SECRET_LENGTH = 32;

function hmac(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeStringEqual(left, right) {
  const leftDigest = createHmac("sha256", "scenario-share:compare")
    .update(String(left))
    .digest();
  const rightDigest = createHmac("sha256", "scenario-share:compare")
    .update(String(right))
    .digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function getAccessGateConfig(environment = process.env) {
  const password = environment.SCENARIO_SHARE_GATE_PASSWORD || "";
  const signingSecret = environment.SCENARIO_SHARE_GATE_SIGNING_SECRET || "";
  const missing = [];

  if (!password) missing.push("SCENARIO_SHARE_GATE_PASSWORD");
  if (signingSecret.length < MINIMUM_SIGNING_SECRET_LENGTH) {
    missing.push("SCENARIO_SHARE_GATE_SIGNING_SECRET (32자 이상)");
  }

  return {
    configured: missing.length === 0,
    missing,
    password,
    signingSecret,
  };
}

export function passwordMatches(candidate, expectedPassword) {
  if (typeof candidate !== "string" || typeof expectedPassword !== "string") {
    return false;
  }
  return timingSafeStringEqual(candidate, expectedPassword);
}

export function createAccessToken({
  signingSecret,
  now = Date.now(),
  ttlSeconds = ACCESS_SESSION_TTL_SECONDS,
  nonce = randomBytes(18).toString("base64url"),
}) {
  if (typeof signingSecret !== "string" || signingSecret.length < MINIMUM_SIGNING_SECRET_LENGTH) {
    throw new Error("ScenarioShare gate signing secret must be at least 32 characters");
  }

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const payload = `${TOKEN_VERSION}.${expiresAt}.${nonce}`;
  return `${payload}.${hmac(payload, signingSecret)}`;
}

export function verifyAccessToken(
  token,
  signingSecret,
  { now = Date.now() } = {},
) {
  if (
    typeof token !== "string" ||
    typeof signingSecret !== "string" ||
    signingSecret.length < MINIMUM_SIGNING_SECRET_LENGTH
  ) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [version, expiresAtText, nonce, signature] = parts;
  if (
    version !== TOKEN_VERSION ||
    !/^\d{10,12}$/.test(expiresAtText) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(signature)
  ) {
    return false;
  }

  const expiresAt = Number(expiresAtText);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= nowSeconds ||
    expiresAt > nowSeconds + ACCESS_SESSION_TTL_SECONDS + TOKEN_CLOCK_SKEW_SECONDS
  ) {
    return false;
  }

  const payload = `${version}.${expiresAtText}.${nonce}`;
  return timingSafeStringEqual(signature, hmac(payload, signingSecret));
}

export function accessCookieOptions({ production = process.env.NODE_ENV === "production" } = {}) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: SCENARIO_SHARE_BASE_PATH,
    maxAge: ACCESS_SESSION_TTL_SECONDS,
    priority: "high",
  };
}
