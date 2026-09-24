export const OPEN_TUI_NATIVE_SMOKE_COMMAND = "__gloomberb-smoke-opentui-native";
export const OPEN_TUI_RUNTIME_SMOKE_COMMAND = "__gloomberb-smoke-opentui-runtime";
export const PLUGIN_HOST_SMOKE_COMMAND = "__gloomberb-smoke-plugin-host";

export async function smokeOpenTuiNative(): Promise<void> {
  await import("../renderers/opentui/native-smoke");
}

export async function smokeOpenTuiRuntime(): Promise<void> {
  await import("../renderers/opentui/start");
  await assertRendersLeaveNoTimingEntries();
}

/**
 * A global install runs react-reconciler without its patch (see
 * bin/gloomberb). If the dev build's user timing turns back on, every render
 * adds a performance.measure entry that Bun never frees (#452).
 */
async function assertRendersLeaveNoTimingEntries(): Promise<void> {
  const { createElement } = await import("react");
  const { testRender } = await import("@opentui/react/test-utils");
  const setup = await testRender(createElement("text", null, "smoke"), { width: 10, height: 1 });
  await setup.renderOnce();
  const entries = performance.getEntriesByType("measure").length;
  setup.renderer.destroy();
  if (entries > 0) {
    throw new Error(`React recorded ${entries} render timing entries, which are never freed.`);
  }
}

/**
 * Loads a throwaway external plugin the way the terminal loads a real one.
 *
 * A packaged host has no Gloomberb package on disk, so a plugin's
 * `gloomberb/*` and `react` imports only resolve if the host answers them
 * itself. This is what an upgrade relies on: the panes that moved out of the
 * repository come back as plugins, and a binary that cannot load one has
 * lost them. Run against the built binary so a regression fails the build,
 * not the user's first launch.
 */
export async function smokePluginHost(): Promise<void> {
  const { smokePluginHostLoad } = await import("../plugins/host-smoke");
  await smokePluginHostLoad();
}
