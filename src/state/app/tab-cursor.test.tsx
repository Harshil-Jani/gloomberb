import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createOpenTuiTestHarness } from "../../renderers/opentui/test-utils";
import { createDefaultConfig } from "../../types/config";
import type { AppState } from "../../core/state/app/state";
import { AppContext, createInitialState, PaneInstanceProvider } from "./context";
import { useTabCursorLink, type TabCursorLink } from "./tab-cursor";

const tui = createOpenTuiTestHarness();

describe("a pinned tab cursor", () => {
  // The pin is the tab's: closing the chart it came from, a chart whose pane
  // stays open (reloading) or switching tabs keeps it, and only the last
  // chart closing in the open tab lifts it. All of that is read after the
  // commit, from the app's state at that moment.
  test("goes when the last chart in the open tab closes, and not before", async () => {
    const base = createInitialState(createDefaultConfig("/tmp/gloomberb-tab-cursor-pin"));
    const tabs = [{ ...base.config.layouts[0]!, id: "tab-a" }, { ...base.config.layouts[0]!, id: "tab-b" }];
    let state: AppState = { ...base, config: { ...base.config, layouts: tabs, activeLayoutIndex: 0 } };
    const store = { dispatch: () => {}, getState: () => state, subscribe: () => () => {} };
    const openPane = state.config.layout.instances[0]!.instanceId;
    const links: Record<string, TabCursorLink | undefined> = {};
    let show: (charts: string[]) => void = () => {};
    function Chart({ id }: { id: string }) {
      links[id] = useTabCursorLink(id);
      return null;
    }
    function Charts() {
      const [charts, setCharts] = useState(["closed-a", "open"]);
      show = setCharts;
      return charts.map((id) => id === "open"
        ? <PaneInstanceProvider key={id} paneId={openPane}><Chart id={id} /></PaneInstanceProvider>
        : <PaneInstanceProvider key={id} paneId={`gone:${id}`}><Chart id={id} /></PaneInstanceProvider>);
    }
    await tui.render(<AppContext value={store}><Charts /></AppContext>);
    const settle = () => act(async () => {
      await tui.setup().renderOnce();
      await Promise.resolve();
    });

    await act(async () => links["closed-a"]!.pin!(Date.parse("2026-10-16T16:00:00Z")));
    // A time no Date holds changes nothing.
    await act(async () => links["closed-a"]!.pin!(Number.NaN));
    expect(links.open!.pinned!()).toBe(true);

    // The chart it was pinned on closes; another is still there.
    await act(async () => show(["open"]));
    await settle();
    expect(links.open!.pinned!()).toBe(true);
    // The last chart unmounts, but its pane is still in the layout.
    await act(async () => show([]));
    await settle();
    expect(links.open!.pinned!()).toBe(true);
    // Every chart unmounts because the user switched tabs.
    await act(async () => show(["closed-b"]));
    await settle();
    state = { ...state, config: { ...state.config, activeLayoutIndex: 1 } };
    await act(async () => show([]));
    await settle();
    state = { ...state, config: { ...state.config, activeLayoutIndex: 0 } };
    await act(async () => show(["closed-b"]));
    await settle();
    expect(links["closed-b"]!.pinned!()).toBe(true);
    // The last chart in the open tab closes.
    await act(async () => show([]));
    await settle();
    expect(links["closed-b"]!.pinned!()).toBe(false);
  });
});
