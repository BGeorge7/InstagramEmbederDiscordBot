interface CacheEntry<Value> {
  value: Value;
  expiresAt: number;
}

export class TtlCache<Value> {
  readonly #entries = new Map<string, CacheEntry<Value>>();
  readonly #inFlight = new Map<string, Promise<Value>>();

  public constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  public async getOrCreate(
    key: string,
    create: () => Promise<Value>,
  ): Promise<Value> {
    const now = Date.now();
    const cached = this.#entries.get(key);
    if (cached !== undefined && cached.expiresAt > now) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached.value;
    }

    if (cached !== undefined) this.#entries.delete(key);

    const existingPromise = this.#inFlight.get(key);
    if (existingPromise !== undefined) return existingPromise;

    const promise = create().then((value) => {
      this.#entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      this.#evictOldestEntries();
      return value;
    });

    this.#inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(key);
    }
  }

  #evictOldestEntries(): void {
    while (this.#entries.size > this.maxEntries) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.#entries.delete(oldestKey);
    }
  }
}
