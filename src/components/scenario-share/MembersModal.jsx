/* eslint-disable @next/next/no-img-element */
"use client";

import {
  LuShieldCheck,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { initials } from "./utils";
import styles from "./ScenarioShare.module.css";

export function MembersModal({
  open,
  onClose,
  members,
  currentUser,
}) {
  if (!open) return null;

  return (
    <div className={styles.modalLayer} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.membersModal} role="dialog" aria-modal="true" aria-labelledby="members-title">
        <header className={styles.modalHeader}>
          <div>
            <span className={styles.modalEyebrow}><LuUsers /> WORKSPACE</span>
            <h2 id="members-title">구성원</h2>
            <p>허용된 두 Google 계정의 참여 상태를 확인합니다.</p>
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="닫기"><LuX /></button>
        </header>

        <div className={styles.memberListHeader}><span>참여 중</span><strong>{members.length}</strong></div>
        <div className={styles.memberList}>
          {members.map((member) => (
            <div className={styles.memberRow} key={member.id}>
              <div className={styles.memberAvatar}>{member.avatar ? <img src={member.avatar} alt="" /> : initials(member.name)}</div>
              <div className={styles.memberIdentity}>
                <strong>{member.name}{member.id === currentUser.id && <em>나</em>}</strong>
                <span>{member.email || "이메일 비공개"}</span>
              </div>
              <div className={styles.memberRole}>{member.role === "owner" && <LuShieldCheck />}{member.role === "owner" ? "소유자" : member.role === "editor" ? "편집자" : "뷰어"}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
