import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";

function state(doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

test("concurrent edits converge regardless of delivery order", () => {
  const first = new Y.Doc();
  const second = new Y.Doc();

  first.getText("body").insert(0, "SCENARIO ");
  second.getText("body").insert(0, "SHARE ");

  const firstUpdate = Y.encodeStateAsUpdate(first);
  const secondUpdate = Y.encodeStateAsUpdate(second);

  Y.applyUpdate(first, secondUpdate);
  Y.applyUpdate(second, firstUpdate);

  assert.equal(first.getText("body").toString(), second.getText("body").toString());
  assert.equal(state(first), state(second));
});

test("a snapshot plus its update tail restores the canonical document", () => {
  const source = new Y.Doc();
  const body = source.getText("body");
  body.insert(0, "세계관");

  const snapshot = Y.encodeStateAsUpdate(source);
  const snapshotVector = Y.encodeStateVector(source);

  body.insert(body.length, "과 인물 설정");
  const tail = Y.encodeStateAsUpdate(source, snapshotVector);

  const restored = new Y.Doc();
  Y.applyUpdate(restored, snapshot);
  Y.applyUpdate(restored, tail);
  Y.applyUpdate(restored, tail);

  assert.equal(restored.getText("body").toString(), "세계관과 인물 설정");
  assert.equal(state(restored), state(source));
});
