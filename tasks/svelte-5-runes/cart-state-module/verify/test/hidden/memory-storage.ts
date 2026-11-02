export class MemoryStorage {
  #data = new Map<string, string>()
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.#data.set(k, v)
  }
  getItem(key: string) {
    return this.#data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.#data.set(key, String(value))
  }
  removeItem(key: string) {
    this.#data.delete(key)
  }
  clear() {
    this.#data.clear()
  }
  key(i: number) {
    return [...this.#data.keys()][i] ?? null
  }
  get length() {
    return this.#data.size
  }
}

/** Plain copy, so assertions never depend on how the cart stores its lines. */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
