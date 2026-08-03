/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import {
  LuArchive,
  LuBookOpen,
  LuChevronDown,
  LuChevronRight,
  LuFileText,
  LuLogOut,
  LuEllipsis,
  LuPanelLeftClose,
  LuPencil,
  LuPlus,
  LuSearch,
  LuX,
} from "react-icons/lu";
import { descendantsOf, initials, profileFromUser } from "./utils";
import styles from "./ScenarioShare.module.css";

export function WikiSidebar({
  open,
  documents,
  selectedDocumentId,
  onSelect,
  onCreate,
  onDocumentsChange,
  onClose,
  supabase,
  user,
  membership,
  members,
  onMembersOpen,
  onSignOut,
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [menuId, setMenuId] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const profile = profileFromUser(user);

  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const document of documents) {
      const key = document.parent_id || "root";
      const children = map.get(key) || [];
      children.push(document);
      map.set(key, children);
    }
    for (const children of map.values()) {
      children.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    return map;
  }, [documents]);

  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko");
    if (!query) return null;
    return documents.filter((document) =>
      `${document.title || ""}\n${document.plain_text || ""}`
        .toLocaleLowerCase("ko")
        .includes(query),
    );
  }, [documents, search]);

  const toggleExpanded = (documentId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  };

  const createChild = async (parentId) => {
    setMenuId(null);
    const created = await onCreate(parentId);
    if (created) setExpanded((current) => new Set([...current, parentId]));
  };

  const startRename = (document) => {
    setEditingId(document.id);
    setEditingTitle(document.title || "");
    setMenuId(null);
  };

  const saveRename = async (document) => {
    const title = editingTitle.trim() || "제목 없는 문서";
    setEditingId(null);
    if (title === document.title) return;
    setPendingId(document.id);
    const { error } = await supabase
      .from("documents")
      .update({ title })
      .eq("id", document.id);
    setPendingId(null);
    if (!error) {
      onDocumentsChange((current) =>
        current.map((item) => item.id === document.id ? { ...item, title } : item),
      );
    }
  };

  const archiveDocument = async (document) => {
    setMenuId(null);
    const count = descendantsOf(documents, document.id).length;
    const confirmed = window.confirm(
      count > 1
        ? `“${document.title}” 문서와 하위 문서 ${count - 1}개를 보관할까요?`
        : `“${document.title}” 문서를 보관할까요?`,
    );
    if (!confirmed) return;
    const ids = descendantsOf(documents, document.id);
    setPendingId(document.id);
    const { error } = await supabase
      .from("documents")
      .update({ archived_at: new Date().toISOString() })
      .in("id", ids);
    setPendingId(null);
    if (!error) onDocumentsChange((current) => current.filter((item) => !ids.includes(item.id)));
  };

  const renderTree = (parentId = null, depth = 0) => {
    const children = childrenByParent.get(parentId || "root") || [];
    return children.map((document) => {
      const hasChildren = (childrenByParent.get(document.id) || []).length > 0;
      const isExpanded = expanded.has(document.id);
      return (
        <div key={document.id} className={styles.treeBranch}>
          <div
            className={`${styles.treeRow} ${selectedDocumentId === document.id ? styles.treeRowActive : ""}`}
            style={{ "--tree-depth": depth }}
          >
            <button
              className={styles.treeChevron}
              onClick={() => toggleExpanded(document.id)}
              disabled={!hasChildren}
              aria-label={isExpanded ? "하위 문서 접기" : "하위 문서 펼치기"}
            >
              {hasChildren ? (isExpanded ? <LuChevronDown /> : <LuChevronRight />) : <LuFileText />}
            </button>
            {editingId === document.id ? (
              <input
                className={styles.treeRenameInput}
                value={editingTitle}
                autoFocus
                onChange={(event) => setEditingTitle(event.target.value)}
                onBlur={() => saveRename(document)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button className={styles.treeTitle} onClick={() => onSelect(document.id)} title={document.title}>
                {document.icon && <span>{document.icon}</span>}
                {document.title || "제목 없는 문서"}
              </button>
            )}
            <button
              className={styles.treeMore}
              onClick={() => setMenuId((current) => current === document.id ? null : document.id)}
              aria-label="문서 메뉴"
              disabled={pendingId === document.id}
            >
              <LuEllipsis />
            </button>
            {menuId === document.id && (
              <>
                <button className={styles.menuBackdrop} onClick={() => setMenuId(null)} aria-label="메뉴 닫기" />
                <div className={styles.treeMenu}>
                  <button onClick={() => createChild(document.id)}><LuPlus /> 하위 문서</button>
                  <button onClick={() => startRename(document)}><LuPencil /> 이름 바꾸기</button>
                  <span />
                  <button className={styles.dangerMenuItem} onClick={() => archiveDocument(document)}><LuArchive /> 보관하기</button>
                </div>
              </>
            )}
          </div>
          {hasChildren && isExpanded && renderTree(document.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
      <div className={styles.sidebarHeader}>
        <div className={styles.productLogo}><span>SS</span><div><strong>ScenarioShare</strong><small>PRIVATE COLLABORATION</small></div></div>
        <button className={styles.sidebarClose} onClick={onClose} aria-label="사이드바 닫기"><LuPanelLeftClose /></button>
      </div>

      <div className={styles.sidebarActions}>
        <label className={styles.searchBox}>
          <LuSearch />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="문서 내용 검색" />
          {search && <button onClick={() => setSearch("")} aria-label="검색 지우기"><LuX /></button>}
        </label>
        <button className={styles.newDocumentButton} onClick={() => onCreate(null)}><LuPlus /> 새 문서</button>
      </div>

      <div className={styles.sidebarSectionHeading}>
        <span>{searchResults ? `검색 결과 ${searchResults.length}` : "문서"}</span>
        {!searchResults && <LuBookOpen />}
      </div>

      <nav className={styles.documentTree} aria-label="위키 문서">
        {searchResults ? (
          searchResults.length ? searchResults.map((document) => (
            <button key={document.id} className={`${styles.searchResult} ${selectedDocumentId === document.id ? styles.searchResultActive : ""}`} onClick={() => onSelect(document.id)}>
              <span><LuFileText /> {document.title || "제목 없는 문서"}</span>
              {document.plain_text && <small>{document.plain_text.slice(0, 90)}</small>}
            </button>
          )) : <div className={styles.noSearchResults}><LuSearch /><p>일치하는 문서가 없습니다</p></div>
        ) : documents.length ? renderTree() : (
          <button className={styles.sidebarEmpty} onClick={() => onCreate(null)}><LuPlus /><span>아직 문서가 없습니다<br /><strong>첫 문서 만들기</strong></span></button>
        )}
      </nav>

      <div className={styles.sidebarBottom}>
        <button className={styles.membersButton} onClick={onMembersOpen}>
          <span className={styles.sidebarAvatarStack}>
            {members.slice(0, 3).map((member) => member.avatar ? <img key={member.id} src={member.avatar} alt="" /> : <i key={member.id}>{initials(member.name)}</i>)}
          </span>
          <span><strong>구성원</strong><small>{members.length}명 · {membership.role === "owner" ? "소유자" : membership.role === "editor" ? "편집자" : "뷰어"}</small></span>
          <LuChevronRight />
        </button>
        <div className={styles.userMenu}>
          <div className={styles.userAvatar}>{profile.avatar ? <img src={profile.avatar} alt="" /> : initials(profile.name)}</div>
          <div><strong>{profile.name}</strong><small>{profile.email}</small></div>
          <button onClick={onSignOut} aria-label="로그아웃" title="로그아웃"><LuLogOut /></button>
        </div>
      </div>
    </aside>
  );
}
