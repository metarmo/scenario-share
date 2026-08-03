import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  ACCESS_UNLOCK_PATH,
  SCENARIO_SHARE_BASE_PATH,
  getAccessGateConfig,
  verifyAccessToken,
} from "./lib/scenario-share/access-gate.mjs";

function applyPrivateHeaders(response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

function isPublicScenarioSharePath(pathname) {
  return (
    pathname === "/unlock" ||
    pathname === "/api/access/unlock" ||
    pathname === "/api/access/logout" ||
    pathname === "/robots.txt" ||
    pathname.startsWith("/_next/")
  );
}

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const configuredBasePath = request.nextUrl.basePath;
  const isScenarioSharePath =
    configuredBasePath === SCENARIO_SHARE_BASE_PATH ||
    pathname === SCENARIO_SHARE_BASE_PATH ||
    pathname.startsWith(`${SCENARIO_SHARE_BASE_PATH}/`);
  const appPath = pathname === SCENARIO_SHARE_BASE_PATH
    ? "/"
    : pathname.startsWith(`${SCENARIO_SHARE_BASE_PATH}/`)
      ? pathname.slice(SCENARIO_SHARE_BASE_PATH.length)
      : pathname;

  if (!isScenarioSharePath || isPublicScenarioSharePath(appPath)) {
    return NextResponse.next();
  }

  const config = getAccessGateConfig();
  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const authorized =
    config.configured && verifyAccessToken(token, config.signingSecret);

  if (authorized) {
    return applyPrivateHeaders(NextResponse.next());
  }

  if (appPath.startsWith("/api/")) {
    const response = NextResponse.json(
      { error: "ScenarioShare access password is required" },
      { status: 401 },
    );
    return applyPrivateHeaders(response);
  }

  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: new URL(ACCESS_UNLOCK_PATH, request.url).toString() },
  });
  return applyPrivateHeaders(response);
}

export const config = {
  matcher: "/:path*",
};
