export const DOCUMENT_ITEM_TYPE = "document";
export const FOLDER_ITEM_TYPE = "folder";

export function isFolder(item) {
  return item?.item_type === FOLDER_ITEM_TYPE;
}

// Rows created before folders existed do not have item_type in older mocks or
// cached payloads. Treat only an explicit folder value as non-document data.
export function isDocument(item) {
  return Boolean(item) && !isFolder(item);
}

export function isOpenableDocument(item) {
  return isDocument(item) && !item.deletion_token;
}

export function resolveSelectedDocumentId(
  items,
  { currentId = null, rememberedId = null } = {},
) {
  const selectableIds = new Set(
    items.filter(isOpenableDocument).map((item) => item.id),
  );

  if (currentId && selectableIds.has(currentId)) return currentId;
  if (rememberedId && selectableIds.has(rememberedId)) return rememberedId;
  return items.find(isOpenableDocument)?.id || null;
}

export function resolveDocumentAfterDeletion(items, currentId, deletedIds) {
  const deleted = new Set(deletedIds);
  const currentIndex = items.findIndex((item) => item.id === currentId);
  const current = items[currentIndex];
  if (current && isOpenableDocument(current) && !deleted.has(current.id)) return current.id;

  for (let index = currentIndex + 1; index < items.length; index += 1) {
    if (isOpenableDocument(items[index]) && !deleted.has(items[index].id)) {
      return items[index].id;
    }
  }

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (isOpenableDocument(items[index]) && !deleted.has(items[index].id)) {
      return items[index].id;
    }
  }

  return items.find((item) => isOpenableDocument(item) && !deleted.has(item.id))?.id || null;
}

export function itemBreadcrumbs(items, itemId) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const chain = [];
  const seen = new Set();
  let current = byId.get(itemId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }

  return chain;
}

export function descendantsOf(items, rootId) {
  const childrenByParent = new Map();
  for (const item of items) {
    const parent = item.parent_id || "root";
    const siblings = childrenByParent.get(parent) || [];
    siblings.push(item);
    childrenByParent.set(parent, siblings);
  }

  const result = [];
  const visited = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    for (const child of childrenByParent.get(id) || []) stack.push(child.id);
  }
  return result;
}

export function countTreeItemTypes(items, itemIds) {
  const included = new Set(itemIds);
  return items.reduce(
    (counts, item) => {
      if (!included.has(item.id)) return counts;
      if (isFolder(item)) counts.folders += 1;
      else counts.documents += 1;
      return counts;
    },
    { documents: 0, folders: 0 },
  );
}

export function movableFolderOptions(items, movingItemId) {
  const excludedIds = new Set(descendantsOf(items, movingItemId));
  return items
    .filter((item) => isFolder(item) && !excludedIds.has(item.id))
    .map((folder) => ({
      id: folder.id,
      label: itemBreadcrumbs(items, folder.id)
        .map((item) => item.title || (isFolder(item) ? "새 폴더" : "제목 없는 문서"))
        .join(" / "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}
