/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuBookOpen,
  LuChevronRight,
  LuLogOut,
  LuMenu,
  LuRefreshCw,
  LuSettings,
  LuTriangleAlert,
  LuUsers,
  LuX,
} from "react-icons/lu";
import {
  getSupabaseBrowserClient,
  supabaseEnvironment,
} from "@/lib/supabase/client";
import {
  isAllowedLoginEmail,
  normalizeLoginEmail,
} from "@/lib/scenario-share/auth-access.mjs";
import { CollaborativeDocument } from "./CollaborativeDocument";
import { MembersModal } from "./MembersModal";
import { WikiSidebar } from "./WikiSidebar";
import { createDocumentSlug, initials, profileFromUser } from "./utils";
import styles from "./ScenarioShare.module.css";

function normalizeMembership(data, userId) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    workspace_id: row.workspace_id || row.id,
    user_id: row.user_id || userId,
    role: row.role || "editor",
  };
}

function normalizeMember(row) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.user_id,
    role: row.role,
    name: profile?.display_name || profile?.email?.split("@")[0] || "구성원",
    email: profile?.email || "",
    avatar: profile?.avatar_url || null,
  };
}

export function ScenarioShareApp() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [authState, setAuthState] = useState(() =>
    supabaseEnvironment.configured ? "loading" : "missing-env",
  );
  const [user, setUser] = useState(null);
  const [membership, setMembership] = useState(null);
  const [workspaceState, setWorkspaceState] = useState("idle");
  const [documents, setDocuments] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    document.documentElement.lang = "ko";
    return () => {
      document.documentElement.lang = "ja";
    };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    let active = true;
    const rejectedUsers = new Set();
    const applySession = (session) => {
      const sessionUser = session?.user || null;

      if (sessionUser && !isAllowedLoginEmail(sessionUser.email)) {
        const rejectedEmail = normalizeLoginEmail(sessionUser.email);
        setUser(null);
        setAuthState("signed-out");
        setMembership(null);
        setWorkspaceState("idle");
        setDocuments([]);
        setMembers([]);
        setNotice({
          tone: "error",
          message: rejectedEmail
            ? `${rejectedEmail} 계정은 ScenarioShare에 로그인할 수 없습니다.`
            : "이 Google 계정은 ScenarioShare에 로그인할 수 없습니다.",
        });

        if (!rejectedUsers.has(sessionUser.id)) {
          rejectedUsers.add(sessionUser.id);
          window.setTimeout(() => {
            supabase.auth.signOut({ scope: "local" }).catch(() => null);
          }, 0);
        }
        return;
      }

      setUser(sessionUser);
      setAuthState(sessionUser ? "signed-in" : "signed-out");
      if (!sessionUser) {
        setMembership(null);
        setWorkspaceState("idle");
        setDocuments([]);
        setMembers([]);
      }
    };

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setNotice({ tone: "error", message: error.message });
        setAuthState("signed-out");
        return;
      }
      applySession(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        applySession(session);
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  const fetchDocuments = useCallback(
    async (workspaceId, { quiet = false } = {}) => {
      if (!supabase || !workspaceId) return [];
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        if (!quiet) setNotice({ tone: "error", message: `문서를 불러오지 못했습니다: ${error.message}` });
        return [];
      }

      const rows = data || [];
      setDocuments(rows);
      setSelectedDocumentId((current) => {
        if (current && rows.some((document) => document.id === current)) return current;
        const remembered = window.localStorage.getItem(
          `scenario-share:selected:${workspaceId}`,
        );
        return rows.some((document) => document.id === remembered)
          ? remembered
          : rows[0]?.id || null;
      });
      return rows;
    },
    [supabase],
  );

  const fetchMembers = useCallback(
    async (workspaceId) => {
      if (!supabase || !workspaceId) return;
      let { data, error } = await supabase
        .from("workspace_members")
        .select(
          "workspace_id,user_id,role,created_at,profiles:user_id(id,display_name,avatar_url,email)",
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });

      if (error) {
        const fallback = await supabase
          .from("workspace_members")
          .select("workspace_id,user_id,role,created_at")
          .eq("workspace_id", workspaceId);
        if (fallback.error) {
          setNotice({ tone: "error", message: `구성원을 불러오지 못했습니다: ${fallback.error.message}` });
          return;
        }
        const ids = (fallback.data || []).map((row) => row.user_id);
        const profiles = ids.length
          ? await supabase
              .from("profiles")
              .select("id,display_name,avatar_url,email")
              .in("id", ids)
          : { data: [] };
        const profilesById = new Map(
          (profiles.data || []).map((profile) => [profile.id, profile]),
        );
        data = (fallback.data || []).map((row) => ({
          ...row,
          profiles: profilesById.get(row.user_id),
        }));
      }

      setMembers((data || []).map(normalizeMember));
    },
    [supabase],
  );

  const claimWorkspace = useCallback(async () => {
    if (!supabase || !user) return;
    setWorkspaceState("claiming");
    setNotice(null);
    const { data, error } = await supabase.rpc("claim_scenario_share_workspace");
    if (error) {
      const inviteError = /invite|invitation|초대|member|membership|access|permission/i.test(
        error.message,
      );
      setWorkspaceState(inviteError ? "invite-required" : "error");
      setNotice(
        inviteError
          ? null
          : { tone: "error", message: `워크스페이스 연결에 실패했습니다: ${error.message}` },
      );
      return;
    }

    const claimed = normalizeMembership(data, user.id);
    if (!claimed?.workspace_id) {
      setWorkspaceState("invite-required");
      return;
    }

    setMembership(claimed);
    setWorkspaceState("ready");
    await Promise.all([
      fetchDocuments(claimed.workspace_id),
      fetchMembers(claimed.workspace_id),
    ]);
  }, [fetchDocuments, fetchMembers, supabase, user]);

  useEffect(() => {
    if (authState !== "signed-in" || !user) return undefined;
    const task = window.setTimeout(() => claimWorkspace(), 0);
    return () => window.clearTimeout(task);
  }, [authState, claimWorkspace, user]);

  useEffect(() => {
    if (!supabase || !membership?.workspace_id) return undefined;
    const workspaceId = membership.workspace_id;
    const channel = supabase
      .channel(`scenario-share-documents-${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          window.clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = window.setTimeout(
            () => fetchDocuments(workspaceId, { quiet: true }),
            180,
          );
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchDocuments, membership?.workspace_id, supabase]);

  useEffect(() => {
    if (!membership?.workspace_id || !selectedDocumentId) return;
    window.localStorage.setItem(
      `scenario-share:selected:${membership.workspace_id}`,
      selectedDocumentId,
    );
  }, [membership?.workspace_id, selectedDocumentId]);

  const signIn = async () => {
    if (!supabase) return;
    setBusy(true);
    setNotice(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      setNotice({ tone: "error", message: error.message });
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "local" });
    setBusy(false);
    if (error) {
      setNotice({ tone: "error", message: `로그아웃하지 못했습니다: ${error.message}` });
    }
  };

  const createDocument = async (parentId = null) => {
    if (!supabase || !membership || !user) return null;
    const siblingCount = documents.filter(
      (document) => (document.parent_id || null) === (parentId || null),
    ).length;
    const { data, error } = await supabase
      .from("documents")
      .insert({
        workspace_id: membership.workspace_id,
        parent_id: parentId,
        title: "제목 없는 문서",
        plain_text: "",
        slug: createDocumentSlug("제목 없는 문서"),
        sort_order: siblingCount,
      })
      .select("*")
      .single();

    if (error) {
      setNotice({ tone: "error", message: `문서를 만들지 못했습니다: ${error.message}` });
      return null;
    }
    setDocuments((current) => [...current, data]);
    setSelectedDocumentId(data.id);
    setSidebarOpen(false);
    return data;
  };

  const patchDocument = useCallback((documentId, patch) => {
    setDocuments((current) =>
      current.map((document) =>
        document.id === documentId ? { ...document, ...patch } : document,
      ),
    );
  }, []);

  const currentDocument = documents.find(
    (document) => document.id === selectedDocumentId,
  );
  const currentProfile = user ? profileFromUser(user) : null;

  if (authState === "missing-env") {
    return (
      <CenteredShell>
        <div className={styles.stateIconError}><LuSettings /></div>
        <div className={styles.brandPill}>ScenarioShare</div>
        <h1>Supabase 연결이 필요합니다</h1>
        <p className={styles.stateDescription}>
          아래 환경 변수를 프로젝트의 <code>.env.local</code>에 추가한 뒤 개발 서버를 다시 시작해 주세요.
        </p>
        <div className={styles.envList}>
          {supabaseEnvironment.missing.map((name) => <code key={name}>{name}</code>)}
        </div>
      </CenteredShell>
    );
  }

  if (authState === "loading") {
    return <LoadingScreen label="ScenarioShare를 준비하는 중" />;
  }

  if (authState === "signed-out") {
    return (
      <CenteredShell>
        <div className={styles.loginMark}><LuBookOpen /></div>
        <div className={styles.brandPill}>PRIVATE WORKSPACE · GOOGLE</div>
        <h1>Google 계정으로 편집자 확인</h1>
        <p className={styles.stateDescription}>
          로그인한 Google 계정의 고유 ID가 문서 편집, 버전 저장, 댓글과 실시간 커서의 작성자로 기록됩니다.
        </p>
        <button className={styles.googleButton} onClick={signIn} disabled={busy}>
          <GoogleMark />
          {busy ? "Google로 이동하는 중…" : "Google 계정으로 계속"}
        </button>
        <p className={styles.loginFinePrint}>지정된 두 Google 계정만 편집 공간에 입장할 수 있습니다.</p>
        {notice && <InlineNotice notice={notice} />}
      </CenteredShell>
    );
  }

  if (workspaceState === "claiming" || workspaceState === "idle") {
    return <LoadingScreen label="워크스페이스 권한을 확인하는 중" />;
  }

  if (workspaceState === "invite-required") {
    return (
      <CenteredShell>
        <div className={styles.stateIcon}><LuUsers /></div>
        <div className={styles.brandPill}>접근 권한 확인</div>
        <h1>워크스페이스 권한을 확인할 수 없습니다</h1>
        <p className={styles.stateDescription}>
          <strong>{user?.email}</strong> 허용 계정 설정이 적용되었는지 확인한 뒤 다시 시도해 주세요.
        </p>
        <div className={styles.stateActions}>
          <button className={styles.primaryButton} onClick={claimWorkspace}>
            <LuRefreshCw /> 다시 확인
          </button>
          <button className={styles.secondaryButton} onClick={signOut}>
            <LuLogOut /> 다른 계정으로 로그인
          </button>
        </div>
      </CenteredShell>
    );
  }

  if (workspaceState === "error") {
    return (
      <CenteredShell>
        <div className={styles.stateIconError}><LuTriangleAlert /></div>
        <h1>워크스페이스를 열 수 없습니다</h1>
        {notice && <InlineNotice notice={notice} />}
        <button className={styles.primaryButton} onClick={claimWorkspace}><LuRefreshCw /> 다시 시도</button>
      </CenteredShell>
    );
  }

  return (
    <main className={styles.app} lang="ko">
      <div className={styles.mobileHeader}>
        <button className={styles.iconButton} onClick={() => setSidebarOpen(true)} aria-label="문서 메뉴 열기"><LuMenu /></button>
        <div className={styles.mobileBrand}><span>SS</span> ScenarioShare</div>
        <button className={styles.avatarButton} onClick={() => setMembersOpen(true)} aria-label="구성원 열기">
          {currentProfile?.avatar ? <img src={currentProfile.avatar} alt="" /> : initials(currentProfile?.name)}
        </button>
      </div>

      <WikiSidebar
        open={sidebarOpen}
        documents={documents}
        selectedDocumentId={selectedDocumentId}
        onSelect={(id) => { setSelectedDocumentId(id); setSidebarOpen(false); }}
        onCreate={createDocument}
        onDocumentsChange={setDocuments}
        onClose={() => setSidebarOpen(false)}
        supabase={supabase}
        workspaceId={membership.workspace_id}
        user={user}
        membership={membership}
        members={members}
        onMembersOpen={() => setMembersOpen(true)}
        onSignOut={signOut}
      />

      {sidebarOpen && <button className={styles.mobileScrim} onClick={() => setSidebarOpen(false)} aria-label="메뉴 닫기" />}

      <section className={styles.workspace}>
        {notice && (
          <div className={styles.globalNotice}>
            <InlineNotice notice={notice} />
            <button onClick={() => setNotice(null)} aria-label="알림 닫기"><LuX /></button>
          </div>
        )}
        {currentDocument ? (
          <CollaborativeDocument
            key={currentDocument.id}
            document={currentDocument}
            documents={documents}
            supabase={supabase}
            user={user}
            membership={membership}
            members={members}
            onSelectDocument={setSelectedDocumentId}
            onDocumentPatch={patchDocument}
            onMembersOpen={() => setMembersOpen(true)}
          />
        ) : (
          <div className={styles.emptyWorkspace}>
            <div className={styles.emptyIllustration}><LuBookOpen /></div>
            <h2>첫 번째 문서를 만들어 보세요</h2>
            <p>세계관, 캐릭터, 에피소드처럼 필요한 주제부터 시작하면 됩니다.</p>
            <button className={styles.primaryButton} onClick={() => createDocument(null)}>
              새 문서 만들기 <LuChevronRight />
            </button>
          </div>
        )}
      </section>

      <MembersModal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        members={members}
        currentUser={user}
      />
    </main>
  );
}

function CenteredShell({ children }) {
  return (
    <main className={styles.centeredPage} lang="ko">
      <div className={styles.centeredCard}>{children}</div>
    </main>
  );
}

function LoadingScreen({ label }) {
  return (
    <main className={styles.loadingPage} lang="ko">
      <div className={styles.loadingLogo}>SS</div>
      <div className={styles.loadingDots}><span /><span /><span /></div>
      <p>{label}</p>
    </main>
  );
}

function InlineNotice({ notice }) {
  return <div className={`${styles.inlineNotice} ${notice.tone === "error" ? styles.inlineNoticeError : ""}`}>{notice.message}</div>;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.86A6.02 6.02 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.48l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
    </svg>
  );
}
