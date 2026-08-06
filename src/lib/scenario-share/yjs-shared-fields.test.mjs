import assert from "node:assert/strict"
import test from "node:test"
import * as Y from "yjs"

import {
  hasSharedDocumentTitle,
  normalizeDocumentTitle,
  readSharedDocumentTitle,
  setSharedDocumentTitle,
} from "./yjs-shared-fields.mjs"

test("shared title edits in different ranges converge without overwriting", () => {
  const source = new Y.Doc()
  setSharedDocumentTitle(source, "Hello world")
  const initialState = Y.encodeStateAsUpdate(source)

  const first = new Y.Doc()
  const second = new Y.Doc()
  Y.applyUpdate(first, initialState)
  Y.applyUpdate(second, initialState)
  const firstVector = Y.encodeStateVector(first)
  const secondVector = Y.encodeStateVector(second)

  setSharedDocumentTitle(first, "Goodbye world")
  setSharedDocumentTitle(second, "Hello universe")

  const firstUpdate = Y.encodeStateAsUpdate(first, firstVector)
  const secondUpdate = Y.encodeStateAsUpdate(second, secondVector)
  Y.applyUpdate(first, secondUpdate)
  Y.applyUpdate(second, firstUpdate)

  assert.equal(readSharedDocumentTitle(first), "Goodbye universe")
  assert.equal(readSharedDocumentTitle(second), "Goodbye universe")

  source.destroy()
  first.destroy()
  second.destroy()
})

test("an intentionally empty shared title remains initialized", () => {
  const document = new Y.Doc()
  setSharedDocumentTitle(document, "Temporary")
  setSharedDocumentTitle(document, "")

  assert.equal(hasSharedDocumentTitle(document), true)
  assert.equal(readSharedDocumentTitle(document), "")
  assert.equal(normalizeDocumentTitle("   "), "제목 없는 문서")

  document.destroy()
})
