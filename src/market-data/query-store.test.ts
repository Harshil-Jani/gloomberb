import { describe, expect, it } from "bun:test";
import { QueryStore } from "./query-store";
import type { QueryEntry } from "./result-types";

function ready(value: string): QueryEntry<string> {
  return {
    phase: "ready",
    data: value,
    lastGoodData: value,
    source: "test",
    fetchedAt: 0,
    staleAt: null,
    error: null,
    attempts: [],
  };
}

describe("QueryStore retention", () => {
  it("keeps every entry when no ceiling is configured", () => {
    const store = new QueryStore<string>(() => {});
    for (let index = 0; index < 500; index += 1) store.set(`k${index}`, ready(`v${index}`));
    expect(store.size).toBe(500);
  });

  it("drops the oldest unwatched entries once past the ceiling", () => {
    const store = new QueryStore<string>(() => {}, { maxRetainedEntries: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) store.set(key, ready(key));

    expect(store.size).toBe(3);
    expect(store.get("a").phase).toBe("idle");
    expect(store.get("b").phase).toBe("idle");
    expect(store.get("e").data).toBe("e");
  });

  it("never evicts a key a pane is watching, even past the ceiling", () => {
    const watched = new Set(["a", "b", "c", "d"]);
    const store = new QueryStore<string>(() => {}, {
      maxRetainedEntries: 2,
      isWatched: (key) => watched.has(key),
    });
    for (const key of ["a", "b", "c", "d"]) store.set(key, ready(key));

    // Four visible panes outrank a ceiling of two: blanking one would be worse
    // than holding the memory.
    expect(store.size).toBe(4);

    // Once they unmount, the next write collects them.
    watched.clear();
    store.set("e", ready("e"));
    expect(store.size).toBe(2);
    expect(store.get("e").data).toBe("e");
  });

  it("evicts around watched keys rather than stopping at the first one", () => {
    const store = new QueryStore<string>(() => {}, {
      maxRetainedEntries: 2,
      isWatched: (key) => key === "a",
    });
    for (const key of ["a", "b", "c", "d"]) store.set(key, ready(key));

    expect(store.size).toBe(2);
    expect(store.get("a").data).toBe("a");
    expect(store.get("d").data).toBe("d");
  });

  it("reports every evicted key so derived caches can drop it too", () => {
    const evicted: string[] = [];
    const store = new QueryStore<string>(() => {}, {
      maxRetainedEntries: 2,
      onEvict: (key) => evicted.push(key),
    });
    for (const key of ["a", "b", "c", "d"]) store.set(key, ready(key));

    expect(evicted).toEqual(["a", "b"]);
  });

  it("returns an evicted key to idle so the next read refetches", () => {
    const store = new QueryStore<string>(() => {}, { maxRetainedEntries: 1 });
    store.set("a", ready("a"));
    store.set("b", ready("b"));

    const evicted = store.get("a");
    expect(evicted.phase).toBe("idle");
    expect(evicted.data).toBeNull();
    expect(evicted.lastGoodData).toBeNull();
  });
});
