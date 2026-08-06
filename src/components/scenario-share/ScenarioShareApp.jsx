/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuBookOpen,
  LuFolderPlus,
  LuLogOut,
  LuMenu,
  LuRefreshCw,
  LuSettings,
  LuTriangleAlert,
  LuUsers,
  LuX,
} from "react-icons/lu";
import {
  DOCUMENT_ITEM_TYPE,
  FOLDER_ITEM_TYPE,
  canMoveItem,
  countTreeItemTypes,
  isDocument,
  isFolder,
  isOpenableDocument,
  resolveDocumentAfterDeletion,
  resolveSelectedDocumentId,
} from "@/lib/scenario-share/document-tree.mjs";
import {
  getSupabaseBrowserClient,
  supabaseEnvironment,
} from "@/lib/supabase/client";
import {
  hasSameScenarioShareUserIdentity,
  isAllowedLoginEmail,
  normalizeLoginEmail,
} from "@/lib/scenario-share/auth-access.mjs";
import {
  SupabaseYjsProvider,
  clearScenarioShareLocalDocument,
} from "@/lib/scenario-share/supabase-yjs-provider";
import {
  normalizeDocumentTitle,
  readSharedDocumentTitle,
  setSharedDocumentTitle,
} from "@/lib/scenario-share/yjs-shared-fields.mjs";
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
  const activeProviderRef = useRef(null);

  const registerActiveProvider = useCallback((documentId, provider, expectedProvider) => {
    if (provider) {
      activeProviderRef.current = { documentId, provider };
      return;
    }
    if (
      activeProviderRef.current?.documentId === documentId
      && (!expectedProvider || activeProviderRef.current.provider === expectedProvider)
    ) {
      activeProviderRef.current = null;
    }
  }, []);

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

      setUser((currentUser) =>
        hasSameScenarioShareUserIdentity(currentUser, sessionUser)
          ? currentUser
          : sessionUser,
      );
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
        const remembered = window.localStorage.getItem(
          `scenario-share:selected:${workspaceId}`,
        );
        return resolveSelectedDocumentId(rows, {
          currentId: current,
          rememberedId: remembered,
        });
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
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(
        () => fetchDocuments(workspaceId, { quiet: true }),
        180,
      );
    };
    const channel = supabase
      .channel(`scenario-share-documents-${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "documents",
        },
        (payload) => {
          const deletedId = payload?.old?.id;
          if (deletedId) {
            window.setTimeout(() => {
              clearScenarioShareLocalDocument(deletedId).catch(() => null);
            }, 500);
          }
          scheduleRefresh();
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchDocuments, membership?.workspace_id, supabase]);

  useEffect(() => {
    if (!membership?.workspace_id) return;
    const storageKey = `scenario-share:selected:${membership.workspace_id}`;
    if (selectedDocumentId) window.localStorage.setItem(storageKey, selectedDocumentId);
    else window.localStorage.removeItem(storageKey);
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

  const createItem = async ({ parentId = null, itemType = DOCUMENT_ITEM_TYPE } = {}) => {
    if (!supabase || !membership || !user || membership.role === "viewer") return null;
    const siblingCount = documents.filter(
      (document) => (document.parent_id || null) === (parentId || null),
    ).length;
    const title = itemType === FOLDER_ITEM_TYPE ? "새 폴더" : "제목 없는 문서";
    const { data, error } = await supabase
      .from("documents")
      .insert({
        workspace_id: membership.workspace_id,
        parent_id: parentId,
        item_type: itemType,
        title,
        plain_text: "",
        slug: createDocumentSlug(title),
        sort_order: siblingCount,
      })
      .select("*")
      .single();

    if (error) {
      setNotice({
        tone: "error",
        message: `${itemType === FOLDER_ITEM_TYPE ? "폴더" : "문서"}를 만들지 못했습니다: ${error.message}`,
      });
      return null;
    }
    setDocuments((current) => [...current, data]);
    if (isDocument(data)) {
      setSelectedDocumentId(data.id);
      setSidebarOpen(false);
    }
    return data;
  };

  const moveItem = async (itemId, parentId = null) => {
    if (!supabase || !membership || membership.role === "viewer") return false;
    if (!canMoveItem(documents, itemId, parentId)) return false;
    const siblingCount = documents.filter(
      (item) => item.id !== itemId && (item.parent_id || null) === (parentId || null),
    ).length;
    const { data, error } = await supabase
      .from("documents")
      .update({ parent_id: parentId, sort_order: siblingCount })
      .eq("id", itemId)
      .eq("workspace_id", membership.workspace_id)
      .select("id,parent_id,sort_order")
      .maybeSingle();

    if (error || !data) {
      setNotice({
        tone: "error",
        message: `항목을 이동하지 못했습니다: ${error?.message || "변경 권한을 확인해 주세요."}`,
      });
      return false;
    }

    setDocuments((current) => current.map((item) => (
      item.id === itemId
        ? { ...item, parent_id: data.parent_id, sort_order: data.sort_order }
        : item
    )));
    return true;
  };

  const renameItem = async (item, requestedTitle) => {
    if (!supabase || !membership || !user || membership.role === "viewer") return false;
    const title = normalizeDocumentTitle(requestedTitle);
    if (title === item.title) return true;

    if (isFolder(item)) {
      const { error } = await supabase
        .from("documents")
        .update({ title })
        .eq("id", item.id)
        .eq("workspace_id", membership.workspace_id);
      if (error) {
        setNotice({ tone: "error", message: `폴더 이름을 바꾸지 못했습니다: ${error.message}` });
        return false;
      }
      setDocuments((current) => current.map((currentItem) => (
        currentItem.id === item.id ? { ...currentItem, title } : currentItem
      )));
      return true;
    }

    const active = activeProviderRef.current;
    const ownsProvider = active?.documentId !== item.id;
    const provider = ownsProvider
      ? new SupabaseYjsProvider({
        supabase,
        documentId: item.id,
        user: { id: user.id },
        initialTitle: item.title,
      })
      : active.provider;

    try {
      await provider.connect();
      setSharedDocumentTitle(provider.doc, title);
      await provider.flush();
      const mergedTitle = normalizeDocumentTitle(
        readSharedDocumentTitle(provider.doc, title),
      );
      const { error } = await supabase
        .from("documents")
        .update({ title: mergedTitle })
        .eq("id", item.id)
        .eq("workspace_id", membership.workspace_id);
      if (error) throw error;

      setDocuments((current) => current.map((currentItem) => (
        currentItem.id === item.id
          ? { ...currentItem, title: mergedTitle }
          : currentItem
      )));
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: `문서 제목을 바꾸지 못했습니다: ${error.message}` });
      return false;
    } finally {
      if (ownsProvider) await provider.destroy();
    }
  };

  const deleteItem = async (itemId) => {
    if (!supabase || !membership || membership.role === "viewer") return false;

    const { data: previewData, error: previewError } = await supabase.rpc(
      "preview_scenario_share_item_deletion",
      { p_item_id: itemId },
    );
    if (previewError) {
      setNotice({ tone: "error", message: `삭제 대상을 확인하지 못했습니다: ${previewError.message}` });
      return false;
    }

    let preview;
    try {
      preview = typeof previewData === "string"
        ? JSON.parse(previewData)
        : (previewData || {});
    } catch {
      setNotice({ tone: "error", message: "삭제 대상을 확인하지 못했습니다. 다시 시도해 주세요." });
      return false;
    }
    const previewItems = Array.isArray(preview.items) ? preview.items : [];
    const attachments = Array.isArray(preview.attachments) ? preview.attachments : [];
    const target = previewItems.find((item) => item.id === itemId);
    const counts = countTreeItemTypes(previewItems, previewItems.map((item) => item.id));
    const targetLabel = target?.item_type === FOLDER_ITEM_TYPE ? "폴더" : "문서";
    const details = [
      counts.folders ? `폴더 ${counts.folders}개` : null,
      counts.documents ? `문서 ${counts.documents}개` : null,
      attachments.length ? `첨부 ${attachments.length}개` : null,
    ].filter(Boolean).join(" · ");
    const confirmed = window.confirm(
      `“${target?.title || "제목 없는 항목"}” ${targetLabel}의 영구 삭제${target?.deletion_pending ? "를 계속" : ""}할까요?\n\n${details || "이 항목"}와 문서 내용, 버전, 댓글이 모두 삭제되며 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return false;

    const expectedItemIds = previewItems.map((item) => item.id).filter(Boolean);
    const expectedAttachmentIds = attachments.map((attachment) => attachment.id).filter(Boolean);
    const { data: preparedData, error: prepareError } = await supabase.rpc(
      "prepare_scenario_share_item_deletion",
      {
        p_item_id: itemId,
        p_expected_item_ids: expectedItemIds,
        p_expected_attachment_ids: expectedAttachmentIds,
      },
    );
    if (prepareError) {
      setNotice({
        tone: "error",
        message: `삭제 대상이 변경되어 아무것도 지우지 않았습니다. 다시 확인해 주세요: ${prepareError.message}`,
      });
      return false;
    }

    let prepared;
    try {
      prepared = typeof preparedData === "string"
        ? JSON.parse(preparedData)
        : (preparedData || {});
    } catch {
      setNotice({ tone: "error", message: "삭제 준비 결과를 확인하지 못했습니다. 같은 항목에서 삭제를 다시 시도해 주세요." });
      return false;
    }

    const deletionToken = prepared.deletion_token;
    const preparedAttachments = Array.isArray(prepared.attachments)
      ? prepared.attachments
      : [];
    if (!deletionToken) {
      setNotice({ tone: "error", message: "삭제 준비 토큰을 받지 못했습니다. 같은 항목에서 삭제를 다시 시도해 주세요." });
      return false;
    }

    const preparedItemIds = Array.isArray(prepared.item_ids) && prepared.item_ids.length
      ? prepared.item_ids
      : expectedItemIds;
    const preparedItemIdSet = new Set(preparedItemIds);
    setDocuments((current) => current.map((item) => (
      preparedItemIdSet.has(item.id)
        ? { ...item, deletion_token: deletionToken }
        : item
    )));
    setSelectedDocumentId((current) =>
      resolveDocumentAfterDeletion(
        documents,
        current,
        preparedItemIds,
      ),
    );

    const objectPaths = preparedAttachments
      .map((attachment) => attachment.object_path)
      .filter(Boolean);
    for (let index = 0; index < objectPaths.length; index += 1000) {
      const { error } = await supabase.storage
        .from("scenario-share-attachments")
        .remove(objectPaths.slice(index, index + 1000));
      if (error) {
        setNotice({
          tone: "error",
          message: `첨부 파일 정리가 중단됐습니다. 항목은 편집되지 않도록 안전하게 잠겨 있으며, “삭제 다시 시도”로 이어서 처리할 수 있습니다: ${error.message}`,
        });
        return false;
      }
    }

    const { data: deletedData, error: deleteError } = await supabase.rpc(
      "delete_scenario_share_item",
      { p_deletion_token: deletionToken },
    );
    if (deleteError) {
      setNotice({
        tone: "error",
        message: `삭제 마무리가 중단됐습니다. 항목은 안전하게 잠겨 있으며, “삭제 다시 시도”로 이어서 처리할 수 있습니다: ${deleteError.message}`,
      });
      return false;
    }

    const serverDeletedIds = Array.isArray(deletedData) ? deletedData : [];
    const deletedIds = serverDeletedIds.length
      ? serverDeletedIds
      : previewItems.map((item) => item.id);
    const deletedIdSet = new Set(deletedIds);
    setDocuments((current) => current.filter((item) => !deletedIdSet.has(item.id)));
    setSelectedDocumentId((current) =>
      resolveDocumentAfterDeletion(documents, current, deletedIds),
    );
    setNotice({ tone: "success", message: `${targetLabel}를 영구 삭제했습니다.` });

    const deletedDocumentIds = previewItems
      .filter((item) => item.item_type !== FOLDER_ITEM_TYPE)
      .map((item) => item.id);
    window.setTimeout(() => {
      Promise.allSettled(
        deletedDocumentIds.map((documentId) => clearScenarioShareLocalDocument(documentId)),
      );
    }, 500);
    return true;
  };

  const patchDocument = useCallback((documentId, patch) => {
    setDocuments((current) =>
      current.map((document) =>
        document.id === documentId ? { ...document, ...patch } : document,
      ),
    );
  }, []);

  const currentDocument = documents.find(
    (document) => document.id === selectedDocumentId && isOpenableDocument(document),
  );
  const documentCount = documents.filter(isDocument).length;
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
        onSelect={(id) => {
          if (!isOpenableDocument(documents.find((item) => item.id === id))) return;
          setSelectedDocumentId(id);
          setSidebarOpen(false);
        }}
        onCreate={createItem}
        onMove={moveItem}
        onDelete={deleteItem}
        onRename={renameItem}
        onClose={() => setSidebarOpen(false)}
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
            onProviderChange={registerActiveProvider}
            onMembersOpen={() => setMembersOpen(true)}
          />
        ) : (
          <div className={styles.emptyWorkspace}>
            <div className={styles.emptyIllustration}>{documentCount ? <LuBookOpen /> : <LuFolderPlus />}</div>
            <h2>{documentCount ? "문서를 선택해 주세요" : "문서 탭에서 시작해 보세요"}</h2>
            <p>
              {membership.role === "viewer"
                ? "편집자가 문서를 만들면 이곳에서 함께 볼 수 있습니다."
                : "문서 탭의 + 버튼 또는 빈 영역 우클릭으로 새 폴더와 문서를 만들 수 있습니다."}
            </p>
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
