export class ScenarioShareEmitter {
  #listeners = new Map()

  on(event, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Event listener must be a function")
    }

    const listeners = this.#listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(event, listeners)

    return () => this.off(event, listener)
  }

  off(event, listener) {
    const listeners = this.#listeners.get(event)
    if (!listeners) return this

    listeners.delete(listener)
    if (listeners.size === 0) this.#listeners.delete(event)
    return this
  }

  emit(event, payload) {
    const listeners = this.#listeners.get(event)
    if (!listeners) return false

    for (const listener of [...listeners]) listener(payload)
    return true
  }

  removeAllListeners() {
    this.#listeners.clear()
  }
}
