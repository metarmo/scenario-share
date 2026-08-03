/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import {
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import {
  LuCheck,
  LuChevronDown,
  LuCornerDownRight,
  LuMessageSquare,
  LuQuote,
  LuSend,
  LuX,
} from "react-icons/lu";
import { formatRelativeTime, initials } from "./utils";
import { base64ToBytes, bytesToBase64 } from "@/lib/scenario-share/base64.mjs";
import styles from "./ScenarioShare.module.css";

function commentAuthor(comment, members) {
  const member = members.find((item) => item.id === comment.author_id);
  const profile = Array.isArray(comment.profiles) ? comment.profiles[0] : comment.profiles;
  return member || {
    id: comment.author_id,
    name: profile?.display_name || profile?.email?.split("@")[0] || "구성원",
    avatar: profile?.avatar_url || null,
  };
}

function encodeEditorPosition(editor, position) {
  try {
    const mapped = editor.utils.createMappablePosition(position);
    if (!mapped?.yRelativePosition) return null;
    return bytesToBase64(Y.encodeRelativePosition(mapped.yRelativePosition));
  } catch {
    return null;
  }
}

function decodeEditorPosition(editor, encodedPosition) {
  try {
    const ystate = ySyncPluginKey.getState(editor.state);
    if (!ystate || !encodedPosition) return null;
    const relativePosition = Y.decodeRelativePosition(base64ToBytes(encodedPosition));
    return relativePositionToAbsolutePosition(
      ystate.doc,
      ystate.type,
      relativePosition,
      ystate.binding.mapping,
    );
  } catch {
    return null;
  }
}

export function CommentsPanel({
  open,
  onClose,
  supabase,
  documentId,
  editor,
  members,
  readOnly,
}) {
  const [comments, setComments] = useState([]);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadComments = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("comments")
      .select("*,profiles:author_id(id,display_name,avatar_url,email)")
      .eq("document_id", documentId)
      .order("created_at", { ascending: true });
    if (queryError) {
      const fallback = await supabase
        .from("comments")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at", { ascending: true });
      if (fallback.error) setError(fallback.error.message);
      else setComments(fallback.data || []);
      return;
    }
    setComments(data || []);
  }, [documentId, supabase]);

  useEffect(() => {
    if (!open) return undefined;
    const initialLoad = window.setTimeout(() => loadComments(), 0);
    const channel = supabase
      .channel(`scenario-share-comments-${documentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comments", filter: `document_id=eq.${documentId}` },
        loadComments,
      )
      .subscribe();
    return () => {
      window.clearTimeout(initialLoad);
      supabase.removeChannel(channel);
    };
  }, [documentId, loadComments, open, supabase]);

  const roots = useMemo(
    () => comments.filter((comment) => !comment.parent_id && (showResolved || !comment.resolved_at)),
    [comments, showResolved],
  );

  if (!open) return null;

  const addComment = async (event) => {
    event.preventDefault();
    if (!body.trim() || !editor) return;
    const { from, to } = editor.state.selection;
    const quote = from !== to ? editor.state.doc.textBetween(from, to, " ").slice(0, 500) : null;
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase.from("comments").insert({
      document_id: documentId,
      body: body.trim(),
      quote,
      anchor_start: quote ? encodeEditorPosition(editor, from) : null,
      anchor_end: quote ? encodeEditorPosition(editor, to) : null,
    });
    setBusy(false);
    if (insertError) setError(insertError.message);
    else {
      setBody("");
      await loadComments();
    }
  };

  const addReply = async (parentId) => {
    if (!replyBody.trim()) return;
    setBusy(true);
    const { error: insertError } = await supabase.from("comments").insert({
      document_id: documentId,
      parent_id: parentId,
      body: replyBody.trim(),
    });
    setBusy(false);
    if (insertError) setError(insertError.message);
    else {
      setReplyBody("");
      setReplyingTo(null);
      await loadComments();
    }
  };

  const resolve = async (comment) => {
    const resolved = !comment.resolved_at;
    const { error: updateError } = await supabase.rpc("set_comment_resolved", {
      p_comment_id: comment.id,
      p_resolved: resolved,
    });
    if (updateError) setError(updateError.message);
    else loadComments();
  };

  const jumpToQuote = (comment) => {
    if (!editor || comment.anchor_start == null || comment.anchor_end == null) return;
    const from = decodeEditorPosition(editor, comment.anchor_start);
    const to = decodeEditorPosition(editor, comment.anchor_end);
    if (from == null || to == null) return;
    const max = editor.state.doc.content.size;
    editor.chain().focus().setTextSelection({
      from: Math.min(from, max),
      to: Math.min(to, max),
    }).scrollIntoView().run();
  };

  return (
    <aside className={styles.sidePanel} aria-label="댓글">
      <header className={styles.sidePanelHeader}>
        <div><span><LuMessageSquare /> COMMENTS</span><h3>댓글</h3></div>
        <button onClick={onClose} aria-label="댓글 닫기"><LuX /></button>
      </header>

      {!readOnly && (
        <form className={styles.commentComposer} onSubmit={addComment}>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="피드백이나 아이디어를 남겨보세요…" rows={3} />
          <div>
            <span>{editor && !editor.state.selection.empty ? <><LuQuote /> 선택한 문장에 댓글</> : "문서 전체에 댓글"}</span>
            <button disabled={busy || !body.trim()}><LuSend /> 등록</button>
          </div>
        </form>
      )}

      <button className={styles.resolvedToggle} onClick={() => setShowResolved((value) => !value)}>
        <LuChevronDown /> {showResolved ? "해결된 댓글 숨기기" : `해결된 댓글 보기 (${comments.filter((item) => item.resolved_at && !item.parent_id).length})`}
      </button>
      {error && <div className={styles.panelError}>{error}</div>}

      <div className={styles.commentList}>
        {!roots.length && <div className={styles.panelEmpty}><LuMessageSquare /><strong>아직 댓글이 없습니다</strong><span>함께 생각할 내용을 남겨보세요.</span></div>}
        {roots.map((comment) => {
          const author = commentAuthor(comment, members);
          const replies = comments.filter((item) => item.parent_id === comment.id);
          return (
            <article key={comment.id} className={`${styles.commentCard} ${comment.resolved_at ? styles.commentResolved : ""}`}>
              <div className={styles.commentMeta}>
                <div className={styles.commentAvatar}>{author.avatar ? <img src={author.avatar} alt="" /> : initials(author.name)}</div>
                <div><strong>{author.name}</strong><span>{formatRelativeTime(comment.created_at)}</span></div>
                {!readOnly && <button className={styles.resolveButton} onClick={() => resolve(comment)} title={comment.resolved_at ? "다시 열기" : "해결로 표시"}><LuCheck /></button>}
              </div>
              {comment.quote && <button className={styles.commentQuote} onClick={() => jumpToQuote(comment)}><LuQuote /><span>{comment.quote}</span></button>}
              <p>{comment.body}</p>
              <button className={styles.replyAction} onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}><LuCornerDownRight /> 답글</button>

              {replies.map((reply) => {
                const replyAuthor = commentAuthor(reply, members);
                return (
                  <div key={reply.id} className={styles.commentReply}>
                    <div className={styles.commentAvatar}>{replyAuthor.avatar ? <img src={replyAuthor.avatar} alt="" /> : initials(replyAuthor.name)}</div>
                    <div><span><strong>{replyAuthor.name}</strong> · {formatRelativeTime(reply.created_at)}</span><p>{reply.body}</p></div>
                  </div>
                );
              })}
              {replyingTo === comment.id && !readOnly && (
                <div className={styles.replyComposer}>
                  <input value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="답글 쓰기" autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) addReply(comment.id); }} />
                  <button onClick={() => addReply(comment.id)} disabled={busy || !replyBody.trim()}><LuSend /></button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
