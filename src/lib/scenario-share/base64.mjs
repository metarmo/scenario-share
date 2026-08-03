const BYTEA_PREFIX = "\\x"
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

  throw new TypeError("Expected a Uint8Array, ArrayBuffer, or ArrayBuffer view")
}
/**
 * Encode binary Yjs data without relying on a browser-only global.
 *
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} value
 */
export function bytesToBase64(value) {
  const bytes = asUint8Array(value)

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
      "base64",
    )
  }

  if (typeof btoa !== "function") {
    throw new Error("No base64 encoder is available in this runtime")
  }

  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

/**
 * Decode standard or URL-safe base64 into bytes.
 *
 * @param {string} value
 */
export function base64ToBytes(value) {
  if (typeof value !== "string") {
    throw new TypeError("Expected a base64 string")
  }

  let normalized = value
    .trim()
    .replace(/^data:[^;,]+;base64,/i, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")

  const padding = normalized.length % 4
  if (padding) normalized += "=".repeat(4 - padding)

  if (normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw new Error("Invalid base64 data")
  }

  if (typeof Buffer !== "undefined") {
    const decoded = Buffer.from(normalized, "base64")
    return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
  }

  if (typeof atob !== "function") {
    throw new Error("No base64 decoder is available in this runtime")
  }

  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/**
 * Supabase returns `bytea` as a `\\x...` hex string and text columns unchanged.
 * This helper accepts either representation so deployments may choose text or
 * bytea storage without changing the provider.
 *
 * @param {string | number[] | Uint8Array | ArrayBuffer} value
 */
export function storedBinaryToBytes(value) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return asUint8Array(value)
  }

  if (Array.isArray(value)) return Uint8Array.from(value)

  if (typeof value !== "string") {
    throw new TypeError("Stored Yjs data must be base64, bytea hex, or bytes")
  }

  if (!value.startsWith(BYTEA_PREFIX)) return base64ToBytes(value)

  const hex = value.slice(BYTEA_PREFIX.length)
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("Invalid PostgreSQL bytea hex data")
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16)
  }
  return bytes
}
