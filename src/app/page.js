import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ScenarioShareApp } from "@/components/scenario-share/ScenarioShareApp";
import {
  ACCESS_COOKIE_NAME,
  getAccessGateConfig,
  verifyAccessToken,
} from "@/lib/scenario-share/access-gate.mjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ScenarioSharePage() {
  const config = getAccessGateConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE_NAME)?.value;

  if (!config.configured || !verifyAccessToken(token, config.signingSecret)) {
    redirect("/unlock");
  }

  return <ScenarioShareApp />;
}
