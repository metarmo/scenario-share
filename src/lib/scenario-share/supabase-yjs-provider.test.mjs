import assert from "node:assert/strict"
import test from "node:test"
import * as Y from "yjs"

import { bytesToBase64 } from "./base64.mjs"
import { SupabaseYjsProvider } from "./supabase-yjs-provider.js"

class SelectQuery {
  constructor(rows) {
    this.rows = rows
    this.filters = []
    this.orders = []
    this.start = 0
    this.end = Number.POSITIVE_INFINITY
    this.rowLimit = Number.POSITIVE_INFINITY
  }

  select() {
    return this
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  gt(column, value) {
    this.filters.push((row) => Number(row[column]) > Number(value))
    return this
  }

  order(column, { ascending }) {
    this.orders.push({ column, ascending })
    return this
  }

  range(start, end) {
    this.start = start
    this.end = end
    return this
  }

  limit(limit) {
    this.rowLimit = limit
    return this
  }

  async execute() {
    let result = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row)),
    )
    for (const { column, ascending } of this.orders.toReversed()) {
      result = result.toSorted((left, right) => {
        const comparison = Number(left[column]) - Number(right[column])
        return ascending ? comparison : -comparison
      })
    }
    result = result.slice(this.start, this.end + 1).slice(0, this.rowLimit)
    return { data: result, error: null }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

class FakeChannel {
  constructor(topic, options) {
    this.topic = topic
    this.options = options
    this.handlers = new Map()
    this.sent = []
    this.presence = {}
    this.trackCalls = 0
    this.untrackCalls = 0
  }

  on(type, filter, handler) {
    this.handlers.set(`${type}:${filter.event}`, handler)
    return this
  }

  subscribe(callback) {
    queueMicrotask(() => callback("SUBSCRIBED"))
    return this
  }

  async send(message) {
    this.sent.push(message)
    return "ok"
  }

  async track(payload) {
    this.trackCalls += 1
    this.presence[payload.clientId] = [payload]
    this.handlers.get("presence:sync")?.()
    return "ok"
  }

  async untrack() {
    this.untrackCalls += 1
    this.presence = {}
    return "ok"
  }

  presenceState() {
    return this.presence
  }

  receive(event, payload) {
    this.handlers.get(`broadcast:${event}`)?.({ payload })
  }
}

class FakeSupabase {
  constructor({ versions, updates, userId, insertFailures = 0 }) {
    this.versions = versions
    this.updates = updates
    this.userId = userId
    this.nextUpdateId = Math.max(0, ...updates.map((row) => row.id)) + 1
    this.createdByWasSent = false
    this.insertFailures = insertFailures
    this.channelInstance = null
    this.auth = {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
            email: "editor@example.com",
            user_metadata: { full_name: "Editor" },
          },
        },
        error: null,
      }),
      getSession: async () => ({
        data: { session: { access_token: "test-access-token" } },
        error: null,
      }),
    }
    this.realtime = {
      setAuth: async (token) => {
        this.realtimeToken = token
      },
    }
  }

  channel(topic, options) {
    this.channelInstance = new FakeChannel(topic, options)
    return this.channelInstance
  }

  from(table) {
    const rows = table === "document_versions" ? this.versions : this.updates
    return {
      select: () => new SelectQuery(rows),
      insert: async (row) => {
        this.createdByWasSent ||= Object.hasOwn(row, "created_by")
        if (this.insertFailures > 0) {
          this.insertFailures -= 1
          return {
            data: null,
            error: { code: "NETWORK", message: "temporary insert failure" },
          }
        }
        rows.push({
          id: this.nextUpdateId,
          created_by: this.userId,
          ...row,
        })
        this.nextUpdateId += 1
        return { data: null, error: null }
      },
    }
  }

  async removeChannel() {
    return "ok"
  }
}

test("provider restores checkpoint/tail, persists local diff, and exposes Tiptap API", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const documentId = "7ec4d679-4ec6-4077-bc90-57a1dbda4f72"
  const userId = "b3ef4f64-a436-4bd0-b363-d4ce0a522a15"
  const serverDocument = new Y.Doc()
  serverDocument.getText("default").insert(0, "server")
  const checkpointState = Y.encodeStateAsUpdate(serverDocument)
  const checkpointVector = Y.encodeStateVector(serverDocument)
  serverDocument.getText("default").insert(6, " tail")
  const tailUpdate = Y.encodeStateAsUpdate(serverDocument, checkpointVector)

  const supabase = new FakeSupabase({
    userId,
    versions: [
      {
        id: 2,
        document_id: documentId,
        yjs_state: bytesToBase64(checkpointState),
        last_update_id: 10,
      },
    ],
    updates: [
      {
        id: 11,
        document_id: documentId,
        yjs_update: bytesToBase64(tailUpdate),
      },
    ],
  })

  const localDocument = new Y.Doc()
  localDocument.getText("local").insert(0, "offline edit")
  const provider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: localDocument,
    disableLocalPersistence: true,
    clientId: "e9a32d90-cdfa-426f-b3ca-6ba38820b6de",
  })

  try {
    await provider.connect()

    assert.equal(provider.document, localDocument)
    assert.equal(provider.doc, localDocument)
    assert.ok(provider.awareness)
    assert.equal(provider.status, "connected")
    assert.equal(localDocument.getText("default").toString(), "server tail")
    assert.equal(localDocument.getText("local").toString(), "offline edit")
    assert.equal(supabase.channelInstance.topic, `doc:${documentId}`)
    assert.equal(supabase.channelInstance.options.config.private, true)
    assert.equal(supabase.createdByWasSent, false)

    const updateBroadcast = supabase.channelInstance.sent.find(
      (message) => message.event === "y-update",
    )
    assert.ok(updateBroadcast, "local state-vector diff should be broadcast")

    const versionState = await provider.syncForVersion()
    assert.equal(versionState.checkpointId, 12)
    assert.ok(versionState.stateBase64.length > 0)
    assert.equal(provider.collaborators[0].isSelf, true)

    const remoteDocument = new Y.Doc()
    Y.applyUpdate(remoteDocument, Y.encodeStateAsUpdate(localDocument))
    const remoteVector = Y.encodeStateVector(remoteDocument)
    remoteDocument.getText("default").insert(11, "!")
    const remoteUpdate = Y.encodeStateAsUpdate(remoteDocument, remoteVector)
    const updateCountBeforeRemoteBroadcast = supabase.updates.length
    supabase.channelInstance.receive("y-update", {
      clientId: "4428d205-c376-4d40-9fc4-03f16b55acd5",
      update: bytesToBase64(remoteUpdate),
    })
    await provider.flush()
    assert.equal(localDocument.getText("default").toString(), "server tail!")
    assert.equal(supabase.updates.length, updateCountBeforeRemoteBroadcast)
    remoteDocument.destroy()
  } finally {
    await provider.destroy()
    serverDocument.destroy()
    localDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test("failed inserts remain in the outbox and a later flush retries them", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const localDocument = new Y.Doc()
  localDocument.getText("default").insert(0, "retry me")
  const supabase = new FakeSupabase({
    userId: "4e37b9ec-3b26-43ac-b596-140320286da2",
    versions: [],
    updates: [],
    insertFailures: 1,
  })
  const provider = new SupabaseYjsProvider({
    supabase,
    documentId: "d2115406-c929-4555-b2f1-bc4b0dd05f48",
    document: localDocument,
    disableLocalPersistence: true,
  })
  const statuses = []
  provider.on("status", ({ status }) => statuses.push(status))

  try {
    await provider.connect()
    assert.equal(provider.status, "degraded")
    assert.ok(statuses.includes("degraded"))
    assert.equal(supabase.updates.length, 0)

    await provider.flush()
    assert.equal(supabase.updates.length, 1)
    assert.equal(provider.status, "connected")
    assert.equal(supabase.createdByWasSent, false)
  } finally {
    await provider.destroy()
    localDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test("provider replays an update whose identity is below the snapshot checkpoint", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const documentId = "38892190-239a-422a-856a-29e9eec961a3"
  const source = new Y.Doc()
  source.getText("default").insert(0, "base")
  const snapshot = Y.encodeStateAsUpdate(source)
  const snapshotVector = Y.encodeStateVector(source)
  source.getText("default").insert(4, " late")
  const lateLowerIdUpdate = Y.encodeStateAsUpdate(source, snapshotVector)
  const localDocument = new Y.Doc()
  const supabase = new FakeSupabase({
    userId: "1e4142f4-d617-41f4-979b-c2ea9c9871c3",
    versions: [{
      id: 4,
      document_id: documentId,
      yjs_state: bytesToBase64(snapshot),
      last_update_id: 10,
    }],
    updates: [{
      id: 9,
      document_id: documentId,
      yjs_update: bytesToBase64(lateLowerIdUpdate),
    }],
  })
  const provider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: localDocument,
    disableLocalPersistence: true,
  })

  try {
    await provider.connect()
    assert.equal(localDocument.getText("default").toString(), "base late")
  } finally {
    await provider.destroy()
    source.destroy()
    localDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test("read-only provider receives updates without publishing presence or edits", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const localDocument = new Y.Doc()
  const supabase = new FakeSupabase({
    userId: "9346a868-e3fd-4a1d-af18-b4e762f39a69",
    versions: [],
    updates: [],
  })
  const provider = new SupabaseYjsProvider({
    supabase,
    documentId: "f0185acd-6876-4494-a54c-47c60fb7ea86",
    document: localDocument,
    disableLocalPersistence: true,
    readOnly: true,
  })

  try {
    await provider.connect()
    localDocument.getText("default").insert(0, "must not persist")
    await provider.flush()
    assert.equal(supabase.updates.length, 0)
    assert.equal(supabase.channelInstance.trackCalls, 0)
    assert.equal(supabase.channelInstance.sent.length, 0)
  } finally {
    await provider.destroy()
    assert.equal(supabase.channelInstance.untrackCalls, 0)
    localDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})
