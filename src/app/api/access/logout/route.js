import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  ACCESS_UNLOCK_PATH,
  SCENARIO_SHARE_BASE_PATH,
} from "@/lib/scenario-share/access-gate.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requestIsSameOrigin(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) return false;
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request) {
  if (!requestIsSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const response = NextResponse.redirect(
    new URL(ACCESS_UNLOCK_PATH, request.url),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: SCENARIO_SHARE_BASE_PATH,
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
