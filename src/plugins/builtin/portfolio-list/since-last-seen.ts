import { useCallback, useEffect, useRef, useState } from "react";

/** How long the pane must be out of sight before coming back recaps what moved. */
export type SinceLastSeenAfter = "off" | "30s" | "2m" | "10m";

const AFTER_MS: Record<Exclude<SinceLastSeenAfter, "off">, number> = {
  "30s": 30_000,
  "2m": 120_000,
  "10m": 600_000,
};

export function sinceLastSeenAfterMs(after: SinceLastSeenAfter): number | null {
  return after === "off" ? null : AFTER_MS[after];
}

/** How long the moves show, and the dimmed tail at its end before LAST comes back. */
const RECAP_MS = 6_000;
const RECAP_FADE_MS = 1_500;

/**
 * Each row's percent move from `before` to `after`. A row missing from either
 * side, or whose move rounds to 0.00%, is left out, so only what moved shows.
 */
export function movesSince(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): Map<string, number> {
  const moves = new Map<string, number>();
  for (const [symbol, previous] of before) {
    const current = after.get(symbol);
    if (current == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) continue;
    const percent = ((current - previous) / Math.abs(previous)) * 100;
    if (Math.abs(percent) >= 0.005) moves.set(symbol, percent);
  }
  return moves;
}

interface Departure {
  at: number;
  prices: ReadonlyMap<string, number>;
}

// By pane instance, outside React, so a pane unmounted while its layout tab is
// hidden still finds what it showed when it comes back. Nothing is persisted.
const departures = new Map<string, Departure>();

export function noteDeparture(paneKey: string, at: number, prices: ReadonlyMap<string, number>): void {
  departures.set(paneKey, { at, prices });
}

/**
 * The moves to recap when the pane comes back, or null when it was away for
 * less than `afterMs` or nothing moved. The departure is used up either way: a
 * short glance counts as having looked.
 */
export function takeReturnMoves(
  paneKey: string,
  at: number,
  prices: ReadonlyMap<string, number>,
  afterMs: number,
): Map<string, number> | null {
  const departure = departures.get(paneKey);
  departures.delete(paneKey);
  if (!departure || at - departure.at < afterMs) return null;
  const moves = movesSince(departure.prices, prices);
  return moves.size > 0 ? moves : null;
}

export interface SinceLastSeenRecap {
  moves: ReadonlyMap<string, number>;
  fading: boolean;
}

/**
 * Snapshots the prices when the pane stops being looked at and, on coming back
 * after `afterMs`, returns each row's move since then for a few seconds.
 * `dismiss` ends it early (the next key).
 */
export function useSinceLastSeen({
  paneKey,
  present,
  afterMs,
  readPrices,
}: {
  paneKey: string | undefined;
  /** The pane is focused and on screen in a focused app. */
  present: boolean;
  afterMs: number | null;
  readPrices: () => ReadonlyMap<string, number>;
}): { recap: SinceLastSeenRecap | null; dismiss: () => void } {
  const [recap, setRecap] = useState<SinceLastSeenRecap | null>(null);
  const readPricesRef = useRef(readPrices);
  readPricesRef.current = readPrices;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const dismiss = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    setRecap((current) => (current ? null : current));
  }, []);

  useEffect(() => {
    if (!paneKey || afterMs == null || !present) return;
    const moves = takeReturnMoves(paneKey, Date.now(), readPricesRef.current(), afterMs);
    if (moves) {
      setRecap({ moves, fading: false });
      timersRef.current = [
        setTimeout(() => setRecap((current) => current && { ...current, fading: true }), RECAP_MS - RECAP_FADE_MS),
        setTimeout(() => setRecap(null), RECAP_MS),
      ];
    }
    return () => {
      dismiss();
      noteDeparture(paneKey, Date.now(), readPricesRef.current());
    };
  }, [afterMs, dismiss, paneKey, present]);

  return { recap, dismiss };
}
