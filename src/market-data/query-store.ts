import type { QueryEntry } from "./result-types";
import { createIdleEntry } from "./result-types";

/** How many entries a store keeps once nothing is watching them. */
export interface QueryStoreRetention {
  /**
   * Entries to keep once nothing on screen is watching them. Browsing a ticker
   * adds an entry to every store its panes touch, and nothing used to remove
   * one, so a session that researched a few hundred symbols held every price
   * history, statement set and filing it had ever shown until exit (#452).
   */
  maxRetainedEntries?: number;
  /** True while a mounted pane is subscribed to this key, so it must be kept. */
  isWatched?: (key: string) => boolean;
  /** Called for each evicted key, for anything derived from it and keyed alike. */
  onEvict?: (key: string) => void;
}

export interface QueryStoreOptions<T> extends QueryStoreRetention {
  /**
   * Sees every entry before it is stored, so a store can overlay a newer
   * source (a streamed FX rate over a loaded one) on whatever writes it.
   */
  project?: (key: string, entry: QueryEntry<T>) => QueryEntry<T>;
}

export class QueryStore<T> {
  private readonly entries = new Map<string, QueryEntry<T>>();

  constructor(
    private readonly onChange: (key: string) => void,
    private readonly options: QueryStoreOptions<T> = {},
  ) {}

  get(key: string): QueryEntry<T> {
    return this.entries.get(key) ?? createIdleEntry<T>();
  }

  set(key: string, entry: QueryEntry<T>): void {
    this.store(key, entry);
    this.onChange(key);
  }

  update(key: string, updater: (current: QueryEntry<T>) => QueryEntry<T>): QueryEntry<T> {
    const next = this.store(key, updater(this.get(key)));
    this.onChange(key);
    return next;
  }

  /**
   * Only a new key can push the store over its ceiling, so only a new key
   * runs the eviction scan. Streamed updates rewrite existing keys many times
   * a second and skip it.
   */
  private store(key: string, entry: QueryEntry<T>): QueryEntry<T> {
    const next = this.options.project ? this.options.project(key, entry) : entry;
    const added = !this.entries.has(key);
    this.entries.set(key, next);
    if (added) this.evictUnwatched();
    return next;
  }

  /** Entries held right now. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drop the oldest entries no pane is watching. A watched key is never
   * evicted, so this cannot blank a visible pane; an evicted key returns to
   * idle and refetches the next time something asks for it.
   *
   * ponytail: oldest-first over insertion order rather than true LRU. Reading
   * an entry does not renew it, so a key held open only by a long read with no
   * subscription can still age out and refetch. Move to touch-on-read if that
   * refetch ever shows up in a profile.
   */
  private evictUnwatched(): void {
    const limit = this.options.maxRetainedEntries;
    if (limit === undefined || this.entries.size <= limit) return;
    const isWatched = this.options.isWatched;
    for (const key of [...this.entries.keys()]) {
      if (this.entries.size <= limit) return;
      if (isWatched?.(key)) continue;
      this.entries.delete(key);
      this.options.onEvict?.(key);
    }
  }
}
