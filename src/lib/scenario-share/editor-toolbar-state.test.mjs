import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import * as Y from "yjs";

import { readEditorToolbarState } from "./editor-toolbar-state.mjs";

function createEditor() {
  const document = new Y.Doc();
  const editor = new Editor({
    element: null,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    extensions: [
      StarterKit.configure({
        history: false,
        undoRedo: false,
        link: false,
        underline: false,
      }),
      Collaboration.configure({ document, field: "content" }),
      Underline,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
    ],
  });

  return { document, editor };
}

test("toolbar state follows bold, italic, color, and heading transactions", () => {
  const { document, editor } = createEditor();

  try {
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "서식 확인" }],
        },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });

    assert.equal(editor.chain().toggleBold().toggleItalic().setColor("#c026d3").run(), true);

    const markedState = readEditorToolbarState(editor);
    assert.equal(markedState.bold, true);
    assert.equal(markedState.italic, true);
    assert.equal(markedState.color, "#c026d3");
    assert.deepEqual(
      editor.getJSON().content[0].content[0].marks.map((mark) => mark.type).sort(),
      ["bold", "italic", "textStyle"],
    );

    assert.equal(editor.chain().toggleHeading({ level: 2 }).run(), true);
    assert.equal(readEditorToolbarState(editor).blockLabel, "제목 2");
  } finally {
    editor.destroy();
    document.destroy();
  }
});
