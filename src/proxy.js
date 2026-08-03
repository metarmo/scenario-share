import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  ACCESS_UNLOCK_PATH,
  getAccessGateConfig,
  verifyAccessToken,
} from "./lib/scenario-share/access-gate.mjs";

function applyPrivateHeaders(response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

function isAccessGatePath(pathname) {
  return (
    pathname === "/unlock" ||
    pathname === "/api/access/unlock" ||
    pathname === "/api/access/logout"
  );
}

function isPublicStaticPath(pathname) {
  return pathname === "/robots.txt" || pathname.startsWith("/_next/");
}

export function proxy(request) {
  const { pathname } = request.nextUrl;

  if (isPublicStaticPath(pathname)) {
    return NextResponse.next();
  }

  if (isAccessGatePath(pathname)) {
    return applyPrivateHeaders(NextResponse.next());
  }

  const config = getAccessGateConfig();
  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const authorized =
    config.configured && verifyAccessToken(token, config.signingSecret);

  if (authorized) {
    return applyPrivateHeaders(NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
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
