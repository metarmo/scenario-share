/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import {
  LuCheck,
  LuChevronRight,
  LuCircleAlert,
  LuCloud,
  LuCloudOff,
  LuLoaderCircle,
  LuUsers,
  LuWifiOff,
  LuX,
} from "react-icons/lu";
import { SupabaseYjsProvider } from "@/lib/scenario-share/supabase-yjs-provider";
import { CommentsPanel } from "./CommentsPanel";
import { EditorToolbar } from "./EditorToolbar";
import { VersionDrawer } from "./VersionDrawer";
import {
  colorForUser,
  documentBreadcrumbs,
  initials,
  profileFromUser,
} from "./utils";
import styles from "./ScenarioShare.module.css";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function providerStatusLabel(status, pending) {
  if (status === "connected") return pending ? "동기화 중" : "온라인";
  if (status === "degraded") return "연결 복구 중";
  if (status === "offline") return "오프라인";
  if (status === "error") return "연결 오류";
  if (status === "syncing") return "문서 동기화 중";
  return "연결 중";
}

export function CollaborativeDocument({
  document,
  documents,
  supabase,
  user,
  membership,
  members,
  onSelectDocument,
  onDocumentPatch,
  onMembersOpen,
}) {
  const [provider, setProvider] = useState(null);
  const [synced, setSynced] = useState(false);
  const [providerStatus, setProviderStatus] = useState("connecting");
  const [providerPending, setProviderPending] = useState(false);
  const [providerError, setProviderError] = useState(null);
  const [collaborators, setCollaborators] = useState([]);
  const [editor, setEditor] = useState(null);
  const [title, setTitle] = useState(document.title || "제목 없는 문서");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [versionState, setVersionState] = useState(null);
  const [followUserId, setFollowUserId] = useState(null);
  const titleTimerRef = useRef(null);
  const titleDirtyRef = useRef(false);
  const readOnly = membership.role === "viewer";
  const profile = useMemo(() => profileFromUser(user), [user]);
  const realtimeUser = useMemo(
    () => ({
      id: user.id,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatar,
      color: profile.color || colorForUser(user.id),
    }),
    [profile, user.id],
  );
  const breadcrumbs = useMemo(
    () => documentBreadcrumbs(documents, document.id),
    [document.id, documents],
  );

  useEffect(() => {
    let active = true;
    const instance = new SupabaseYjsProvider({
      supabase,
      documentId: document.id,
      user: realtimeUser,
      readOnly,
    });

    const handleStatus = (event) => {
      if (!active) return;
      const status = typeof event === "string" ? event : event?.status;
      if (status) setProviderStatus(status);
      setProviderPending(Boolean(event?.pendingUpdates));
    };
    const handleSynced = () => {
      if (!active) return;
      setProvider(instance);
      setSynced(true);
      setProviderStatus("connected");
    };
    const handlePending = (event) => {
      if (!active) return;
      setProviderPending(Boolean(event?.bufferedUpdates || event?.outboxEntries));
    };
    const handleError = (event) => {
      if (!active || event?.operation === "indexeddb") return;
      setProviderError(event?.message || event?.error?.message || "실시간 연결에 문제가 생겼습니다.");
    };
    const handleCollaborators = (next) => {
      if (!active) return;
      const deduplicated = [];
      const seen = new Set();
      for (const collaborator of next || []) {
        const id = collaborator.userId || collaborator.awareness?.user?.id || collaborator.clientId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        deduplicated.push({ ...collaborator, userId: id });
      }
      setCollaborators(deduplicated);
      setFollowUserId((current) =>
        current && !deduplicated.some((item) => item.userId === current)
          ? null
          : current,
      );
    };

    instance.on("status", handleStatus);
    instance.on("synced", handleSynced);
    instance.on("pending", handlePending);
    instance.on("error", handleError);
    instance.on("collaborators", handleCollaborators);
    instance.connect().then(() => {
      if (active && instance.synced) handleSynced();
    }).catch((error) => {
      if (active) {
        setProviderStatus("error");
        setProviderError(error.message);
      }
    });

    return () => {
      active = false;
      instance.off("status", handleStatus);
      instance.off("synced", handleSynced);
      instance.off("pending", handlePending);
      instance.off("error", handleError);
      instance.off("collaborators", handleCollaborators);
      void instance.destroy();
    };
  }, [document.id, readOnly, realtimeUser, supabase]);

  useEffect(() => {
    if (titleDirtyRef.current) return undefined;
    const task = window.setTimeout(
      () => setTitle(document.title || "제목 없는 문서"),
      0,
    );
    return () => window.clearTimeout(task);
  }, [document.id, document.title]);

  useEffect(() => {
    if (!titleDirtyRef.current || readOnly) return undefined;
    if (title === document.title) {
      titleDirtyRef.current = false;
      return undefined;
    }
    window.clearTimeout(titleTimerRef.current);
    titleTimerRef.current = window.setTimeout(async () => {
      const nextTitle = title.trim() || "제목 없는 문서";
      const { error } = await supabase.from("documents").update({ title: nextTitle }).eq("id", document.id);
      if (error) setSaveError(`제목 저장 실패: ${error.message}`);
      else {
        titleDirtyRef.current = false;
        onDocumentPatch(document.id, { title: nextTitle });
      }
    }, 650);
    return () => window.clearTimeout(titleTimerRef.current);
  }, [document.id, document.title, onDocumentPatch, readOnly, supabase, title]);

  const loadVersions = useCallback(async () => {
    setVersionState("loading");
    const { data, error } = await supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", document.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      setSaveError(`버전 기록을 불러오지 못했습니다: ${error.message}`);
      setVersions([]);
    } else {
      setVersions(data || []);
    }
    setVersionState(null);
  }, [document.id, supabase]);

  useEffect(() => {
    if (!versionsOpen) return undefined;
    const task = window.setTimeout(() => loadVersions(), 0);
    return () => window.clearTimeout(task);
  }, [loadVersions, versionsOpen]);

  const saveVersion = useCallback(async ({ label = "직접 저장", titleOverride } = {}) => {
    if (!provider || !editor || saving || readOnly) return false;
    setSaving(true);
    setSaveError(null);
    try {
      await provider.flush();
      const snapshot = await provider.syncForVersion();
      const savedTitle = (titleOverride ?? title).trim() || "제목 없는 문서";
      const content = editor.getJSON();
      const plainText = editor.getText({ blockSeparator: "\n" });
      const { data: version, error: versionError } = await supabase
        .from("document_versions")
        .insert({
          document_id: document.id,
          title: savedTitle,
          label,
          yjs_state: snapshot.stateBase64,
          content,
          plain_text: plainText,
          last_update_id: snapshot.checkpointId,
        })
        .select("*")
        .single();
      if (versionError) throw versionError;
      const { error: documentError } = await supabase
        .from("documents")
        .update({ title: savedTitle, plain_text: plainText })
        .eq("id", document.id);
      if (documentError) throw documentError;
      titleDirtyRef.current = false;
      setDirty(false);
      setProviderPending(false);
      onDocumentPatch(document.id, { title: savedTitle, plain_text: plainText, updated_at: new Date().toISOString() });
      if (version) setVersions((current) => [version, ...current.filter((item) => item.id !== version.id)].slice(0, 30));
      return true;
    } catch (error) {
      setSaveError(`저장하지 못했습니다: ${error.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [document.id, editor, onDocumentPatch, provider, readOnly, saving, supabase, title]);

  const restoreVersion = async (version) => {
    if (!editor || readOnly) return;
    setVersionState(version.id);
    setSaveError(null);
    try {
      editor.commands.setContent(version.content || EMPTY_DOC, { emitUpdate: true });
      const restoredTitle = version.title || "제목 없는 문서";
      titleDirtyRef.current = true;
      setTitle(restoredTitle);
      setDirty(true);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      const restored = await saveVersion({
        label: `복원 · ${new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(version.created_at))}`,
        titleOverride: restoredTitle,
      });
      if (restored) await loadVersions();
    } catch (error) {
      setSaveError(`버전을 복원하지 못했습니다: ${error.message}`);
    }
    setVersionState(null);
  };

  useEffect(() => {
    if (!editor) return undefined;
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveVersion();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [editor, saveVersion]);

  useEffect(() => {
    if (!followUserId) return undefined;
    const follow = () => {
      const escaped = window.CSS?.escape ? window.CSS.escape(String(followUserId)) : String(followUserId).replace(/["\\]/g, "\\$&");
      const caret = window.document.querySelector(`[data-collaborator-id="${escaped}"]`);
      caret?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    };
    follow();
    const interval = window.setInterval(follow, 480);
    return () => window.clearInterval(interval);
  }, [collaborators, followUserId]);

  const toggleComments = () => {
    setCommentsOpen((value) => !value);
    setVersionsOpen(false);
  };
  const toggleVersions = () => {
    setVersionsOpen((value) => !value);
    setCommentsOpen(false);
  };
  const remoteCollaborators = collaborators.filter((item) => !item.isSelf);
  const followed = collaborators.find((item) => item.userId === followUserId);

  return (
    <div className={styles.documentWorkspace}>
      <header className={styles.documentHeader}>
        <div className={styles.breadcrumbs}>
          {breadcrumbs.map((item, index) => (
            <span key={item.id}>
              {index > 0 && <LuChevronRight />}
              <button onClick={() => onSelectDocument(item.id)}>{item.title || "제목 없는 문서"}</button>
            </span>
          ))}
        </div>
        <div className={styles.documentHeaderRight}>
          <div className={`${styles.connectionStatus} ${["offline", "error", "degraded"].includes(providerStatus) ? styles.connectionStatusBad : ""}`} title={providerError || "실시간 동기화 상태"}>
            {providerStatus === "connected" ? <LuCloud /> : providerStatus === "offline" ? <LuCloudOff /> : providerStatus === "error" ? <LuWifiOff /> : <LuLoaderCircle className={styles.spin} />}
            <span>{providerStatusLabel(providerStatus, providerPending)}</span>
          </div>
          <div className={styles.collaboratorStack}>
            {collaborators.slice(0, 5).map((collaborator) => (
              <button
                key={collaborator.clientId || collaborator.userId}
                className={`${styles.collaboratorAvatar} ${collaborator.isSelf ? styles.collaboratorSelf : ""} ${followUserId === collaborator.userId ? styles.collaboratorFollowed : ""}`}
                style={{ "--collaborator-color": collaborator.color || colorForUser(collaborator.userId) }}
                onClick={() => collaborator.isSelf ? onMembersOpen() : setFollowUserId((current) => current === collaborator.userId ? null : collaborator.userId)}
                title={collaborator.isSelf ? `${collaborator.name} (나)` : `${collaborator.name}의 편집 위치 따라가기`}
              >
                {collaborator.avatarUrl ? <img src={collaborator.avatarUrl} alt="" /> : initials(collaborator.name)}
                <i />
              </button>
            ))}
            {!collaborators.length && (
              <button className={`${styles.collaboratorAvatar} ${styles.collaboratorSelf}`} onClick={onMembersOpen} title={`${profile.name} (나)`}>
                {profile.avatar ? <img src={profile.avatar} alt="" /> : initials(profile.name)}<i />
              </button>
            )}
            <button className={styles.collaboratorCount} onClick={onMembersOpen} title="구성원 보기"><LuUsers />{remoteCollaborators.length > 0 && <span>{remoteCollaborators.length}</span>}</button>
          </div>
        </div>
      </header>

      {followed && (
        <div className={styles.followBanner} style={{ "--follow-color": followed.color }}>
          <span>{followed.avatarUrl ? <img src={followed.avatarUrl} alt="" /> : initials(followed.name)}</span>
          <strong>{followed.name}</strong> 님의 편집 위치를 따라가는 중
          <button onClick={() => setFollowUserId(null)}><LuX /> 따라가기 종료</button>
        </div>
      )}

      {providerError && (
        <div className={styles.editorAlert}><LuCircleAlert /><span>{providerError}</span><button onClick={() => setProviderError(null)} aria-label="닫기"><LuX /></button></div>
      )}
      {saveError && (
        <div className={styles.editorAlert}><LuCircleAlert /><span>{saveError}</span><button onClick={() => setSaveError(null)} aria-label="닫기"><LuX /></button></div>
      )}

      <EditorToolbar
        editor={editor}
        readOnly={readOnly}
        dirty={dirty || providerPending}
        saving={saving}
        onSave={() => saveVersion()}
        onPrint={() => window.print()}
        commentsOpen={commentsOpen}
        versionsOpen={versionsOpen}
        onToggleComments={toggleComments}
        onToggleVersions={toggleVersions}
      />

      <div className={styles.editorAndPanel}>
        <div className={styles.editorScroll}>
          <article className={styles.pageCanvas}>
            <div className={styles.documentTitleArea}>
              <input
                value={title}
                readOnly={readOnly}
                onChange={(event) => {
                  titleDirtyRef.current = true;
                  setTitle(event.target.value);
                  setDirty(true);
                }}
                onBlur={() => {
                  if (!title.trim()) {
                    titleDirtyRef.current = true;
                    setTitle("제목 없는 문서");
                  }
                }}
                placeholder="문서 제목"
                aria-label="문서 제목"
              />
              <div className={styles.titleMeta}>
                {readOnly && <span>읽기 전용</span>}
                {!readOnly && (dirty || providerPending ? <span className={styles.unsavedLabel}>저장되지 않은 변경</span> : <span><LuCheck /> 모든 변경 저장됨</span>)}
                {remoteCollaborators.length > 0 && <span className={styles.editingLabel}>{remoteCollaborators.map((item) => item.name).join(", ")} 편집 중</span>}
              </div>
            </div>
            {!synced || !provider ? (
              <div className={styles.editorLoading}>
                <div className={styles.editorLoadingIcon}><LuCloud /><span /></div>
                <strong>최신 문서를 동기화하고 있습니다</strong>
                <p>오프라인 변경과 팀의 최근 편집을 안전하게 합치는 중입니다.</p>
              </div>
            ) : (
              <TiptapEditor
                provider={provider}
                user={realtimeUser}
                readOnly={readOnly}
                onReady={setEditor}
                onDirty={() => setDirty(true)}
              />
            )}
          </article>
          {editor && (
            <footer className={styles.editorFooter}>
              <span>{editor.storage.characterCount.words()} 단어</span>
              <span>{editor.storage.characterCount.characters()}자</span>
              <span>{readOnly ? "보기 모드" : "자동 동기화 · ⌘S로 버전 저장"}</span>
            </footer>
          )}
        </div>

        <CommentsPanel
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          supabase={supabase}
          documentId={document.id}
          editor={editor}
          members={members}
          readOnly={readOnly}
        />
        <VersionDrawer
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          versions={versions}
          members={members}
          currentUser={user}
          restoring={versionState}
          onRestore={restoreVersion}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

function TiptapEditor({ provider, user, readOnly, onReady, onDirty }) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [
        StarterKit.configure({
          history: false,
          undoRedo: false,
          link: false,
          underline: false,
        }),
        Collaboration.configure({ document: provider.doc, field: "content" }),
        CollaborationCaret.configure({
          provider,
          user,
          render: (collaborator) => {
            const caret = window.document.createElement("span");
            caret.classList.add(styles.collaborationCaret);
            caret.dataset.collaboratorId = String(collaborator.id || collaborator.userId || "unknown");
            caret.style.setProperty("--caret-color", collaborator.color || "#635bff");
            const label = window.document.createElement("span");
            label.classList.add(styles.collaborationCaretLabel);
            if (collaborator.avatarUrl) {
              const avatar = window.document.createElement("img");
              avatar.src = collaborator.avatarUrl;
              avatar.alt = "";
              label.appendChild(avatar);
            }
            label.appendChild(window.document.createTextNode(collaborator.name || "편집자"));
            caret.appendChild(label);
            return caret;
          },
        }),
        Underline,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
        Image.configure({ allowBase64: false }),
        TextAlign.configure({ types: ["heading", "paragraph", "tableCell"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Placeholder.configure({
          placeholder: ({ node }) => node.type.name === "heading" ? "제목" : "이야기를 시작해 보세요. ‘/’로 블록을 추가할 수 있습니다…",
          showOnlyCurrent: true,
        }),
        CharacterCount,
      ],
      editorProps: {
        attributes: {
          class: styles.tiptapDocument,
          spellcheck: "true",
          autocapitalize: "sentences",
          "aria-label": readOnly ? "문서 내용" : "문서 편집기",
        },
      },
      onUpdate: () => onDirty(),
    },
    [provider, readOnly],
  );

  useEffect(() => {
    onReady(editor || null);
    return () => onReady(null);
  }, [editor, onReady]);

  return <EditorContent editor={editor} className={styles.editorContent} />;
}
