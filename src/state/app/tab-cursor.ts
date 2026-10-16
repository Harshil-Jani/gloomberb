import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
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

function setTabCursorTime(tabKey: string, sourceId: string, time: number | null): void {
  const current = cursors.get(tabKey);
  if (time === null) {
    // Only the pane the cursor is on can take it away: a pane clearing a
    // cursor it no longer holds must not clear another pane's.
    if (current?.sourceId !== sourceId) return;
    cursors.delete(tabKey);
  } else {
    if (current?.sourceId === sourceId && current.time === time) return;
    cursors.set(tabKey, { time, sourceId });
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A layout tab is named by its id; older saved tabs have none, and go by position. */
const selectTabKey = (state: AppState): string => {
  const { layouts, activeLayoutIndex } = state.config;
  return layouts[activeLayoutIndex]?.id ?? `index:${activeLayoutIndex}`;
};

/**
 * Shares this pane's cursor time with the other panes in its layout tab.
 * `time` is where another pane's cursor is (null when none is, or the cursor
 * is this pane's own) and `publish` reports this pane's, or null when it
 * leaves. Outside an app (a test, a screenshot) nothing is shared.
 */
export function useTabCursorTime(sourceId: string): {
  time: number | null;
  publish: (time: number | null) => void;
} {
  const tabKey = useOptionalAppSelector<string | null>(selectTabKey, null);
  const time = useSyncExternalStore(subscribe, () => {
    const cursor = tabKey === null ? undefined : cursors.get(tabKey);
    return cursor && cursor.sourceId !== sourceId ? cursor.time : null;
  });
  const publish = useCallback((next: number | null) => {
    if (tabKey === null) return;
    setTabCursorTime(tabKey, sourceId, next !== null && Number.isFinite(next) ? next : null);
  }, [sourceId, tabKey]);
  // A pane closed or switched away from under the cursor takes its cursor with it.
  useEffect(() => () => publish(null), [publish]);
  return useMemo(() => ({ time, publish }), [publish, time]);
}
