import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { AppState } from "../../core/state/app/state";
import { findPaneInstance } from "../../types/config";
import { AppContext, useOptionalAppSelector, useOptionalPaneInstanceId } from "./context";

/**
 * The time the pointer or keyboard cursor is at on one chart of a layout tab,
 * which the tab's other charts show at the same moment: the last instant the
 * cursor covers, so a chart reads its data as of then. It is held per tab, in
 * memory only: a cursor moves on every pointer event, and the app store would
 * re-run every pane's selectors on each one.
 */
interface TabCursor {
  time: number;
  /** The chart the cursor is on; it never follows its own time back. */
  sourceId: string;
}

const cursors = new Map<string, TabCursor>();
/**
 * A pinned cursor belongs to no chart: every chart in the tab follows it, the
 * one it was pinned from too, and no pointer leaving a chart takes it away.
 */
const PINNED = "\u0000pinned";
/** How many charts in each tab are mounted to show its pin; see `useTabCursorLink`. */
const pinViewers = new Map<string, number>();
const listeners = new Set<() => void>();

/** A time a Date can hold. A pin is never NaN, infinite or past the Date range, whatever asks for it. */
function isMoment(time: number): boolean {
  return Number.isFinite(time) && Math.abs(time) <= 8.64e15;
}

function setTabCursorTime(tabKey: string, sourceId: string | null, time: number | null): void {
  const current = cursors.get(tabKey);
  if (time === null) {
    // Only the chart the cursor is on can take it away: a chart clearing a
    // cursor it no longer holds must not clear another chart's. A null source
    // clears whichever chart holds it.
    if (!current || (sourceId !== null && current.sourceId !== sourceId)) return;
    cursors.delete(tabKey);
  } else {
    if (sourceId === null || (current?.sourceId === sourceId && current.time === time)) return;
    cursors.set(tabKey, { time, sourceId });
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A chart's handle on the cursor its layout tab shares. */
export interface TabCursorLink {
  /** Calls `listener` whenever a tab's cursor moves. */
  subscribe(listener: () => void): () => void;
  /** Where another chart's cursor is in this tab: null when none is, or the cursor is this chart's own. */
  time(): number | null;
  /** Whether this chart's cursor is the tab's. */
  held(): boolean;
  /** Reports this chart's cursor, or null when it leaves. */
  publish(time: number | null): void;
  /** Clears the tab's cursor, whichever chart holds it, a pinned one too. */
  clear(): void;
  /** Whether the tab's cursor is pinned. */
  pinned?(): boolean;
  /** Pins the tab's cursor at `time`, which no chart's pointer moves, or unpins it with null. */
  pin?(time: number | null): void;
}

/** A layout tab is named by its id; older saved tabs have none, and go by position. */
const selectTabKey = (state: AppState): string => {
  const { layouts, activeLayoutIndex } = state.config;
  return layouts[activeLayoutIndex]?.id ?? `index:${activeLayoutIndex}`;
};

/**
 * Shares a chart's cursor time with the other charts in its layout tab.
 * `sourceId` names the chart, unique in the tab: two charts in one pane each
 * have their own, so either follows the other. Reading the handle does not
 * re-render anything when the cursor moves: what draws the cursor
 * subscribes, so a pointer move on one chart re-renders the other charts and
 * nothing around them. A null `sourceId`, or no app around it (a test, a
 * screenshot), shares nothing.
 */
export function useTabCursorLink(sourceId: string | null): TabCursorLink | undefined {
  const tabKey = useOptionalAppSelector<string | null>(selectTabKey, null);
  const app = useContext(AppContext);
  const paneId = useOptionalPaneInstanceId();
  const link = useMemo<TabCursorLink | undefined>(() => tabKey === null || sourceId === null ? undefined : {
    subscribe,
    time: () => {
      const cursor = cursors.get(tabKey);
      return cursor && cursor.sourceId !== sourceId ? cursor.time : null;
    },
    held: () => cursors.get(tabKey)?.sourceId === sourceId,
    publish: (time) => {
      // A pinned cursor stays until it is unpinned: hovering a chart, or leaving it, does not move it.
      if (cursors.get(tabKey)?.sourceId === PINNED) return;
      setTabCursorTime(tabKey, sourceId, time !== null && Number.isFinite(time) ? time : null);
    },
    clear: () => setTabCursorTime(tabKey, null, null),
    pinned: () => cursors.get(tabKey)?.sourceId === PINNED,
    // Null unpins; a time no Date can hold changes nothing.
    pin: (time) => {
      if (time === null || isMoment(time)) setTabCursorTime(tabKey, PINNED, time);
    },
  }, [sourceId, tabKey]);
  useEffect(() => {
    if (!link || tabKey === null) return;
    pinViewers.set(tabKey, (pinViewers.get(tabKey) ?? 0) + 1);
    return () => {
      // A chart closed or switched away from under the cursor takes its cursor with it.
      link.publish(null);
      const left = (pinViewers.get(tabKey) ?? 1) - 1;
      if (left > 0) {
        pinViewers.set(tabKey, left);
        return;
      }
      pinViewers.delete(tabKey);
      // The pin is the tab's, so it stays when the chart it was pinned on
      // closes and others remain, and through a switch to another tab. When
      // the last chart showing it closes, nothing in the tab could lift it,
      // so it goes too. Read once the commit settles, from the app's current
      // state: a chart replaced in place, or one in a pane that is still open
      // (reloading), keeps it.
      queueMicrotask(() => {
        if (pinViewers.has(tabKey) || !app) return;
        const state = "getState" in app ? app.getState() : app.state;
        if (selectTabKey(state) !== tabKey) return;
        if (paneId !== null && findPaneInstance(state.config.layout, paneId)) return;
        setTabCursorTime(tabKey, PINNED, null);
      });
    };
  }, [app, link, paneId, tabKey]);
  return link;
}

/**
 * The moment the layout tab's crosshair is pinned at, for a pane that is not a
 * chart (news, the tape): null while nothing is pinned. It follows the pin, not
 * a pointer passing over a chart, so a list re-renders when the pin moves and
 * never on a pointer move.
 */
export function usePinnedTabTime(): number | null {
  const tabKey = useOptionalAppSelector<string | null>(selectTabKey, null);
  const pinnedTime = useCallback(() => {
    const cursor = tabKey === null ? undefined : cursors.get(tabKey);
    return cursor?.sourceId === PINNED ? cursor.time : null;
  }, [tabKey]);
  return useSyncExternalStore(subscribe, pinnedTime);
}

/** Lifts the layout tab's pin from a pane that is not a chart, as Esc does on a chart. */
export function useUnpinTab(): () => void {
  const tabKey = useOptionalAppSelector<string | null>(selectTabKey, null);
  return useCallback(() => {
    if (tabKey !== null) setTabCursorTime(tabKey, PINNED, null);
  }, [tabKey]);
}
