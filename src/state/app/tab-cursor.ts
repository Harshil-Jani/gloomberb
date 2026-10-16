import { useEffect, useMemo } from "react";
import type { AppState } from "../../core/state/app/state";
import { useOptionalAppSelector } from "./context";

/**
 * The time the pointer or keyboard cursor is at on one pane of a layout tab,
 * which the tab's other panes show at the same moment: the last instant the
 * cursor covers, so a pane reads its data as of then. It is held per tab, in
 * memory only: a cursor moves on every pointer event, and the app store would
 * re-run every pane's selectors on each one.
 */
interface TabCursor {
  time: number;
  /** The pane the cursor is on; it never follows its own time back. */
  sourceId: string;
}

const cursors = new Map<string, TabCursor>();
const listeners = new Set<() => void>();

function setTabCursorTime(tabKey: string, sourceId: string | null, time: number | null): void {
  const current = cursors.get(tabKey);
  if (time === null) {
    // Only the pane the cursor is on can take it away: a pane clearing a
    // cursor it no longer holds must not clear another pane's. A null source
    // clears whichever pane holds it.
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

/** A pane's handle on the cursor its layout tab shares. */
export interface TabCursorLink {
  /** Calls `listener` whenever a tab's cursor moves. */
  subscribe(listener: () => void): () => void;
  /** Where another pane's cursor is in this tab: null when none is, or the cursor is this pane's own. */
  time(): number | null;
  /** Whether this pane's cursor is the tab's. */
  held(): boolean;
  /** Reports this pane's cursor, or null when it leaves. */
  publish(time: number | null): void;
  /** Clears the tab's cursor, whichever pane holds it. */
  clear(): void;
}

/** A layout tab is named by its id; older saved tabs have none, and go by position. */
const selectTabKey = (state: AppState): string => {
  const { layouts, activeLayoutIndex } = state.config;
  return layouts[activeLayoutIndex]?.id ?? `index:${activeLayoutIndex}`;
};

/**
 * Shares this pane's cursor time with the other panes in its layout tab.
 * Reading the handle does not re-render the pane when the cursor moves: what
 * draws the cursor subscribes, so a pointer move on one chart re-renders the
 * other charts and nothing around them. Outside an app (a test, a
 * screenshot) nothing is shared.
 */
export function useTabCursorLink(sourceId: string): TabCursorLink | undefined {
  const tabKey = useOptionalAppSelector<string | null>(selectTabKey, null);
  const link = useMemo<TabCursorLink | undefined>(() => tabKey === null ? undefined : {
    subscribe,
    time: () => {
      const cursor = cursors.get(tabKey);
      return cursor && cursor.sourceId !== sourceId ? cursor.time : null;
    },
    held: () => cursors.get(tabKey)?.sourceId === sourceId,
    publish: (time) => setTabCursorTime(tabKey, sourceId, time !== null && Number.isFinite(time) ? time : null),
    clear: () => setTabCursorTime(tabKey, null, null),
  }, [sourceId, tabKey]);
  // A pane closed or switched away from under the cursor takes its cursor with it.
  useEffect(() => () => link?.publish(null), [link]);
  return link;
}
