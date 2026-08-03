import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_COOKIE_NAME,
  ACCESS_SESSION_TTL_SECONDS,
  accessCookieOptions,
  createAccessToken,
  getAccessGateConfig,
  passwordMatches,
  verifyAccessToken,
} from "./access-gate.mjs";

const SIGNING_SECRET = "test-signing-secret-that-is-longer-than-32-characters";
const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);

test("access gate fails closed when server secrets are absent", () => {
  const config = getAccessGateConfig({});
  assert.equal(config.configured, false);
  assert.deepEqual(config.missing, [
    "SCENARIO_SHARE_GATE_PASSWORD",
    "SCENARIO_SHARE_GATE_SIGNING_SECRET (32자 이상)",
  ]);
});

test("password comparison accepts only the configured value", () => {
  assert.equal(passwordMatches("correct-value", "correct-value"), true);
  assert.equal(passwordMatches("wrong-value", "correct-value"), false);
  assert.equal(passwordMatches(null, "correct-value"), false);
});

test("access token verifies before expiry without containing the password", () => {
  const token = createAccessToken({
    signingSecret: SIGNING_SECRET,
    now: NOW,
    nonce: "fixed_nonce_for_testing_123",
  });

  assert.equal(token.includes("correct-value"), false);
  assert.equal(verifyAccessToken(token, SIGNING_SECRET, { now: NOW }), true);
  assert.equal(
    verifyAccessToken(token, SIGNING_SECRET, {
      now: NOW + (ACCESS_SESSION_TTL_SECONDS - 1) * 1000,
    }),
    true,
  );
});

test("access token rejects expiry, tampering, wrong secrets, and malformed data", () => {
  const token = createAccessToken({
    signingSecret: SIGNING_SECRET,
    now: NOW,
    nonce: "fixed_nonce_for_testing_123",
  });
  const tampered = token.replace("fixed_nonce", "other_nonce");

  assert.equal(
    verifyAccessToken(token, SIGNING_SECRET, {
      now: NOW + ACCESS_SESSION_TTL_SECONDS * 1000,
    }),
    false,
  );
  assert.equal(verifyAccessToken(tampered, SIGNING_SECRET, { now: NOW }), false);
  assert.equal(
    verifyAccessToken(token, "another-signing-secret-that-is-long-enough", { now: NOW }),
    false,
  );
  assert.equal(verifyAccessToken("not-a-token", SIGNING_SECRET, { now: NOW }), false);
});

test("access cookie is scoped to ScenarioShare and hardened", () => {
  const options = accessCookieOptions({ production: true });
  assert.equal(ACCESS_COOKIE_NAME, "scenario_share_gate");
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/scenario-share");
  assert.equal(options.maxAge, ACCESS_SESSION_TTL_SECONDS);
});
