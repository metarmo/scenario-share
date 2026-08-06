import assert from "node:assert/strict";
import test from "node:test";
import {
  canMoveItem,
  countTreeItemTypes,
  descendantsOf,
  isDocument,
  isFolder,
  isOpenableDocument,
  itemBreadcrumbs,
  movableFolderOptions,
  movableParentOptions,
  resolveDocumentAfterDeletion,
  resolveSelectedDocumentId,
} from "./document-tree.mjs";

const items = [
  { id: "legacy", title: "기존 문서", parent_id: null },
  { id: "folder-a", title: "설정집", parent_id: null, item_type: "folder" },
  { id: "folder-b", title: "인물", parent_id: "folder-a", item_type: "folder" },
  { id: "doc-a", title: "주인공", parent_id: "folder-b", item_type: "document" },
  { id: "doc-b", title: "조력자", parent_id: "folder-b", item_type: "document" },
];

test("only an explicit folder row is excluded from documents", () => {
  assert.equal(isDocument(items[0]), true);
  assert.equal(isDocument(items[3]), true);
  assert.equal(isFolder(items[1]), true);
  assert.equal(isDocument(items[1]), false);
});

test("selection restoration never opens a folder as a Yjs document", () => {
  assert.equal(
    resolveSelectedDocumentId(items, {
      currentId: "folder-a",
      rememberedId: "doc-a",
    }),
    "doc-a",
  );
  assert.equal(
    resolveSelectedDocumentId(items.slice(1, 3), {
      rememberedId: "folder-b",
    }),
    null,
  );
});

test("selection restoration skips documents frozen for permanent deletion", () => {
  const pendingItems = items.map((item) => item.id === "doc-a"
    ? { ...item, deletion_token: "deletion-token" }
    : item);
  assert.equal(isOpenableDocument(pendingItems[3]), false);
  assert.equal(
    resolveSelectedDocumentId(pendingItems, {
      currentId: "doc-a",
      rememberedId: "doc-a",
    }),
    "legacy",
  );
});

test("mixed document and folder descendants are collected once", () => {
  const ids = descendantsOf(items, "folder-a");
  assert.deepEqual(new Set(ids), new Set(["folder-a", "folder-b", "doc-a", "doc-b"]));
  assert.deepEqual(countTreeItemTypes(items, ids), { documents: 2, folders: 2 });
});

test("breadcrumbs include folders while retaining the selected document", () => {
  assert.deepEqual(
    itemBreadcrumbs(items, "doc-a").map((item) => item.id),
    ["folder-a", "folder-b", "doc-a"],
  );
});

test("move targets exclude the item and all descendant folders", () => {
  assert.deepEqual(movableFolderOptions(items, "folder-a"), []);
  assert.deepEqual(movableFolderOptions(items, "doc-a"), [
    { id: "folder-a", label: "설정집" },
    { id: "folder-b", label: "설정집 / 인물" },
  ]);
});

test("documents and folders can both be move parents without allowing cycles", () => {
  assert.deepEqual(movableParentOptions(items, "doc-b"), [
    { id: "legacy", itemType: "document", label: "기존 문서" },
    { id: "folder-a", itemType: "folder", label: "설정집" },
    { id: "folder-b", itemType: "folder", label: "설정집 / 인물" },
    { id: "doc-a", itemType: "document", label: "설정집 / 인물 / 주인공" },
  ]);
  assert.equal(canMoveItem(items, "doc-b", "doc-a"), true);
  assert.equal(canMoveItem(items, "folder-a", "doc-a"), false);
  assert.equal(canMoveItem(items, "doc-a", "folder-b"), false);
  assert.equal(canMoveItem(items, "doc-a", null), true);
});

test("items pending deletion cannot be dragged or used as a destination", () => {
  const pendingItems = items.map((item) => item.id === "doc-a"
    ? { ...item, deletion_token: "deletion-token" }
    : item);
  assert.equal(canMoveItem(pendingItems, "doc-a", null), false);
  assert.equal(canMoveItem(pendingItems, "doc-b", "doc-a"), false);
  assert.equal(
    movableParentOptions(pendingItems, "doc-b").some((option) => option.id === "doc-a"),
    false,
  );
});

test("deleting the selected subtree chooses the next, then previous document", () => {
  assert.equal(resolveDocumentAfterDeletion(items, "doc-a", ["doc-a"]), "doc-b");
  assert.equal(
    resolveDocumentAfterDeletion(items, "doc-b", ["doc-a", "doc-b"]),
    "legacy",
  );
  assert.equal(
    resolveDocumentAfterDeletion(items, "legacy", ["legacy", "doc-a", "doc-b"]),
    null,
  );
});
