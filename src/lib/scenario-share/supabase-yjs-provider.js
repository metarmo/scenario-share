import * as Y from "yjs"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness"

import { bytesToBase64, storedBinaryToBytes } from "./base64.mjs"
import { ScenarioShareEmitter } from "./emitter.mjs"

const REMOTE_UPDATE_ORIGIN = Symbol("scenario-share:remote-update")
const DATABASE_SYNC_ORIGIN = Symbol("scenario-share:database-sync")
const REMOTE_AWARENESS_ORIGIN = Symbol("scenario-share:remote-awareness")

const DEFAULT_TABLES = Object.freeze({
  updates: "document_updates",
  versions: "document_versions",
})

const DEFAULT_COLUMNS = Object.freeze({
  documentId: "document_id",
  updateId: "id",
  updateData: "yjs_update",
  updateClientId: "client_id",
  updateClientSequence: "client_seq",
  versionId: "id",
  versionState: "yjs_state",
  versionCheckpoint: "last_update_id",
})

export const SCENARIO_SHARE_PROVIDER_STATUS = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  SYNCING: "syncing",
  CONNECTED: "connected",
  DEGRADED: "degraded",
  OFFLINE: "offline",
  ERROR: "error",
  DESTROYED: "destroyed",
})

function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function isEmptyYjsUpdate(update) {
  return update.length === 2 && update[0] === 0 && update[1] === 0
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown provider error"
  }
}

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-")
}

function colorForIdentity(identity) {
  const palette = [
    "#E85D75",
    "#7C5CFC",
    "#2B8AEB",
    "#0F9D7A",
    "#D97706",
    "#C241A3",
    "#5B6B2F",
    "#DC4A3D",
  ]
  let hash = 0
  for (const character of String(identity)) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return palette[hash % palette.length]
}

function broadcastPayload(message) {
  if (message && typeof message === "object" && "payload" in message) {
    return message.payload
  }
  return message
}

function sameDatabaseId(left, right) {
  if (left == null || right == null) return left == null && right == null
  return String(left) === String(right)
}

/**
 * Supabase-backed Yjs provider for ScenarioShare.
 *
 * The provider intentionally uses one private `doc:<uuid>` channel. Durable
 * updates live in Postgres; Broadcast is only the low-latency delivery path.
 * Presence carries the slow online roster while Yjs Awareness carries cursors,
 * selections, and editor identity.
 *
 * Tiptap Collaboration/CollaborationCaret compatibility is provided through
 * `.document`, `.doc`, and `.awareness`.
 *
 * @param {object} options
 * @param {import("@supabase/supabase-js").SupabaseClient} options.supabase
 * @param {string} options.documentId
 * @param {Y.Doc} [options.document]
 * @param {{id?: string, name?: string, email?: string, avatarUrl?: string, color?: string}} [options.user]
 * @param {string} [options.clientId]
 * @param {string} [options.persistenceName]
 * @param {boolean} [options.disableLocalPersistence]
 * @param {boolean} [options.readOnly]
 * @param {number} [options.batchDelayMs]
 * @param {number} [options.awarenessThrottleMs]
 * @param {number} [options.awarenessHeartbeatMs]
 * @param {number} [options.pageSize]
 * @param {number} [options.subscribeTimeoutMs]
 * @param {number} [options.maxBroadcastBytes]
 * @param {{updates?: string, versions?: string}} [options.tables]
 * @param {Partial<typeof DEFAULT_COLUMNS>} [options.columns]
 */
export class SupabaseYjsProvider extends ScenarioShareEmitter {
  constructor(options) {
    super()

    if (!options?.supabase) throw new Error("A Supabase client is required")
    if (!options?.documentId) throw new Error("A documentId is required")

    this.supabase = options.supabase
    this.documentId = options.documentId
    this.document = options.document ?? new Y.Doc()
    this.doc = this.document
    this.awareness = new Awareness(this.document)
    this.clientId = options.clientId ?? createUuid()

    this.tables = { ...DEFAULT_TABLES, ...options.tables }
    this.columns = { ...DEFAULT_COLUMNS, ...options.columns }
    this.persistenceName =
      options.persistenceName ?? `scenario-share:${this.documentId}`
    this.readOnly = options.readOnly ?? false
    this.disableLocalPersistence =
      options.disableLocalPersistence ?? this.readOnly
    this.batchDelayMs = clamp(options.batchDelayMs ?? 220, 150, 300)
    this.awarenessThrottleMs = Math.max(options.awarenessThrottleMs ?? 80, 16)
    this.awarenessHeartbeatMs = Math.max(
      options.awarenessHeartbeatMs ?? 15_000,
      5_000,
    )
    this.pageSize = clamp(options.pageSize ?? 500, 25, 1_000)
    this.subscribeTimeoutMs = Math.max(
      options.subscribeTimeoutMs ?? 15_000,
      1_000,
    )
    this.maxBroadcastBytes = Math.max(
      options.maxBroadcastBytes ?? 180_000,
      8_192,
    )

    this.user = { ...options.user }
    this.status = SCENARIO_SHARE_PROVIDER_STATUS.IDLE
    this.synced = false
    this.collaborators = []

    this.channel = null
    this.persistence = null
    this._channelReady = false
    this._hydrating = true
    this._destroyed = false
    this._destroying = false
    this._connectPromise = null
    this._flushPromise = null
    this._tailSyncPromise = null
    this._localUpdateBuffer = []
    this._incomingUpdateBuffer = []
    this._outbox = []
    this._clientSequence = 0
    this._retryAttempt = 0
    this._retryTimer = null
    this._batchTimer = null
    this._awarenessTimer = null
    this._awarenessHeartbeatTimer = null
    this._peerYClients = new Map()

    this._handleDocumentUpdate = this._handleDocumentUpdate.bind(this)
    this._handleAwarenessChange = this._handleAwarenessChange.bind(this)
    this.document.on("update", this._handleDocumentUpdate)
    this.awareness.on("update", this._handleAwarenessChange)

    if (this.user?.name || this.user?.color || this.user?.avatarUrl) {
      this._setLocalAwarenessIdentity()
    }
  }

  async connect() {
    if (this._destroyed || this._destroying) {
      throw new Error("Cannot connect a destroyed ScenarioShare provider")
    }
    if (this.synced && this._channelReady) return this
    if (this._connectPromise) return this._connectPromise

    this._connectPromise = this._connect()
    try {
      return await this._connectPromise
    } finally {
      this._connectPromise = null
    }
  }

  async _connect() {
    if (!isBrowserRuntime()) {
      throw new Error(
        "SupabaseYjsProvider.connect() is browser-only; create/connect it from a client component",
      )
    }

    this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.CONNECTING)

    try {
      await this._resolveAuthenticatedUser()
      this._createChannel()
      await this._subscribe()

      // Subscribe first so broadcasts arriving during IndexedDB/DB hydration are
      // buffered rather than falling into a query-subscribe race window.
      this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.SYNCING)
      await this._openLocalPersistence()
      const restored = await this._loadStableServerDocument()
      this._finishInitialMerge(restored.document)
      restored.document.destroy()

      this.synced = true
      this._hydrating = false
      this.emit("synced", true)

      if (!this.readOnly) {
        await this._trackPresence().catch((error) => {
          this._emitOperationalError("presence-track", error)
        })
        await this._sendAwarenessRequest().catch((error) => {
          this._emitOperationalError("awareness-request", error)
        })
        await this._sendLocalAwareness().catch((error) => {
          this._emitOperationalError("awareness", error)
        })
        this._startAwarenessHeartbeat()
      }

      this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.CONNECTED)
      await this.flush().catch((error) => this._scheduleRetry(error))
      return this
    } catch (error) {
      this._channelReady = false
      if (!this.synced && this.channel) {
        await this.supabase.removeChannel(this.channel).catch((removeError) => {
          this._emitOperationalError("connect-cleanup", removeError)
        })
        this.channel = null
      }
      this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.ERROR, { error })
      throw error
    }
  }

  async _resolveAuthenticatedUser() {
    const auth = this.supabase.auth
    if (!auth?.getUser) {
      throw new Error("The supplied Supabase client does not expose auth.getUser()")
    }

    const { data, error } = await auth.getUser()
    if (error) throw error
    if (!data?.user) {
      throw new Error("ScenarioShare requires an authenticated Supabase user")
    }

    const authUser = data.user
    const metadata = authUser.user_metadata ?? {}
    this.user = {
      id: authUser.id,
      email: authUser.email ?? this.user.email,
      name:
        this.user.name ??
        metadata.full_name ??
        metadata.name ??
        authUser.email ??
        "Anonymous editor",
      avatarUrl:
        this.user.avatarUrl ?? metadata.avatar_url ?? metadata.picture ?? null,
      color: this.user.color ?? colorForIdentity(authUser.id),
    }
    this._setLocalAwarenessIdentity()

    if (this.supabase.realtime?.setAuth) {
      const sessionResult = await auth.getSession()
      if (sessionResult.error) throw sessionResult.error
      const accessToken = sessionResult.data?.session?.access_token
      if (!accessToken) throw new Error("The Supabase session has no access token")
      // No explicit token: supabase-js keeps using its accessToken callback, so
      // refreshed Google sessions also refresh Realtime authorization.
      await this.supabase.realtime.setAuth()
    }
  }

  _setLocalAwarenessIdentity() {
    this.awareness.setLocalStateField("user", {
      id: this.user.id,
      name: this.user.name,
      email: this.user.email,
      avatarUrl: this.user.avatarUrl ?? null,
      color: this.user.color,
      clientId: this.clientId,
    })
  }

  _createChannel() {
    if (this.channel) return

    this.channel = this.supabase.channel(`doc:${this.documentId}`, {
      config: {
        private: true,
        broadcast: { ack: true, self: false },
        presence: { key: this.clientId },
      },
    })

    this.channel
      .on("broadcast", { event: "y-update" }, (message) => {
        this._receiveYUpdate(message)
      })
      .on("broadcast", { event: "awareness" }, (message) => {
        this._receiveAwareness(message)
      })
      .on("broadcast", { event: "awareness-request" }, (message) => {
        this._receiveAwarenessRequest(message)
      })
      .on("presence", { event: "sync" }, () => {
        this._publishCollaborators()
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        this._publishCollaborators()
        for (const presence of newPresences ?? []) {
          if (presence.clientId && presence.clientId !== this.clientId) {
            void this._sendAwarenessRequest(presence.clientId).catch((error) => {
              this._emitOperationalError("awareness-request", error)
            })
          }
        }
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        this._removeDepartedAwareness(leftPresences ?? [])
        this._publishCollaborators()
      })
  }

  async _subscribe() {
    if (!this.channel) throw new Error("Realtime channel has not been created")

    await new Promise((resolve, reject) => {
      let initialSubscriptionSettled = false

      const settleError = (status, error) => {
        this._channelReady = false
        const failure =
          error instanceof Error
            ? error
            : new Error(
                `Supabase Realtime channel ${status.toLowerCase()}: ${errorMessage(error)}`,
              )

        if (!initialSubscriptionSettled) {
          initialSubscriptionSettled = true
          reject(failure)
        } else {
          this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.OFFLINE, {
            error: failure,
          })
          this._scheduleRetry(failure)
        }
      }

      this.channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          this._channelReady = true
          if (!initialSubscriptionSettled) {
            initialSubscriptionSettled = true
            resolve()
          } else if (this.synced) {
            void this._afterReconnect()
          }
          return
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          settleError(status, error)
          return
        }

        if (status === "CLOSED" && !this._destroying && !this._destroyed) {
          settleError(status, error ?? "Channel closed")
        }
      }, this.subscribeTimeoutMs)
    })
  }

  async _afterReconnect() {
    try {
      if (!this.readOnly) {
        await this._trackPresence()
        await this._sendAwarenessRequest()
        await this._sendLocalAwareness()
      }
      await this._catchUpFromDatabase()
      await this.flush()
      this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.CONNECTED)
    } catch (error) {
      this._scheduleRetry(error)
    }
  }

  async _openLocalPersistence() {
    if (this.disableLocalPersistence) return
    if (this.persistence) {
      await this.persistence.whenSynced
      return
    }

    if (typeof globalThis.indexedDB === "undefined") {
      this._emitOperationalError(
        "indexeddb",
        new Error("IndexedDB is unavailable; continuing without local persistence"),
      )
      return
    }

    try {
      const { IndexeddbPersistence } = await import("y-indexeddb")
      this.persistence = new IndexeddbPersistence(
        this.persistenceName,
        this.document,
      )
      await this.persistence.whenSynced
    } catch (error) {
      this.persistence = null
      this._emitOperationalError("indexeddb", error)
    }
  }

  async _loadStableServerDocument() {
    let latestResult = null

    // A version insert compacts updates up to last_update_id. Verify that the
    // newest version did not change while paginating, otherwise rebuild from the
    // new checkpoint so no compacted page can be skipped.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const checkpoint = await this._fetchLatestVersion()
      const serverDocument = new Y.Doc()

      if (checkpoint?.[this.columns.versionState]) {
        Y.applyUpdate(
          serverDocument,
          storedBinaryToBytes(checkpoint[this.columns.versionState]),
          DATABASE_SYNC_ORIGIN,
        )
      }

      // PostgreSQL identity values are allocated before commit and therefore
      // are not a commit-order checkpoint. Replaying the complete append-only
      // log is safe because Yjs updates are idempotent, and prevents a late
      // lower-ID transaction from being skipped forever.
      const tail = await this._fetchUpdateTail()
      for (const row of tail.rows) {
        Y.applyUpdate(
          serverDocument,
          storedBinaryToBytes(row[this.columns.updateData]),
          DATABASE_SYNC_ORIGIN,
        )
      }

      const versionAfterPagination = await this._fetchLatestVersion()
      const checkpointVersionId = checkpoint?.[this.columns.versionId] ?? null
      const finalVersionId =
        versionAfterPagination?.[this.columns.versionId] ?? null

      latestResult = {
        document: serverDocument,
        checkpointId:
          tail.lastUpdateId ??
          checkpoint?.[this.columns.versionCheckpoint] ??
          null,
        versionId: checkpointVersionId,
      }

      if (sameDatabaseId(checkpointVersionId, finalVersionId)) {
        return latestResult
      }

      serverDocument.destroy()
    }

    latestResult?.document.destroy()
    throw new Error(
      "Document versions changed repeatedly during synchronization; retry shortly",
    )
  }

  async _fetchLatestVersion() {
    const columns = this.columns
    const { data, error } = await this.supabase
      .from(this.tables.versions)
      .select(
        [
          columns.versionId,
          columns.versionState,
          columns.versionCheckpoint,
        ].join(","),
      )
      .eq(columns.documentId, this.documentId)
      .order(columns.versionId, { ascending: false })
      .limit(1)

    if (error) throw error
    return data?.[0] ?? null
  }

  async _fetchUpdateTail() {
    const rows = []
    let offset = 0
    let lastUpdateId = null

    while (true) {
      let query = this.supabase
        .from(this.tables.updates)
        .select([this.columns.updateId, this.columns.updateData].join(","))
        .eq(this.columns.documentId, this.documentId)
        .order(this.columns.updateId, { ascending: true })
        .range(offset, offset + this.pageSize - 1)

      const { data, error } = await query
      if (error) throw error

      const page = data ?? []
      rows.push(...page)
      if (page.length > 0) {
        lastUpdateId = page[page.length - 1][this.columns.updateId]
      }
      if (page.length < this.pageSize) break
      offset += page.length
    }

    return { rows, lastUpdateId }
  }

  _finishInitialMerge(serverDocument) {
    // Broadcasts received while loading Postgres/IndexedDB are applied to the
    // temporary server doc before the state-vector merge.
    for (const update of this._incomingUpdateBuffer.splice(0)) {
      Y.applyUpdate(serverDocument, update, REMOTE_UPDATE_ORIGIN)
    }

    const serverDiff = Y.encodeStateAsUpdate(
      serverDocument,
      Y.encodeStateVector(this.document),
    )
    if (!isEmptyYjsUpdate(serverDiff)) {
      Y.applyUpdate(this.document, serverDiff, DATABASE_SYNC_ORIGIN)
    }

    const localDiff = Y.encodeStateAsUpdate(
      this.document,
      Y.encodeStateVector(serverDocument),
    )

    // The full state-vector diff supersedes local updates captured while
    // IndexedDB and Postgres were loading. Existing persisted outbox entries are
    // retained because they may already have a reserved client sequence.
    this._localUpdateBuffer = []
    if (this.readOnly) return
    if (!isEmptyYjsUpdate(localDiff)) {
      Y.applyUpdate(serverDocument, localDiff, DATABASE_SYNC_ORIGIN)
      this._localUpdateBuffer.push(localDiff)
    }
  }

  _handleDocumentUpdate(update, origin) {
    if (this.readOnly || this._destroyed || this._destroying) return
    if (
      origin === REMOTE_UPDATE_ORIGIN ||
      origin === DATABASE_SYNC_ORIGIN ||
      origin === this ||
      origin === this.persistence
    ) {
      return
    }

    this._localUpdateBuffer.push(update.slice())
    this._scheduleBatchFlush()
    this._emitPendingState()
  }

  _scheduleBatchFlush() {
    if (this._batchTimer) return
    this._batchTimer = setTimeout(() => {
      this._batchTimer = null
      void this.flush().catch((error) => this._scheduleRetry(error))
    }, this.batchDelayMs)
  }

  _moveBufferedUpdatesToOutbox() {
    if (this._localUpdateBuffer.length === 0) return

    const update = Y.mergeUpdates(this._localUpdateBuffer.splice(0))
    if (isEmptyYjsUpdate(update)) return

    this._clientSequence += 1
    this._outbox.push({
      update,
      sequence: this._clientSequence,
      persisted: false,
    })
  }

  /** Persist and broadcast all updates currently pending in this provider. */
  async flush() {
    if (this._destroyed) return
    if (this.readOnly) {
      this._localUpdateBuffer = []
      this._outbox = []
      return
    }

    if (this._batchTimer) {
      clearTimeout(this._batchTimer)
      this._batchTimer = null
    }
    this._moveBufferedUpdatesToOutbox()

    if (this._flushPromise) {
      await this._flushPromise
      if (this._localUpdateBuffer.length > 0 || this._outbox.length > 0) {
        return this.flush()
      }
      return
    }

    if (!this.synced || this._outbox.length === 0) return

    const drain = this._drainOutbox()
    this._flushPromise = drain
    try {
      await drain
    } finally {
      if (this._flushPromise === drain) this._flushPromise = null
    }

    if (this._localUpdateBuffer.length > 0) return this.flush()
  }

  async _drainOutbox() {
    while (this._outbox.length > 0) {
      const item = this._outbox[0]

      if (!item.persisted) {
        const row = {
          [this.columns.documentId]: this.documentId,
          [this.columns.updateData]: bytesToBase64(item.update),
          [this.columns.updateClientId]: this.clientId,
          [this.columns.updateClientSequence]: item.sequence,
        }
        const { error } = await this.supabase.from(this.tables.updates).insert(row)

        // An ambiguous network failure may have committed the insert. The
        // unique(document_id, client_id, client_seq) constraint makes retries
        // idempotent; a duplicate therefore counts as persisted.
        if (error && error.code !== "23505") throw error
        item.persisted = true
      }

      if (!this._channelReady) {
        throw new Error("Realtime channel is not currently subscribed")
      }

      const isOversized = item.update.byteLength > this.maxBroadcastBytes
      await this._sendBroadcast("y-update", {
        clientId: this.clientId,
        clientSeq: item.sequence,
        createdBy: this.user.id,
        ...(isOversized
          ? { reload: true }
          : { update: bytesToBase64(item.update) }),
      })

      this._outbox.shift()
      this._retryAttempt = 0
      this._emitPendingState()
    }

    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    if (this.synced && this._channelReady) {
      this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.CONNECTED)
    }
  }

  _receiveYUpdate(message) {
    try {
      const payload = broadcastPayload(message)
      if (!payload || payload.clientId === this.clientId) return

      if (payload.reload) {
        void this._catchUpFromDatabase().catch((error) => {
          this._emitOperationalError("database-catch-up", error)
        })
        return
      }

      const update = storedBinaryToBytes(payload.update)
      if (this._hydrating) {
        this._incomingUpdateBuffer.push(update)
      } else {
        Y.applyUpdate(this.document, update, REMOTE_UPDATE_ORIGIN)
      }
    } catch (error) {
      this._emitOperationalError("y-update", error)
    }
  }

  _handleAwarenessChange(changes, origin) {
    this._publishCollaborators()
    if (this.readOnly || origin === REMOTE_AWARENESS_ORIGIN || this._destroyed) return

    const localClientId = this.document.clientID
    const localChanged = [
      ...(changes.added ?? []),
      ...(changes.updated ?? []),
      ...(changes.removed ?? []),
    ].includes(localClientId)

    if (localChanged) this._scheduleAwarenessBroadcast()
  }

  _scheduleAwarenessBroadcast() {
    if (this.readOnly || this._awarenessTimer || this._destroying) return
    this._awarenessTimer = setTimeout(() => {
      this._awarenessTimer = null
      void this._sendLocalAwareness().catch((error) => {
        this._emitOperationalError("awareness", error)
      })
    }, this.awarenessThrottleMs)
  }

  async _sendLocalAwareness(extra = {}) {
    if (this.readOnly || !this._channelReady) return
    const update = encodeAwarenessUpdate(this.awareness, [this.document.clientID])
    await this._sendBroadcast("awareness", {
      senderClientId: this.clientId,
      yClientId: this.document.clientID,
      update: bytesToBase64(update),
      ...extra,
    })
  }

  _receiveAwareness(message) {
    try {
      const payload = broadcastPayload(message)
      if (!payload || payload.senderClientId === this.clientId) return

      const yClientId = Number(payload.yClientId)
      if (payload.senderClientId && Number.isFinite(yClientId)) {
        this._peerYClients.set(payload.senderClientId, yClientId)
      }
      applyAwarenessUpdate(
        this.awareness,
        storedBinaryToBytes(payload.update),
        REMOTE_AWARENESS_ORIGIN,
      )
      this._publishCollaborators()
    } catch (error) {
      this._emitOperationalError("awareness", error)
    }
  }

  async _sendAwarenessRequest(targetClientId = null) {
    if (this.readOnly || !this._channelReady) return
    await this._sendBroadcast("awareness-request", {
      senderClientId: this.clientId,
      targetClientId,
    })
  }

  _receiveAwarenessRequest(message) {
    if (this.readOnly) return
    const payload = broadcastPayload(message)
    if (!payload || payload.senderClientId === this.clientId) return
    if (payload.targetClientId && payload.targetClientId !== this.clientId) return

    void this._sendLocalAwareness({
      responseTo: payload.senderClientId,
    }).catch((error) => this._emitOperationalError("awareness", error))
  }

  _startAwarenessHeartbeat() {
    if (this.readOnly || this._awarenessHeartbeatTimer) return
    this._awarenessHeartbeatTimer = setInterval(() => {
      void this._sendLocalAwareness().catch((error) => {
        this._emitOperationalError("awareness-heartbeat", error)
      })
    }, this.awarenessHeartbeatMs)
  }

  _presencePayload() {
    return {
      documentId: this.documentId,
      clientId: this.clientId,
      yClientId: this.document.clientID,
      userId: this.user.id,
      name: this.user.name,
      email: this.user.email,
      avatarUrl: this.user.avatarUrl ?? null,
      color: this.user.color,
      onlineAt: new Date().toISOString(),
    }
  }

  async _trackPresence() {
    if (this.readOnly || !this._channelReady) return
    const response = await this.channel.track(this._presencePayload())
    if (response && response !== "ok") {
      throw new Error(`Presence track failed: ${response}`)
    }
  }

  _removeDepartedAwareness(leftPresences) {
    const yClientIds = []
    for (const presence of leftPresences) {
      const mapped = this._peerYClients.get(presence.clientId)
      const yClientId = Number(mapped ?? presence.yClientId)
      if (Number.isFinite(yClientId)) yClientIds.push(yClientId)
      if (presence.clientId) this._peerYClients.delete(presence.clientId)
    }

    if (yClientIds.length > 0) {
      removeAwarenessStates(
        this.awareness,
        yClientIds,
        REMOTE_AWARENESS_ORIGIN,
      )
    }
  }

  _publishCollaborators() {
    if (!this.channel) return

    const awarenessStates = this.awareness.getStates()
    const presenceState = this.channel.presenceState() ?? {}
    const collaborators = []

    for (const presences of Object.values(presenceState)) {
      for (const presence of presences ?? []) {
        const yClientId = Number(presence.yClientId)
        const awareness = Number.isFinite(yClientId)
          ? awarenessStates.get(yClientId) ?? null
          : null
        collaborators.push({
          clientId: presence.clientId,
          yClientId: Number.isFinite(yClientId) ? yClientId : null,
          userId: presence.userId,
          name: awareness?.user?.name ?? presence.name,
          email: awareness?.user?.email ?? presence.email,
          avatarUrl: awareness?.user?.avatarUrl ?? presence.avatarUrl ?? null,
          color: awareness?.user?.color ?? presence.color,
          cursor: awareness?.cursor ?? null,
          selection: awareness?.selection ?? null,
          awareness,
          isSelf: presence.clientId === this.clientId,
          onlineAt: presence.onlineAt,
        })
      }
    }

    collaborators.sort((left, right) => {
      if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1
      return String(left.name ?? "").localeCompare(String(right.name ?? ""))
    })

    this.collaborators = collaborators
    this.emit("collaborators", collaborators)
  }

  async _sendBroadcast(event, payload) {
    if (!this.channel || !this._channelReady) {
      throw new Error("Realtime channel is not currently subscribed")
    }

    const response = await this.channel.send({
      type: "broadcast",
      event,
      payload,
    })
    if (response && response !== "ok") {
      throw new Error(`Broadcast ${event} failed: ${response}`)
    }
  }

  async _catchUpFromDatabase() {
    if (this._tailSyncPromise) return this._tailSyncPromise

    const run = (async () => {
      const restored = await this._loadStableServerDocument()
      const serverDiff = Y.encodeStateAsUpdate(
        restored.document,
        Y.encodeStateVector(this.document),
      )
      if (!isEmptyYjsUpdate(serverDiff)) {
        Y.applyUpdate(this.document, serverDiff, DATABASE_SYNC_ORIGIN)
      }
      restored.document.destroy()
      return {
        checkpointId: restored.checkpointId,
        versionId: restored.versionId,
      }
    })()

    this._tailSyncPromise = run
    try {
      return await run
    } finally {
      if (this._tailSyncPromise === run) this._tailSyncPromise = null
    }
  }

  /**
   * Flush local edits, apply the current database tail, and capture a full Yjs
   * state for a `document_versions` row. `checkpointId` is the highest included
   * `document_updates.id` and should be written to `last_update_id`.
   */
  async syncForVersion() {
    if (!this.synced) await this.connect()

    let restored = { checkpointId: null }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.flush()
      restored = await this._catchUpFromDatabase()

      if (
        this._localUpdateBuffer.length === 0 &&
        this._outbox.length === 0 &&
        !this._flushPromise
      ) {
        break
      }
    }

    return {
      stateBase64: bytesToBase64(Y.encodeStateAsUpdate(this.document)),
      checkpointId: restored.checkpointId,
    }
  }

  _scheduleRetry(error) {
    if (this._destroyed || this._destroying || this._retryTimer) return

    const baseDelay = Math.min(30_000, 500 * 2 ** this._retryAttempt)
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4))
    this._retryAttempt += 1
    this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.DEGRADED, {
      error,
      retryInMs: delay,
    })

    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      void this.flush().catch((retryError) => this._scheduleRetry(retryError))
    }, delay)
  }

  _emitPendingState() {
    this.emit("pending", {
      documentId: this.documentId,
      bufferedUpdates: this._localUpdateBuffer.length,
      outboxEntries: this._outbox.length,
    })
  }

  _emitOperationalError(operation, error) {
    this.emit("error", { operation, error, message: errorMessage(error) })
  }

  _setStatus(status, details = {}) {
    this.status = status
    this.emit("status", {
      status,
      documentId: this.documentId,
      synced: this.synced,
      pendingUpdates: this._localUpdateBuffer.length + this._outbox.length,
      ...details,
    })
  }

  /** Flush pending edits and tear down Realtime, Awareness, and IndexedDB. */
  async destroy() {
    if (this._destroyed || this._destroying) return
    this._destroying = true

    if (this._batchTimer) clearTimeout(this._batchTimer)
    if (this._retryTimer) clearTimeout(this._retryTimer)
    if (this._awarenessTimer) clearTimeout(this._awarenessTimer)
    if (this._awarenessHeartbeatTimer) {
      clearInterval(this._awarenessHeartbeatTimer)
    }

    try {
      await this.flush()
    } catch (error) {
      // The Y.Doc remains in y-indexeddb, so an offline close is recovered by a
      // state-vector diff on the next provider session.
      this._emitOperationalError("destroy-flush", error)
    }

    if (!this.readOnly && this.channel && this._channelReady) {
      try {
        removeAwarenessStates(
          this.awareness,
          [this.document.clientID],
          "scenario-share:destroy",
        )
        await this._sendLocalAwareness({ leaving: true })
        await this.channel.untrack()
      } catch (error) {
        this._emitOperationalError("destroy-presence", error)
      }
    }

    this._channelReady = false
    if (this.channel) {
      await this.supabase.removeChannel(this.channel).catch((error) => {
        this._emitOperationalError("remove-channel", error)
      })
      this.channel = null
    }

    if (this.persistence) {
      await Promise.resolve(this.persistence.destroy()).catch((error) => {
        this._emitOperationalError("indexeddb-destroy", error)
      })
      this.persistence = null
    }

    this.document.off("update", this._handleDocumentUpdate)
    this.awareness.off("update", this._handleAwarenessChange)
    this.awareness.destroy()

    this.synced = false
    this._destroyed = true
    this._destroying = false
    this._setStatus(SCENARIO_SHARE_PROVIDER_STATUS.DESTROYED)
    this.emit("destroy", undefined)
    this.removeAllListeners()
  }
}

export function createSupabaseYjsProvider(options) {
  return new SupabaseYjsProvider(options)
}
