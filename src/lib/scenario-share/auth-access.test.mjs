import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_LOGIN_EMAILS,
  isAllowedLoginEmail,
  normalizeLoginEmail,
  sessionHasLoginAccess,
} from "./auth-access.mjs";

test("login allowlist contains exactly the two approved accounts", () => {
  assert.deepEqual(ALLOWED_LOGIN_EMAILS, [
    "kevin34320710@gmail.com",
    "nekoya404@gmail.com",
  ]);
  assert.equal(new Set(ALLOWED_LOGIN_EMAILS).size, 2);
});

test("approved email matching is case-insensitive and trims outer whitespace", () => {
  assert.equal(isAllowedLoginEmail("kevin34320710@gmail.com"), true);
  assert.equal(isAllowedLoginEmail("  KEVIN34320710@GMAIL.COM  "), true);
  assert.equal(isAllowedLoginEmail("nekoya404@gmail.com"), true);
  assert.equal(normalizeLoginEmail(" Nekoya404@Gmail.com "), "nekoya404@gmail.com");
});

test("unapproved and lookalike addresses are rejected", () => {
  for (const email of [
    null,
    undefined,
    "",
    "someone@gmail.com",
    "kevin34320710+scenario@gmail.com",
    "kevin.34320710@gmail.com",
    "kevin34320710@gmail.com.evil.test",
    "prefix-kevin34320710@gmail.com",
    "nekoya404@gmail.com.evil.test",
  ]) {
    assert.equal(isAllowedLoginEmail(email), false, String(email));
  }
});

test("session access requires an approved authenticated user", () => {
  assert.equal(
    sessionHasLoginAccess({ user: { email: "kevin34320710@gmail.com" } }),
    true,
  );
  assert.equal(
    sessionHasLoginAccess({ user: { email: "other@gmail.com" } }),
    false,
  );
  assert.equal(sessionHasLoginAccess({ user: null }), false);
  assert.equal(sessionHasLoginAccess(null), false);
});
