export const SCENARIO_SHARE_YJS_FIELDS = Object.freeze({
  content: "content",
  metadata: "metadata",
  title: "title",
})

export const UNTITLED_DOCUMENT_TITLE = "제목 없는 문서"
export const MAX_DOCUMENT_TITLE_LENGTH = 300

const TITLE_INITIALIZED_KEY = "titleInitialized"

export function normalizeDocumentTitle(value) {
  return String(value ?? "").trim().slice(0, MAX_DOCUMENT_TITLE_LENGTH)
    || UNTITLED_DOCUMENT_TITLE
}

export function hasSharedDocumentTitle(document) {
  const metadata = document.getMap(SCENARIO_SHARE_YJS_FIELDS.metadata)
  return metadata.get(TITLE_INITIALIZED_KEY) === true
    || document.getText(SCENARIO_SHARE_YJS_FIELDS.title).length > 0
}

export function readSharedDocumentTitle(document, fallback = UNTITLED_DOCUMENT_TITLE) {
  if (!hasSharedDocumentTitle(document)) return normalizeDocumentTitle(fallback)
  return document.getText(SCENARIO_SHARE_YJS_FIELDS.title).toString()
}

/**
 * Apply only the changed span to the shared title. Keeping stable characters in
 * place lets Yjs merge edits made in different parts of the title instead of
 * treating every keystroke as a whole-field replacement.
 */
export function setSharedDocumentTitle(document, value, origin) {
  const title = document.getText(SCENARIO_SHARE_YJS_FIELDS.title)
  const metadata = document.getMap(SCENARIO_SHARE_YJS_FIELDS.metadata)
  const current = title.toString()
  const next = String(value ?? "").slice(0, MAX_DOCUMENT_TITLE_LENGTH)

  let prefixLength = 0
  const sharedLength = Math.min(current.length, next.length)
  while (
    prefixLength < sharedLength
    && current[prefixLength] === next[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < current.length - prefixLength
    && suffixLength < next.length - prefixLength
    && current[current.length - 1 - suffixLength]
      === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  document.transact(() => {
    const deleteLength = current.length - prefixLength - suffixLength
    if (deleteLength > 0) title.delete(prefixLength, deleteLength)

    const inserted = next.slice(prefixLength, next.length - suffixLength)
    if (inserted) title.insert(prefixLength, inserted)

    metadata.set(TITLE_INITIALIZED_KEY, true)
  }, origin)

  return next
}
