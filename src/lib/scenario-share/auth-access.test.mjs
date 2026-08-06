import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_LOGIN_EMAILS,
  hasSameScenarioShareUserIdentity,
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

test("token refreshes preserve an unchanged ScenarioShare user identity", () => {
  const current = {
    id: "a6d76f65-42bc-49f8-bf08-e81d4331bd57",
    email: "Kevin34320710@gmail.com",
    user_metadata: {
      full_name: "Kevin",
      avatar_url: "https://example.com/avatar.png",
      provider_id: "old-provider-value",
    },
  };
  const refreshed = {
    ...current,
    email: "kevin34320710@gmail.com",
    updated_at: "2026-08-06T01:00:00.000Z",
    user_metadata: {
      ...current.user_metadata,
      provider_id: "new-provider-value",
    },
  };

  assert.equal(hasSameScenarioShareUserIdentity(current, refreshed), true);
  assert.equal(
    hasSameScenarioShareUserIdentity(current, {
      ...refreshed,
      user_metadata: { ...refreshed.user_metadata, full_name: "Kevin Lee" },
    }),
    false,
  );
  assert.equal(
    hasSameScenarioShareUserIdentity(current, { ...refreshed, id: "another-user" }),
    false,
  );
  assert.equal(hasSameScenarioShareUserIdentity(current, null), false);
});
