/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuBookOpen,
  LuChevronDown,
  LuChevronRight,
  LuCornerDownRight,
  LuEllipsis,
  LuFilePlus2,
  LuFileText,
  LuFolder,
  LuFolderInput,
  LuFolderOpen,
  LuFolderPlus,
  LuGripVertical,
  LuLogOut,
  LuPanelLeftClose,
  LuPencil,
  LuPlus,
  LuSearch,
  LuTrash2,
  LuX,
} from "react-icons/lu";
import {
  DOCUMENT_ITEM_TYPE,
  FOLDER_ITEM_TYPE,
  canMoveItem,
  isDocument,
  isFolder,
  movableParentOptions,
} from "@/lib/scenario-share/document-tree.mjs";
import { initials, profileFromUser } from "./utils";
import styles from "./ScenarioShare.module.css";

const MENU_WIDTH = 190;
const MENU_HEIGHT = 270;
const ROOT_DROP_TARGET = "root";

export function WikiSidebar({
  open,
  documents,
  selectedDocumentId,
  onSelect,
  onCreate,
  onMove,
  onDelete,
  onRename,
  onClose,
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
  const [contextMenu, setContextMenu] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [movingItemId, setMovingItemId] = useState(null);
  const [moveParentId, setMoveParentId] = useState("");
  const [draggingItemId, setDraggingItemId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const contextMenuRef = useRef(null);
  const contextMenuTriggerRef = useRef(null);
  const expandDropTimerRef = useRef(null);
  const profile = profileFromUser(user);
  const canEdit = membership.role !== "viewer";

  useEffect(() => {
    if (!contextMenu) return undefined;
    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector("button")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu]);

  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const item of documents) {
      const key = item.parent_id || "root";
      const children = map.get(key) || [];
      children.push(item);
      map.set(key, children);
    }
    for (const children of map.values()) {
      children.sort((a, b) => {
        const order = (a.sort_order || 0) - (b.sort_order || 0);
        if (order) return order;
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });
    }
    return map;
  }, [documents]);

  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko");
    if (!query) return null;
    return documents.filter((document) =>
      isDocument(document) && `${document.title || ""}\n${document.plain_text || ""}`
        .toLocaleLowerCase("ko")
        .includes(query),
    );
  }, [documents, search]);

  const movingItem = documents.find((item) => item.id === movingItemId) || null;
  const parentOptions = useMemo(
    () => movingItemId ? movableParentOptions(documents, movingItemId) : [],
    [documents, movingItemId],
  );
  const draggingItem = documents.find((item) => item.id === draggingItemId) || null;

  useEffect(() => {
    window.clearTimeout(expandDropTimerRef.current);
    if (!dropTargetId || dropTargetId === ROOT_DROP_TARGET) return undefined;
    const hasChildren = (childrenByParent.get(dropTargetId) || []).length > 0;
    if (!hasChildren || expanded.has(dropTargetId)) return undefined;

    expandDropTimerRef.current = window.setTimeout(() => {
      setExpanded((current) => new Set([...current, dropTargetId]));
    }, 650);
    return () => window.clearTimeout(expandDropTimerRef.current);
  }, [childrenByParent, dropTargetId, expanded]);

  const toggleExpanded = (itemId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const openMenu = ({ item = null, parentId = null, x, y }) => {
    if (!canEdit) return;
    const maxX = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
    const maxY = Math.max(8, window.innerHeight - MENU_HEIGHT - 8);
    setContextMenu({
      itemId: item?.id || null,
      parentId,
      x: Math.min(Math.max(8, x), maxX),
      y: Math.min(Math.max(8, y), maxY),
    });
  };

  const openRootMenu = (event) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    contextMenuTriggerRef.current = event.currentTarget.querySelector?.("button") || null;
    openMenu({ x: event.clientX, y: event.clientY, parentId: null });
  };

  const openRootMenuFromButton = (event) => {
    contextMenuTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    openMenu({ x: bounds.right - MENU_WIDTH, y: bounds.bottom + 4, parentId: null });
  };

  const openItemMenu = (event, item) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    contextMenuTriggerRef.current = event.currentTarget.querySelector?.("button[aria-label$='메뉴']") || null;
    const parentId = isFolder(item) ? item.id : item.parent_id || null;
    openMenu({ item, parentId, x: event.clientX, y: event.clientY });
  };

  const openItemMenuFromButton = (event, item) => {
    event.stopPropagation();
    contextMenuTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    const parentId = isFolder(item) ? item.id : item.parent_id || null;
    openMenu({ item, parentId, x: bounds.right - MENU_WIDTH, y: bounds.bottom + 3 });
  };

  const createItem = async (itemType) => {
    const parentId = contextMenu?.parentId || null;
    setContextMenu(null);
    setPendingId("create");
    const created = await onCreate({ parentId, itemType });
    setPendingId(null);
    if (!created) return;

    if (parentId) {
      setExpanded((current) => new Set([...current, parentId]));
    }
    if (isFolder(created)) {
      setEditingId(created.id);
      setEditingTitle(created.title || "새 폴더");
    }
  };

  const startRename = (item) => {
    setEditingId(item.id);
    setEditingTitle(item.title || (isFolder(item) ? "새 폴더" : "제목 없는 문서"));
    setContextMenu(null);
  };

  const saveRename = async (item) => {
    const fallback = isFolder(item) ? "새 폴더" : "제목 없는 문서";
    const title = editingTitle.trim() || fallback;
    setEditingId(null);
    if (title === item.title) return;
    setPendingId(item.id);
    await onRename(item, title);
    setPendingId(null);
  };

  const openMoveDialog = (item) => {
    setContextMenu(null);
    setMovingItemId(item.id);
    setMoveParentId(item.parent_id || "");
  };

  const moveItem = async () => {
    if (!movingItem) return;
    setPendingId(movingItem.id);
    const parentId = moveParentId || null;
    const moved = await onMove(movingItem.id, parentId);
    setPendingId(null);
    if (!moved) return;
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
    setMovingItemId(null);
  };

  const deleteItem = async (item) => {
    setContextMenu(null);
    setPendingId(item.id);
    await onDelete(item.id);
    setPendingId(null);
  };

  const clearDragState = () => {
    window.clearTimeout(expandDropTimerRef.current);
    setDraggingItemId(null);
    setDropTargetId(null);
  };

  const startDragging = (event, item) => {
    if (!canEdit || item.deletion_token || editingId === item.id) {
      event.preventDefault();
      return;
    }
    setDraggingItemId(item.id);
    setDropTargetId(null);
    setContextMenu(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-scenario-share-item", item.id);
    event.dataTransfer.setData("text/plain", item.id);
  };

  const previewDrop = (event, parentId) => {
    event.stopPropagation();
    if (!draggingItemId || !canMoveItem(documents, draggingItemId, parentId)) {
      event.dataTransfer.dropEffect = "none";
      setDropTargetId(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(parentId || ROOT_DROP_TARGET);
  };

  const dropItem = async (event, parentId) => {
    const itemId = draggingItemId
      || event.dataTransfer.getData("application/x-scenario-share-item");
    event.preventDefault();
    event.stopPropagation();
    if (!itemId || !canMoveItem(documents, itemId, parentId)) {
      clearDragState();
      return;
    }

    setPendingId(itemId);
    const moved = await onMove(itemId, parentId);
    setPendingId(null);
    if (moved && parentId) {
      setExpanded((current) => new Set([...current, parentId]));
    }
    clearDragState();
  };

  const dropPreview = (parentItem, depth) => draggingItem && (
    <div
      className={styles.treeDropPreview}
      style={{ "--tree-depth": depth }}
      role="status"
      aria-live="polite"
      onDragOver={(event) => previewDrop(event, parentItem?.id || null)}
      onDrop={(event) => dropItem(event, parentItem?.id || null)}
    >
      <span className={styles.treeDropPreviewGuide}><LuCornerDownRight /></span>
      <span className={styles.treeDropPreviewIcon}>
        {isFolder(draggingItem) ? <LuFolder /> : <LuFileText />}
      </span>
      <span>
        <strong>{draggingItem.title || (isFolder(draggingItem) ? "새 폴더" : "제목 없는 문서")}</strong>
        <small>{parentItem ? `“${parentItem.title}” 하위에 들어갑니다` : "문서 최상위에 들어갑니다"}</small>
      </span>
    </div>
  );

  const renderTree = (parentId = null, depth = 0) => {
    const children = childrenByParent.get(parentId || "root") || [];
    return children.map((item) => {
      const hasChildren = (childrenByParent.get(item.id) || []).length > 0;
      const isExpanded = expanded.has(item.id);
      const folder = isFolder(item);
      const deletionPending = Boolean(item.deletion_token);
      return (
        <div key={item.id} className={styles.treeBranch}>
          <div
            className={`${styles.treeRow} ${selectedDocumentId === item.id ? styles.treeRowActive : ""} ${folder ? styles.treeFolderRow : ""} ${draggingItemId === item.id ? styles.treeRowDragging : ""} ${dropTargetId === item.id ? styles.treeRowDropTarget : ""}`}
            style={{ "--tree-depth": depth }}
            onContextMenu={(event) => openItemMenu(event, item)}
            draggable={canEdit && !deletionPending && editingId !== item.id}
            onDragStart={(event) => startDragging(event, item)}
            onDragEnd={clearDragState}
            onDragOver={(event) => previewDrop(event, item.id)}
            onDrop={(event) => dropItem(event, item.id)}
          >
            <button
              className={styles.treeChevron}
              onClick={() => toggleExpanded(item.id)}
              disabled={!hasChildren}
              aria-label={isExpanded ? "하위 항목 접기" : "하위 항목 펼치기"}
            >
              {hasChildren && (isExpanded ? <LuChevronDown /> : <LuChevronRight />)}
            </button>
            {editingId === item.id ? (
              <input
                className={styles.treeRenameInput}
                value={editingTitle}
                autoFocus
                onChange={(event) => setEditingTitle(event.target.value)}
                onBlur={() => saveRename(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <button
                className={styles.treeTitle}
                onClick={() => folder ? toggleExpanded(item.id) : !deletionPending && onSelect(item.id)}
                title={deletionPending ? `${item.title} · 영구 삭제 대기 중` : item.title}
                aria-disabled={!folder && deletionPending}
              >
                <span className={styles.treeItemIcon}>
                  {folder
                    ? (isExpanded ? <LuFolderOpen /> : <LuFolder />)
                    : <LuFileText />}
                </span>
                <span className={styles.treeItemLabel}>
                  <span>{item.title || (folder ? "새 폴더" : "제목 없는 문서")}</span>
                  {deletionPending && <small>삭제 대기</small>}
                </span>
              </button>
            )}
            {canEdit && (
              <span className={styles.treeDragHandle} aria-hidden="true" title="드래그해서 이동">
                <LuGripVertical />
              </span>
            )}
            {canEdit && (
              <button
                className={styles.treeMore}
                onClick={(event) => openItemMenuFromButton(event, item)}
                aria-label={`${folder ? "폴더" : "문서"} 메뉴`}
                disabled={pendingId === item.id}
              >
                <LuEllipsis />
              </button>
            )}
          </div>
          {dropTargetId === item.id && dropPreview(item, depth + 1)}
          {hasChildren && isExpanded && renderTree(item.id, depth + 1)}
        </div>
      );
    });
  };

  const menuItem = contextMenu?.itemId
    ? documents.find((item) => item.id === contextMenu.itemId)
    : null;
  const menuItemPending = Boolean(menuItem?.deletion_token);
  const menuParentPending = Boolean(
    contextMenu?.parentId
      && documents.find((item) => item.id === contextMenu.parentId)?.deletion_token,
  );
  const canCreateAtMenu = !menuParentPending && (!menuItemPending || !isFolder(menuItem));

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
      </div>

      <div className={styles.sidebarSectionHeading} onContextMenu={openRootMenu}>
        <span>{searchResults ? `검색 결과 ${searchResults.length}` : "문서"}</span>
        {!searchResults && (canEdit ? (
          <button
            className={styles.treeCreateMenuButton}
            onClick={openRootMenuFromButton}
            aria-label="새 폴더 또는 문서 만들기"
            title="새 폴더 또는 문서 만들기"
            disabled={pendingId === "create"}
          >
            <LuPlus />
          </button>
        ) : <LuBookOpen />)}
      </div>

      <nav
        className={`${styles.documentTree} ${dropTargetId === ROOT_DROP_TARGET ? styles.documentTreeDropTarget : ""}`}
        aria-label="위키 문서"
        onContextMenu={openRootMenu}
        onDragOver={(event) => previewDrop(event, null)}
        onDrop={(event) => dropItem(event, null)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDropTargetId(null);
        }}
      >
        {searchResults ? (
          searchResults.length ? searchResults.map((document) => (
            <button
              key={document.id}
              className={`${styles.searchResult} ${selectedDocumentId === document.id ? styles.searchResultActive : ""}`}
              onClick={() => onSelect(document.id)}
              onContextMenu={(event) => openItemMenu(event, document)}
            >
              <span><LuFileText /> {document.title || "제목 없는 문서"}</span>
              {document.plain_text && <small>{document.plain_text.slice(0, 90)}</small>}
            </button>
          )) : <div className={styles.noSearchResults}><LuSearch /><p>일치하는 문서가 없습니다</p></div>
        ) : documents.length ? renderTree() : (
          <div className={styles.sidebarEmpty}>
            <LuFolderPlus />
            <span>{canEdit ? <>+ 버튼 또는 이 영역을 우클릭해<br /><strong>폴더 또는 문서 만들기</strong></> : "아직 문서가 없습니다"}</span>
          </div>
        )}
        {!searchResults && dropTargetId === ROOT_DROP_TARGET && dropPreview(null, 0)}
      </nav>

      {contextMenu && (
        <>
          <button className={styles.menuBackdrop} onClick={() => setContextMenu(null)} aria-label="메뉴 닫기" />
          <div
            ref={contextMenuRef}
            className={styles.treeContextMenu}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setContextMenu(null);
                window.requestAnimationFrame(() => contextMenuTriggerRef.current?.focus());
              }
            }}
          >
            {canCreateAtMenu && (
              <>
                <button role="menuitem" onClick={() => createItem(FOLDER_ITEM_TYPE)}><LuFolderPlus /> 새 폴더</button>
                <button role="menuitem" onClick={() => createItem(DOCUMENT_ITEM_TYPE)}><LuFilePlus2 /> 새 문서</button>
              </>
            )}
            {menuItem && (
              <>
                {!menuItemPending && <span />}
                {!menuItemPending && <button role="menuitem" onClick={() => startRename(menuItem)}><LuPencil /> 이름 바꾸기</button>}
                {!menuItemPending && <button role="menuitem" onClick={() => openMoveDialog(menuItem)}><LuFolderInput /> 위치 이동</button>}
                <span />
                <button role="menuitem" className={styles.dangerMenuItem} onClick={() => deleteItem(menuItem)}><LuTrash2 /> {menuItemPending ? "삭제 다시 시도" : "영구 삭제"}</button>
              </>
            )}
          </div>
        </>
      )}

      {movingItem && (
        <>
          <button className={styles.dialogBackdrop} onClick={() => setMovingItemId(null)} aria-label="이동 창 닫기" />
          <div className={styles.folderMoveDialog} role="dialog" aria-modal="true" aria-labelledby="move-item-title">
            <div>
              <span><LuFolderInput /></span>
              <div><strong id="move-item-title">위치 이동</strong><small>{movingItem.title}</small></div>
            </div>
            <label>
              이동할 위치
              <select value={moveParentId} onChange={(event) => setMoveParentId(event.target.value)} autoFocus>
                <option value="">문서 최상위</option>
                {parentOptions.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.itemType === FOLDER_ITEM_TYPE ? "폴더" : "문서"} · {parent.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.folderMoveActions}>
              <button onClick={() => setMovingItemId(null)}>취소</button>
              <button
                onClick={moveItem}
                disabled={pendingId === movingItem.id || (movingItem.parent_id || "") === moveParentId}
              >이동</button>
            </div>
          </div>
        </>
      )}

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
