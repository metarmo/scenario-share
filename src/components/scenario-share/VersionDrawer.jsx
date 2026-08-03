/* eslint-disable @next/next/no-img-element */
"use client";

import { LuHistory, LuRefreshCw, LuRotateCcw, LuX } from "react-icons/lu";
import { formatRelativeTime, initials } from "./utils";
import styles from "./ScenarioShare.module.css";

export function VersionDrawer({ open, onClose, versions, members, currentUser, restoring, onRestore, readOnly }) {
  if (!open) return null;

  return (
    <aside className={styles.sidePanel} aria-label="버전 기록">
      <header className={styles.sidePanelHeader}>
        <div><span><LuHistory /> HISTORY</span><h3>버전 기록</h3></div>
        <button onClick={onClose} aria-label="버전 기록 닫기"><LuX /></button>
      </header>
      <div className={styles.versionIntro}>
        <p>직접 저장하거나 복원한 시점이 최대 30개까지 보관됩니다.</p>
      </div>
      <div className={styles.versionList}>
        {restoring === "loading" && <div className={styles.panelLoading}><LuRefreshCw /> 기록을 불러오는 중…</div>}
        {restoring !== "loading" && !versions.length && <div className={styles.panelEmpty}><LuHistory /><strong>저장된 버전이 없습니다</strong><span>상단의 저장 버튼을 눌러 첫 버전을 만드세요.</span></div>}
        {versions.map((version, index) => {
          const author = members.find((member) => member.id === version.author_id);
          const name = author?.name || (version.author_id === currentUser.id ? "나" : "구성원");
          return (
            <article className={`${styles.versionCard} ${index === 0 ? styles.versionCardLatest : ""}`} key={version.id}>
              <div className={styles.versionTimeline}><span /></div>
              <div className={styles.versionCardContent}>
                <div className={styles.versionTopline}>
                  <strong>{version.label || (index === 0 ? "최근 저장" : "직접 저장")}</strong>
                  {index === 0 && <em>현재</em>}
                </div>
                <h4>{version.title || "제목 없는 문서"}</h4>
                {version.plain_text && <p>{version.plain_text.slice(0, 110)}</p>}
                <div className={styles.versionAuthor}>
                  <span className={styles.tinyAvatar}>{author?.avatar ? <img src={author.avatar} alt="" /> : initials(name)}</span>
                  <span>{name} · {formatRelativeTime(version.created_at)}</span>
                </div>
                {!readOnly && index !== 0 && (
                  <button
                    className={styles.restoreButton}
                    disabled={Boolean(restoring)}
                    onClick={() => {
                      if (window.confirm(`“${version.title || "제목 없는 문서"}” 버전으로 복원할까요? 복원된 내용은 새 버전으로 저장됩니다.`)) onRestore(version);
                    }}
                  >
                    <LuRotateCcw /> 이 버전 복원
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
