export const EMPTY_EDITOR_TOOLBAR_STATE = Object.freeze({
  blockLabel: "본문",
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  color: "#24252a",
  highlight: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockquote: false,
  link: false,
  centered: false,
  rightAligned: false,
  table: false,
  canUndo: false,
  canRedo: false,
});

export function readEditorToolbarState(editor) {
  if (!editor) return EMPTY_EDITOR_TOOLBAR_STATE;

  let canUndo = false;
  let canRedo = false;
  try {
    const commands = editor.can();
    canUndo = commands.undo();
    canRedo = commands.redo();
  } catch {
    // Collaboration initializes its undo manager after the editor view mounts.
  }

  const blockLabel = editor.isActive("heading", { level: 1 })
    ? "제목 1"
    : editor.isActive("heading", { level: 2 })
      ? "제목 2"
      : editor.isActive("heading", { level: 3 })
        ? "제목 3"
        : editor.isActive("blockquote")
          ? "인용문"
          : "본문";

  return {
    blockLabel,
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    color: editor.getAttributes("textStyle").color || "#24252a",
    highlight: editor.isActive("highlight"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    blockquote: editor.isActive("blockquote"),
    link: editor.isActive("link"),
    centered: editor.isActive({ textAlign: "center" }),
    rightAligned: editor.isActive({ textAlign: "right" }),
    table: editor.isActive("table"),
    canUndo,
    canRedo,
  };
}
