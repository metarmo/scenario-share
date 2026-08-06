import assert from "node:assert/strict"
import test from "node:test"
import * as Y from "yjs"

import { bytesToBase64 } from "./base64.mjs"
import { SupabaseYjsProvider } from "./supabase-yjs-provider.js"
import { readSharedDocumentTitle } from "./yjs-shared-fields.mjs"

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

class InsertQuery {
  constructor(execute) {
    this.executeInsert = execute
  }

  select() {
    return this
  }

  async single() {
    return this.executeInsert()
  }

  then(resolve, reject) {
    return this.executeInsert().then(resolve, reject)
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

class StrictRealtimeChannel extends FakeChannel {
  constructor(topic, options) {
    super(topic, options)
    this.subscribed = false
  }

  on(type, filter, handler) {
    if (this.subscribed && type === "presence") {
      throw new Error(
        `cannot add \`${type}\` callbacks for realtime:${this.topic} after \`subscribe()\`.`,
      )
    }
    return super.on(type, filter, handler)
  }

  subscribe(callback) {
    this.subscribed = true
    return super.subscribe(callback)
  }
}

class FakeSupabase {
  constructor({
    versions,
    updates,
    userId,
    insertFailures = 0,
    syncRpc = false,
    rpcDelayMs = 0,
  }) {
    this.versions = versions
    this.updates = updates
    this.userId = userId
    this.nextUpdateId = Math.max(0, ...updates.map((row) => row.id)) + 1
    this.createdByWasSent = false
    this.insertFailures = insertFailures
    this.rpcDelayMs = rpcDelayMs
    this.rpcCalls = []
    this.syncSnapshot = null
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
    if (syncRpc) this.rpc = this._rpc.bind(this)
  }

  async _rpc(name, args) {
    this.rpcCalls.push({ name, args })
    if (this.rpcDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.rpcDelayMs))
    }

    if (name === "load_document_sync") {
      const version = this.versions
        .filter((row) => row.document_id === args.p_document_id)
        .toSorted((left, right) => right.id - left.id)[0]
      const updates = this.updates
        .filter((row) => row.document_id === args.p_document_id)
        .toSorted((left, right) => left.id - right.id)
      return {
        data: {
          snapshot_state: this.syncSnapshot?.yjs_state ?? version?.yjs_state ?? null,
          snapshot_generation: this.syncSnapshot?.generation ?? 0,
          source_version_id: this.syncSnapshot ? null : version?.id ?? null,
          checkpoint_id: updates.at(-1)?.id ?? null,
          updates: updates.map((row) => ({
            id: row.id,
            yjs_update: row.yjs_update,
          })),
        },
        error: null,
      }
    }

    if (name === "compact_document_sync") {
      const currentGeneration = this.syncSnapshot?.generation ?? 0
      if (currentGeneration !== args.p_expected_generation) {
        return {
          data: {
            status: "stale",
            snapshot_generation: currentGeneration,
            compacted_count: 0,
          },
          error: null,
        }
      }

      const requested = new Set(args.p_update_ids.map(String))
      const matched = this.updates.filter(
        (row) =>
          row.document_id === args.p_document_id && requested.has(String(row.id)),
      )
      if (matched.length !== requested.size) {
        return {
          data: {
            status: "updates_changed",
            snapshot_generation: currentGeneration,
            compacted_count: 0,
          },
          error: null,
        }
      }

      this.syncSnapshot = {
        document_id: args.p_document_id,
        yjs_state: args.p_yjs_state,
        generation: currentGeneration + 1,
      }
      this.updates = this.updates.filter(
        (row) =>
          row.document_id !== args.p_document_id || !requested.has(String(row.id)),
      )
      return {
        data: {
          status: "compacted",
          snapshot_generation: currentGeneration + 1,
          compacted_count: matched.length,
        },
        error: null,
      }
    }

    return {
      data: null,
      error: { code: "PGRST202", message: `Unknown RPC: ${name}` },
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
      insert: (row) =>
        new InsertQuery(async () => {
          this.createdByWasSent ||= Object.hasOwn(row, "created_by")
          if (this.insertFailures > 0) {
            this.insertFailures -= 1
            return {
              data: null,
              error: { code: "NETWORK", message: "temporary insert failure" },
            }
          }
          const duplicate = rows.find(
            (existing) =>
              existing.document_id === row.document_id
              && existing.client_id === row.client_id
              && existing.client_seq === row.client_seq,
          )
          if (duplicate) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate update identity" },
            }
          }
          const inserted = {
            id: this.nextUpdateId,
            created_by: this.userId,
            ...row,
          }
          rows.push(inserted)
          this.nextUpdateId += 1
          return { data: inserted, error: null }
        }),
    }
  }

  async removeChannel() {
    return "ok"
  }
}

class ReusingChannelSupabase extends FakeSupabase {
  constructor(options) {
    super(options)
    this.channels = []
    this.removeDelayMs = options.removeDelayMs ?? 0
  }

  channel(topic, options) {
    const existing = this.channels.find((channel) => channel.topic === topic)
    if (existing) return existing

    const channel = new StrictRealtimeChannel(topic, options)
    this.channels.push(channel)
    this.channelInstance = channel
    return channel
  }

  getChannels() {
    return [...this.channels]
  }

  async removeChannel(channel) {
    if (this.removeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.removeDelayMs))
    }
    this.channels = this.channels.filter((candidate) => candidate !== channel)
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
    assert.equal(updateBroadcast.payload.updateId, 12)

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

test("replacement provider waits for the subscribed document channel to be removed", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const documentId = "1c8fe985-4e70-4afa-ba9f-e76e56de154e"
  const supabase = new ReusingChannelSupabase({
    userId: "09fa83f3-56a9-49bb-901c-39320f199dbf",
    versions: [],
    updates: [],
    removeDelayMs: 25,
  })
  const firstDocument = new Y.Doc()
  const secondDocument = new Y.Doc()
  const firstProvider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: firstDocument,
    disableLocalPersistence: true,
  })
  const secondProvider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: secondDocument,
    disableLocalPersistence: true,
  })

  try {
    await firstProvider.connect()
    const firstChannel = firstProvider.channel
    const firstDestroy = firstProvider.destroy()

    await secondProvider.connect()
    await firstDestroy

    assert.equal(secondProvider.status, "connected")
    assert.notEqual(secondProvider.channel, firstChannel)
    assert.deepEqual(supabase.getChannels(), [secondProvider.channel])
  } finally {
    await firstProvider.destroy()
    await secondProvider.destroy()
    firstDocument.destroy()
    secondDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test("provider migrates a legacy database title into one durable Yjs field", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const documentId = "f5d8a11d-0aaa-4a2c-b43e-04c6dc754e5b"
  const supabase = new FakeSupabase({
    userId: "ab6a250b-9e27-4b13-9cfb-2e53bd0ddfd0",
    versions: [],
    updates: [],
  })
  const firstDocument = new Y.Doc()
  const firstProvider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: firstDocument,
    initialTitle: "Legacy title",
    disableLocalPersistence: true,
  })

  try {
    await firstProvider.connect()
    assert.equal(readSharedDocumentTitle(firstDocument), "Legacy title")
    assert.equal(supabase.updates.length, 1)
    assert.equal(supabase.updates[0].client_id, documentId)
    assert.equal(supabase.updates[0].client_seq, 0)
    assert.ok(
      supabase.channelInstance.sent.some((message) => message.event === "y-update"),
    )

    await firstProvider.destroy()

    const secondDocument = new Y.Doc()
    const secondProvider = new SupabaseYjsProvider({
      supabase,
      documentId,
      document: secondDocument,
      initialTitle: "A stale fallback must not overwrite Yjs",
      disableLocalPersistence: true,
    })
    try {
      await secondProvider.connect()
      assert.equal(readSharedDocumentTitle(secondDocument), "Legacy title")
      assert.equal(supabase.updates.length, 1)
    } finally {
      await secondProvider.destroy()
      secondDocument.destroy()
    }
  } finally {
    await firstProvider.destroy()
    firstDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test("competing legacy title initializers reuse the single winning update", async () => {
  const documentId = "b0df4851-8cdf-479f-80e9-128dbad2cc3c"
  const supabase = new FakeSupabase({
    userId: "37bdd6a9-d516-4539-a886-1efb9c572101",
    versions: [],
    updates: [],
  })
  const firstDocument = new Y.Doc()
  const secondDocument = new Y.Doc()
  const firstServerDocument = new Y.Doc()
  const secondServerDocument = new Y.Doc()
  const firstProvider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: firstDocument,
    initialTitle: "Canonical title",
    disableLocalPersistence: true,
  })
  const secondProvider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: secondDocument,
    initialTitle: "Stale title",
    disableLocalPersistence: true,
  })

  try {
    await Promise.all([
      firstProvider._initializeSharedTitle(firstServerDocument),
      secondProvider._initializeSharedTitle(secondServerDocument),
    ])

    assert.equal(supabase.updates.length, 1)
    assert.equal(readSharedDocumentTitle(firstServerDocument), "Canonical title")
    assert.equal(readSharedDocumentTitle(secondServerDocument), "Canonical title")
  } finally {
    await firstProvider.destroy()
    await secondProvider.destroy()
    firstDocument.destroy()
    secondDocument.destroy()
    firstServerDocument.destroy()
    secondServerDocument.destroy()
  }
})

test("provider exposes a cached local document before the server sync finishes", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const documentId = "e0f0f808-b6c3-4549-9fe3-6b6777174ba7"
  const localDocument = new Y.Doc()
  localDocument.getText("default").insert(0, "cached")
  const supabase = new FakeSupabase({
    userId: "14dc4729-b4f3-42f3-857f-5b994442b99a",
    versions: [],
    updates: [],
    syncRpc: true,
    rpcDelayMs: 30,
  })
  const provider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: localDocument,
    disableLocalPersistence: true,
  })
  const events = []
  provider.on("local-ready", ({ hasLocalState }) => {
    events.push({ type: "local", hasLocalState, synced: provider.synced })
  })
  provider.on("synced", () => events.push({ type: "server" }))

  try {
    await provider.connect()
    assert.deepEqual(events[0], {
      type: "local",
      hasLocalState: true,
      synced: false,
    })
    assert.equal(events[1].type, "server")
    assert.equal(localDocument.getText("default").toString(), "cached")
  } finally {
    await provider.destroy()
    localDocument.destroy()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})

test("single sync RPC restores and atomically compacts an exact update tail", async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = {}
  globalThis.document = {}

  const documentId = "bda8b3c6-e490-421c-9c79-59ab953c6936"
  const source = new Y.Doc()
  source.getText("default").insert(0, "base")
  const snapshot = Y.encodeStateAsUpdate(source)
  const updates = []
  for (let index = 0; index < 25; index += 1) {
    const before = Y.encodeStateVector(source)
    source.getText("default").insert(source.getText("default").length, ".")
    updates.push({
      id: index + 10,
      document_id: documentId,
      yjs_update: bytesToBase64(Y.encodeStateAsUpdate(source, before)),
    })
  }

  const supabase = new FakeSupabase({
    userId: "9b352bc9-eaa9-4400-b2b7-53e325940ed8",
    versions: [{
      id: 3,
      document_id: documentId,
      yjs_state: bytesToBase64(snapshot),
      last_update_id: 9,
    }],
    updates,
    syncRpc: true,
  })
  const firstDocument = new Y.Doc()
  const firstProvider = new SupabaseYjsProvider({
    supabase,
    documentId,
    document: firstDocument,
    disableLocalPersistence: true,
    compactionThreshold: 25,
    compactionDelayMs: 250,
  })
  const automaticCompaction = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("automatic compaction did not run")),
      2_000,
    )
    firstProvider.on("compacted", (event) => {
      clearTimeout(timeout)
      resolve(event)
    })
  })

  try {
    await firstProvider.connect()
    assert.deepEqual(
      supabase.rpcCalls.map((call) => call.name),
      ["load_document_sync"],
    )
    assert.equal(
      firstDocument.getText("default").toString(),
      source.getText("default").toString(),
    )

    const result = await automaticCompaction
    assert.equal(result.compactedUpdates, 25)
    assert.equal(result.snapshotGeneration, 1)
    assert.equal(supabase.updates.length, 0)
    assert.equal(supabase.syncSnapshot.generation, 1)

    await firstProvider.destroy()

    const secondDocument = new Y.Doc()
    const secondProvider = new SupabaseYjsProvider({
      supabase,
      documentId,
      document: secondDocument,
      disableLocalPersistence: true,
    })
    try {
      await secondProvider.connect()
      assert.equal(
        secondDocument.getText("default").toString(),
        source.getText("default").toString(),
      )
      assert.equal(
        supabase.rpcCalls.filter((call) => call.name === "load_document_sync").length,
        2,
      )
    } finally {
      await secondProvider.destroy()
      secondDocument.destroy()
    }
  } finally {
    await firstProvider.destroy()
    source.destroy()
    firstDocument.destroy()
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
