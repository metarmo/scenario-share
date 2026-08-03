/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import {
  LuCheck,
  LuClock3,
  LuMail,
  LuSend,
  LuShieldCheck,
  LuTrash2,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { initials } from "./utils";
import styles from "./ScenarioShare.module.css";

export function MembersModal({
  open,
  onClose,
  supabase,
  workspaceId,
  membership,
  members,
  onRefresh,
  currentUser,
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const canInvite = membership?.role === "owner" || membership?.role === "editor";

  useEffect(() => {
    if (!open || !workspaceId || !canInvite) return;
    let active = true;
    supabase
      .from("workspace_invites")
      .select("id,email,role,accepted_at,created_at")
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (active) setInvites(data || []);
      });
    return () => { active = false; };
  }, [canInvite, open, supabase, workspaceId]);

  if (!open) return null;

  const close = () => {
    setEmail("");
    setMessage(null);
    onClose();
  };

  const invite = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessage({ tone: "error", text: "올바른 이메일 주소를 입력해 주세요." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase
      .from("workspace_invites")
      .insert({
        workspace_id: workspaceId,
        email: normalizedEmail,
        role,
      })
      .select("id,email,role,accepted_at,created_at")
      .single();
    setBusy(false);

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        setMessage({ tone: "error", text: "이미 초대된 이메일입니다." });
      } else {
        setMessage({ tone: "error", text: error.message });
      }
      return;
    }
    setInvites((current) => [data, ...current]);
    setEmail("");
    setMessage({ tone: "success", text: `${normalizedEmail} 님을 초대했습니다.` });
    onRefresh();
  };

  const revokeInvite = async (inviteId) => {
    setBusy(true);
    const { error } = await supabase.from("workspace_invites").delete().eq("id", inviteId);
    setBusy(false);
    if (!error) setInvites((current) => current.filter((item) => item.id !== inviteId));
  };

  return (
    <div className={styles.modalLayer} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={styles.membersModal} role="dialog" aria-modal="true" aria-labelledby="members-title">
        <header className={styles.modalHeader}>
          <div>
            <span className={styles.modalEyebrow}><LuUsers /> WORKSPACE</span>
            <h2 id="members-title">구성원 관리</h2>
            <p>ScenarioShare에 참여하는 사람과 권한을 관리합니다.</p>
          </div>
          <button className={styles.modalClose} onClick={close} aria-label="닫기"><LuX /></button>
        </header>

        {canInvite && (
          <form className={styles.inviteForm} onSubmit={invite}>
            <label>
              <span>이메일로 초대</span>
              <div className={styles.inviteInputRow}>
                <div className={styles.emailInput}><LuMail /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" disabled={busy} /></div>
                <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="권한">
                  <option value="editor">편집자</option>
                  <option value="viewer">뷰어</option>
                </select>
                <button className={styles.inviteButton} disabled={busy || !email.trim()}><LuSend /> 초대</button>
              </div>
            </label>
            {message && <div className={`${styles.formMessage} ${message.tone === "error" ? styles.formMessageError : ""}`}>{message.tone === "success" && <LuCheck />}{message.text}</div>}
          </form>
        )}

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

        {canInvite && invites.length > 0 && (
          <>
            <div className={styles.memberListHeader}><span>초대 대기</span><strong>{invites.length}</strong></div>
            <div className={styles.memberList}>
              {invites.map((pendingInvite) => (
                <div className={styles.memberRow} key={pendingInvite.id}>
                  <div className={`${styles.memberAvatar} ${styles.pendingAvatar}`}><LuClock3 /></div>
                  <div className={styles.memberIdentity}><strong>{pendingInvite.email}</strong><span>Google 로그인 후 자동 참여</span></div>
                  <div className={styles.memberRole}>{pendingInvite.role === "editor" ? "편집자" : "뷰어"}</div>
                  <button className={styles.revokeButton} onClick={() => revokeInvite(pendingInvite.id)} disabled={busy} aria-label="초대 취소"><LuTrash2 /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
