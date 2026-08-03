import assert from "node:assert/strict"
import test from "node:test"

import {
  base64ToBytes,
  bytesToBase64,
  storedBinaryToBytes,
} from "./base64.mjs"

test("base64 utilities round-trip bytes, including a large payload", () => {
  const input = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251)
  assert.deepEqual(base64ToBytes(bytesToBase64(input)), input)
})

test("base64 decoder accepts URL-safe unpadded input", () => {
  assert.deepEqual(base64ToBytes("-_8"), Uint8Array.of(251, 255))
})

test("stored binary decoder accepts PostgreSQL bytea hex", () => {
  assert.deepEqual(storedBinaryToBytes("\\x00ff10"), Uint8Array.of(0, 255, 16))
})

test("malformed bytea and base64 values are rejected", () => {
  assert.throws(() => storedBinaryToBytes("\\x0"), /Invalid PostgreSQL/)
  assert.throws(() => base64ToBytes("not base64!"), /Invalid base64/)
})
