export const SCENARIO_SHARE_COLORS = [
  "#635BFF",
  "#0D9488",
  "#E85D75",
  "#D97706",
  "#2563EB",
  "#9333EA",
  "#0891B2",
  "#C2410C",
];

export function colorForUser(value = "") {
  const hash = Array.from(value).reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) | 0,
    0,
  );
  return SCENARIO_SHARE_COLORS[Math.abs(hash) % SCENARIO_SHARE_COLORS.length];
}

export function profileFromUser(user) {
  const metadata = user?.user_metadata || {};
  const email = user?.email || "";
  return {
    id: user?.id,
    name:
      metadata.full_name ||
      metadata.name ||
      metadata.display_name ||
      email.split("@")[0] ||
      "알 수 없는 사용자",
    email,
    avatar:
      metadata.avatar_url || metadata.picture || metadata.avatar || null,
    color: colorForUser(user?.id || email),
  };
}

export function initials(name = "?") {
  const chunks = name.trim().split(/\s+/).filter(Boolean);
  if (!chunks.length) return "?";
  return chunks
    .slice(0, 2)
    .map((chunk) => Array.from(chunk)[0])
    .join("")
    .toUpperCase();
}

export function formatRelativeTime(dateValue) {
  if (!dateValue) return "방금 전";
  const delta = Date.now() - new Date(dateValue).getTime();
  if (!Number.isFinite(delta) || delta < 30_000) return "방금 전";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    year: new Date(dateValue).getFullYear() !== new Date().getFullYear()
      ? "numeric"
      : undefined,
  }).format(new Date(dateValue));
}

export function documentBreadcrumbs(documents, documentId) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const chain = [];
  const seen = new Set();
  let current = byId.get(documentId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }

  return chain;
}

export function descendantsOf(documents, rootId) {
  const childrenByParent = new Map();
  for (const document of documents) {
    const parent = document.parent_id || "root";
    const siblings = childrenByParent.get(parent) || [];
    siblings.push(document);
    childrenByParent.set(parent, siblings);
  }

  const result = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || result.includes(id)) continue;
    result.push(id);
    for (const child of childrenByParent.get(id) || []) stack.push(child.id);
  }
  return result;
}

export function createDocumentSlug(title = "") {
  const ascii = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now().toString(36);
  return ascii ? `${ascii}-${suffix}` : `doc-${suffix}`;
}
