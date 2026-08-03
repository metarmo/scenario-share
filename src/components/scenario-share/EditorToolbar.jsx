"use client";

import { useState } from "react";
import { useEditorState } from "@tiptap/react";
import {
  LuAlignCenter,
  LuAlignLeft,
  LuAlignRight,
  LuBold,
  LuCheck,
  LuChevronDown,
  LuCircleAlert,
  LuCode,
  LuEye,
  LuHighlighter,
  LuHistory,
  LuImage,
  LuItalic,
  LuLink2,
  LuList,
  LuListOrdered,
  LuListTodo,
  LuLoaderCircle,
  LuMessageSquare,
  LuMinus,
  LuPalette,
  LuPrinter,
  LuQuote,
  LuRedo2,
  LuSave,
  LuStrikethrough,
  LuTable2,
  LuUnderline,
  LuUndo2,
  LuUnlink,
} from "react-icons/lu";
import { readEditorToolbarState } from "@/lib/scenario-share/editor-toolbar-state.mjs";
import styles from "./ScenarioShare.module.css";

function ToolButton({ active, disabled, label, children, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`${styles.toolButton} ${active ? styles.toolButtonActive : ""} ${className}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function DocumentStatus({ dirty, readOnly, saving }) {
  let label = "모든 변경 저장됨";
  let icon = <LuCheck />;
  let tone = styles.documentStatusSaved;

  if (readOnly) {
    label = "읽기 전용";
    icon = <LuEye />;
    tone = styles.documentStatusReadOnly;
  } else if (saving) {
    label = "변경사항 저장 중";
    icon = <LuLoaderCircle className={styles.spin} />;
    tone = styles.documentStatusSaving;
  } else if (dirty) {
    label = "저장되지 않은 변경";
    icon = <LuCircleAlert />;
    tone = styles.documentStatusDirty;
  }

  return (
    <div
      className={`${styles.documentStatus} ${tone}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={label}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

export function EditorToolbar({
  editor,
  readOnly,
  dirty,
  saving,
  onSave,
  onPrint,
  commentsOpen,
  versionsOpen,
  onToggleComments,
  onToggleVersions,
}) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => readEditorToolbarState(currentEditor),
  });
  if (!editor) return <div className={styles.toolbarSkeleton} />;

  const setLink = () => {
    const previous = editor.getAttributes("link").href;
    const href = window.prompt("연결할 주소를 입력하세요", previous || "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  const insertImage = () => {
    const src = window.prompt("이미지 URL을 입력하세요", "https://");
    if (!src?.trim()) return;
    const alt = window.prompt("이미지 설명(선택)", "") || "";
    editor.chain().focus().setImage({ src: src.trim(), alt }).run();
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="문서 편집 도구">
      <div className={styles.toolbarGroup}>
        <ToolButton label="실행 취소 (⌘Z)" disabled={readOnly || !toolbarState.canUndo} onClick={() => editor.chain().focus().undo().run()}><LuUndo2 /></ToolButton>
        <ToolButton label="다시 실행 (⇧⌘Z)" disabled={readOnly || !toolbarState.canRedo} onClick={() => editor.chain().focus().redo().run()}><LuRedo2 /></ToolButton>
      </div>

      <div className={`${styles.toolbarGroup} ${styles.blockSelect}`}>
        <select
          aria-label="문단 스타일"
          value={toolbarState.blockLabel}
          disabled={readOnly}
          onChange={(event) => {
            const value = event.target.value;
            const chain = editor.chain().focus();
            if (value === "본문") chain.setParagraph().run();
            if (value === "제목 1") chain.toggleHeading({ level: 1 }).run();
            if (value === "제목 2") chain.toggleHeading({ level: 2 }).run();
            if (value === "제목 3") chain.toggleHeading({ level: 3 }).run();
            if (value === "인용문") chain.toggleBlockquote().run();
          }}
        >
          <option>본문</option><option>제목 1</option><option>제목 2</option><option>제목 3</option><option>인용문</option>
        </select>
        <LuChevronDown />
      </div>

      <div className={styles.toolbarGroup}>
        <ToolButton label="굵게 (⌘B)" disabled={readOnly} active={toolbarState.bold} onClick={() => editor.chain().focus().toggleBold().run()}><LuBold /></ToolButton>
        <ToolButton label="기울임 (⌘I)" disabled={readOnly} active={toolbarState.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><LuItalic /></ToolButton>
        <ToolButton label="밑줄 (⌘U)" disabled={readOnly} active={toolbarState.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><LuUnderline /></ToolButton>
        <ToolButton label="취소선" disabled={readOnly} active={toolbarState.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><LuStrikethrough /></ToolButton>
        <ToolButton label="인라인 코드" disabled={readOnly} active={toolbarState.code} onClick={() => editor.chain().focus().toggleCode().run()}><LuCode /></ToolButton>
      </div>

      <div className={styles.toolbarGroup}>
        <label className={`${styles.colorTool} ${readOnly ? styles.colorToolDisabled : ""}`} title="글자색">
          <LuPalette />
          <input
            type="color"
            disabled={readOnly}
            value={toolbarState.color}
            onInput={(event) => editor.chain().focus().setColor(event.currentTarget.value).run()}
          />
        </label>
        <ToolButton label="강조" disabled={readOnly} active={toolbarState.highlight} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fff1a6" }).run()}><LuHighlighter /></ToolButton>
      </div>

      <div className={styles.toolbarGroup}>
        <ToolButton label="글머리 기호" disabled={readOnly} active={toolbarState.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><LuList /></ToolButton>
        <ToolButton label="번호 목록" disabled={readOnly} active={toolbarState.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><LuListOrdered /></ToolButton>
        <ToolButton label="할 일 목록" disabled={readOnly} active={toolbarState.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}><LuListTodo /></ToolButton>
        <ToolButton label="인용문" disabled={readOnly} active={toolbarState.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><LuQuote /></ToolButton>
        <ToolButton label="구분선" disabled={readOnly} onClick={() => editor.chain().focus().setHorizontalRule().run()}><LuMinus /></ToolButton>
      </div>

      <div className={styles.toolbarGroup}>
        <ToolButton label="링크" disabled={readOnly} active={toolbarState.link} onClick={setLink}><LuLink2 /></ToolButton>
        {toolbarState.link && <ToolButton label="링크 해제" disabled={readOnly} onClick={() => editor.chain().focus().unsetLink().run()}><LuUnlink /></ToolButton>}
        <ToolButton label="이미지 URL 삽입" disabled={readOnly} onClick={insertImage}><LuImage /></ToolButton>
      </div>

      <div className={`${styles.toolbarGroup} ${styles.toolbarPopoverWrap}`}>
        <ToolButton label="정렬" disabled={readOnly} active={toolbarState.centered || toolbarState.rightAligned} onClick={() => setAlignmentOpen((value) => !value)}><LuAlignLeft /><LuChevronDown /></ToolButton>
        {alignmentOpen && (
          <div className={styles.toolbarPopover}>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => { editor.chain().focus().setTextAlign("left").run(); setAlignmentOpen(false); }}><LuAlignLeft /> 왼쪽</button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => { editor.chain().focus().setTextAlign("center").run(); setAlignmentOpen(false); }}><LuAlignCenter /> 가운데</button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => { editor.chain().focus().setTextAlign("right").run(); setAlignmentOpen(false); }}><LuAlignRight /> 오른쪽</button>
          </div>
        )}
        <ToolButton label="표" disabled={readOnly} active={toolbarState.table} onClick={() => setTableMenuOpen((value) => !value)}><LuTable2 /><LuChevronDown /></ToolButton>
        {tableMenuOpen && (
          <div className={`${styles.toolbarPopover} ${styles.tablePopover}`}>
            {!toolbarState.table ? (
              <button onMouseDown={(event) => event.preventDefault()} onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setTableMenuOpen(false); }}><LuTable2 /> 3 × 3 표 삽입</button>
            ) : (
              <>
                <button onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>아래 행 추가</button>
                <button onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>오른쪽 열 추가</button>
                <button onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>현재 행 삭제</button>
                <button onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>현재 열 삭제</button>
                <button className={styles.toolbarDanger} onMouseDown={(event) => event.preventDefault()} onClick={() => { editor.chain().focus().deleteTable().run(); setTableMenuOpen(false); }}>표 삭제</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className={`${styles.toolbarGroup} ${styles.toolbarTrailing}`}>
        <ToolButton label="인쇄 (⌘P)" onClick={onPrint}><LuPrinter /></ToolButton>
        <ToolButton label="댓글" active={commentsOpen} onClick={onToggleComments}><LuMessageSquare /></ToolButton>
        <ToolButton label="버전 기록" active={versionsOpen} onClick={onToggleVersions}><LuHistory /></ToolButton>
        <DocumentStatus readOnly={readOnly} dirty={dirty} saving={saving} />
        {!readOnly && (
          <button type="button" className={`${styles.saveButton} ${dirty ? styles.saveButtonDirty : ""}`} onClick={onSave} disabled={saving}>
            <LuSave /> {saving ? "저장 중…" : dirty ? "변경 저장" : "버전 저장"}
          </button>
        )}
      </div>
    </div>
  );
}
