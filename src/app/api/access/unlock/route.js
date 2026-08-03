import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  ACCESS_UNLOCK_PATH,
  SCENARIO_SHARE_ROOT_PATH,
  accessCookieOptions,
  createAccessToken,
  getAccessGateConfig,
  passwordMatches,
} from "@/lib/scenario-share/access-gate.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 512;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const BLOCK_DURATION_MS = 10 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 4_096;
const PRUNE_INTERVAL_MS = 60 * 1000;
const attempts = globalThis.__scenarioShareGateAttempts || new Map();
globalThis.__scenarioShareGateAttempts = attempts;
let lastPrunedAt = globalThis.__scenarioShareGateLastPrunedAt || 0;

function noStore(response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function requestIsSameOrigin(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) return false;
  return !origin || origin === new URL(request.url).origin;
}

function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function pruneAttempts(now) {
  if (now - lastPrunedAt < PRUNE_INTERVAL_MS && attempts.size < MAX_TRACKED_CLIENTS) {
    return;
  }

  for (const [key, state] of attempts) {
    const expired =
      state.blockedUntil <= now && now - state.windowStartedAt >= FAILURE_WINDOW_MS;
    if (expired) attempts.delete(key);
  }

  while (attempts.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = attempts.keys().next().value;
    if (oldestKey === undefined) break;
    attempts.delete(oldestKey);
  }

  lastPrunedAt = now;
  globalThis.__scenarioShareGateLastPrunedAt = now;
}

function currentAttemptState(key, now) {
  const existing = attempts.get(key);
  if (!existing) return { failures: 0, windowStartedAt: now, blockedUntil: 0 };
  if (existing.blockedUntil > now) return existing;
  if (now - existing.windowStartedAt >= FAILURE_WINDOW_MS) {
    attempts.delete(key);
    return { failures: 0, windowStartedAt: now, blockedUntil: 0 };
  }
  return existing;
}

function recordFailure(key, now) {
  const state = currentAttemptState(key, now);
  state.failures += 1;
  if (state.failures >= MAX_FAILURES) state.blockedUntil = now + BLOCK_DURATION_MS;
  attempts.set(key, state);
  return state;
}

function redirectToUnlock(request, error) {
  const url = new URL(ACCESS_UNLOCK_PATH, request.url);
  if (error) url.searchParams.set("error", error);
  return noStore(NextResponse.redirect(url, 303));
}

export async function POST(request) {
  if (!requestIsSameOrigin(request)) {
    return redirectToUnlock(request, "request");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const rawContentLength = request.headers.get("content-length");
  const contentLength = Number(rawContentLength);
  if (
    contentType !== "application/x-www-form-urlencoded" ||
    (!rawContentLength && process.env.NODE_ENV === "production") ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_BODY_BYTES
  ) {
    return redirectToUnlock(request, "request");
  }

  const config = getAccessGateConfig();
  if (!config.configured) {
    return redirectToUnlock(request, "config");
  }

  const key = clientKey(request);
  const now = Date.now();
  pruneAttempts(now);
  const state = currentAttemptState(key, now);
  if (state.blockedUntil > now) {
    const response = redirectToUnlock(request, "rate");
    response.headers.set(
      "Retry-After",
      String(Math.ceil((state.blockedUntil - now) / 1000)),
    );
    return response;
  }

  let password = "";
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      return redirectToUnlock(request, "request");
    }
    password = new URLSearchParams(body).get("password") || "";
  } catch {
    return redirectToUnlock(request, "request");
  }

  if (password.length > 128 || !passwordMatches(password, config.password)) {
    const failed = recordFailure(key, now);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const response = redirectToUnlock(
      request,
      failed.blockedUntil > now ? "rate" : "invalid",
    );
    if (failed.blockedUntil > now) {
      response.headers.set("Retry-After", String(BLOCK_DURATION_MS / 1000));
    }
    return response;
  }

  attempts.delete(key);
  const response = noStore(
    NextResponse.redirect(new URL(SCENARIO_SHARE_ROOT_PATH, request.url), 303),
  );
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: createAccessToken({ signingSecret: config.signingSecret }),
    ...accessCookieOptions(),
  });
  return response;
}
