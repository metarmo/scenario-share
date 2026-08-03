import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LuArrowRight, LuLockKeyhole, LuShieldCheck } from "react-icons/lu";

import {
  ACCESS_COOKIE_NAME,
  ACCESS_UNLOCK_API_PATH,
  getAccessGateConfig,
  verifyAccessToken,
} from "@/lib/scenario-share/access-gate.mjs";
import styles from "@/components/scenario-share/ScenarioShare.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ERROR_MESSAGES = {
  invalid: "비밀번호가 맞지 않습니다. 다시 확인해 주세요.",
  rate: "입력 횟수가 많아 잠시 잠겼습니다. 10분 뒤 다시 시도해 주세요.",
  request: "요청을 확인할 수 없습니다. 이 페이지에서 다시 입력해 주세요.",
  config: "접근 비밀번호가 아직 서버에 설정되지 않았습니다.",
};

export default async function UnlockPage({ searchParams }) {
  const config = getAccessGateConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE_NAME)?.value;
  if (config.configured && verifyAccessToken(token, config.signingSecret)) {
    redirect("/");
  }

  const params = await searchParams;
  const errorMessage = ERROR_MESSAGES[params?.error] || null;

  return (
    <main className={styles.centeredPage} lang="ko">
      <div className={styles.centeredCard}>
        <div className={styles.loginMark}><LuLockKeyhole /></div>
        <div className={styles.brandPill}>PUBLIC LINK · PROTECTED</div>
        <h1>ScenarioShare 입장</h1>
        <p className={styles.stateDescription}>
          공유받은 비밀번호를 먼저 입력해 주세요. 확인되면 Google 계정으로 편집자를 인증합니다.
        </p>

        <form className={styles.passwordForm} action={ACCESS_UNLOCK_API_PATH} method="post">
          <label htmlFor="scenario-share-password">접근 비밀번호</label>
          <div className={styles.passwordField}>
            <LuShieldCheck />
            <input
              id="scenario-share-password"
              name="password"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="비밀번호 입력"
              maxLength={128}
              required
              autoFocus
              disabled={!config.configured}
            />
          </div>
          {errorMessage && <div className={`${styles.inlineNotice} ${styles.inlineNoticeError}`}>{errorMessage}</div>}
          {!config.configured && !errorMessage && (
            <div className={`${styles.inlineNotice} ${styles.inlineNoticeError}`}>
              서버의 접근 비밀번호 설정이 필요합니다.
            </div>
          )}
          <button className={styles.primaryButton} type="submit" disabled={!config.configured}>
            확인하고 계속 <LuArrowRight />
          </button>
        </form>

        <p className={styles.loginFinePrint}>
          비밀번호는 브라우저에 저장되지 않으며, 인증 쿠키는 12시간 뒤 만료됩니다.
        </p>
      </div>
    </main>
  );
}
