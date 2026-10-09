import { ChoiceDialog, TextPromptDialog, usePaneMenuItems } from "../../../components";
import { createFormCollectionActions } from "../../../components/form-modal/deps";
import { t, tf } from "../../../i18n";
import { usePluginAppActions } from "../../../public/react";
import { useAppDispatch, useAppGetState, usePaneAppConfig } from "../../../state/app/context";
import { formatTickerListInput, MAX_TICKER_LIST_SIZE } from "../../../tickers/list";
import type { TickerMetadata, TickerRecord } from "../../../types/ticker";
import { useOptionalDialog, type PromptContext } from "../../../ui/dialog";
import { slugifyName } from "../../../utils/slugify";
import { getSharedRegistry } from "../../registry";
import { MAX_CORRELATION_TICKERS } from "../correlation/settings";
import { ROTATION_LIMIT } from "../relative-rotation/model";
import { SHORT_WATCH_LIMIT } from "../short-interest/watch-model";

/** One US-listed member of a theme or fund, in the order its list shows it. */
export interface MemberListing {
  symbol: string;
  name?: string | null;
  exchange?: string | null;
  sector?: string | null;
}

interface MemberDestination {
  templateId: string;
  label: string;
  /** The most symbols the destination takes; more would be refused or cut off there. */
  limit: number;
  minimum: number;
}

/**
 * Functions that take a list of tickers through `options.symbols`. CORR and
 * RIPL resolve the list the way the command bar does, which takes ten
 * tickers; RIPL's own setting takes more, but not through a new pane.
 */
export const MEMBER_DESTINATIONS: readonly MemberDestination[] = [
  { templateId: "relative-rotation-rrg", label: "Relative Rotation (RRG)", limit: ROTATION_LIMIT, minimum: 1 },
  { templateId: "correlation-pane", label: "Correlation Matrix (CORR)", limit: MAX_CORRELATION_TICKERS, minimum: 2 },
  { templateId: "short-watch-pane", label: "Short Squeeze Watch (SIW)", limit: SHORT_WATCH_LIMIT, minimum: 1 },
  { templateId: "earnings-ripple-pane", label: "Earnings Ripple (RIPL)", limit: MAX_TICKER_LIST_SIZE, minimum: 1 },
];

/**
 * A watchlist is a list to read and follow; a whole Russell 2000 stays in
 * MEMB. Larger lists save their first 100 as listed.
 */
export const MEMBER_WATCHLIST_LIMIT = 100;

/**
 * Distinct members in list order, as `SYMBOL:EXCHANGE` when the list names the
 * listing: CORR and RIPL resolve each one, and a bare CCJ also matches Xetra.
 */
export function memberSymbols(members: readonly MemberListing[]): string[] {
  const seen = new Set<string>();
  return members.flatMap((member) => {
    const symbol = member.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) return [];
    seen.add(symbol);
    const exchange = member.exchange?.trim().toUpperCase();
    return [exchange ? `${symbol}:${exchange}` : symbol];
  });
}

/** What each destination would open: the first `limit` symbols as listed, or disabled below its minimum. */
export function memberDestinationChoices(symbols: readonly string[], destinations: readonly MemberDestination[]) {
  return destinations.map((destination) => {
    const taken = symbols.slice(0, destination.limit);
    const tooFew = taken.length < destination.minimum;
    return {
      id: destination.templateId,
      label: destination.label,
      symbols: taken,
      disabled: tooFew,
      description: tooFew ? tf("Needs at least {count} members", { count: destination.minimum })
        : taken.length < symbols.length ? tf("First {count} of {total} as listed", { count: taken.length, total: symbols.length })
        : tf("All {count}", { count: taken.length }),
    };
  });
}

/** The requested name, numbered when a watchlist already has that name or id. */
export function uniqueWatchlistName(requested: string, watchlists: readonly { id: string; name: string }[]): string {
  const base = requested.trim();
  const taken = (name: string) => watchlists.some((list) =>
    list.name.toLowerCase() === name.toLowerCase() || list.id === slugifyName(name, "watchlist"));
  let name = base;
  for (let suffix = 2; taken(name); suffix += 1) name = `${base} ${suffix}`;
  return name;
}

/** Tickers to create on the watchlist and existing ones to add to it, first `MEMBER_WATCHLIST_LIMIT` members as listed. */
export function planMemberWatchlist(
  tickers: ReadonlyMap<string, TickerRecord>,
  watchlistId: string,
  members: readonly MemberListing[],
): { create: TickerMetadata[]; update: TickerRecord[]; count: number } {
  const seen = new Set<string>();
  const create: TickerMetadata[] = [];
  const update: TickerRecord[] = [];
  for (const member of members) {
    const symbol = member.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    if (seen.size >= MEMBER_WATCHLIST_LIMIT) break;
    seen.add(symbol);
    const existing = tickers.get(symbol);
    if (existing) {
      if (!existing.metadata.watchlists.includes(watchlistId)) {
        update.push({ ...existing, metadata: { ...existing.metadata, watchlists: [...existing.metadata.watchlists, watchlistId] } });
      }
      continue;
    }
    // Theme and fund members are US listings quoted in dollars.
    create.push({ ticker: symbol, name: member.name ?? symbol, exchange: member.exchange ?? "", currency: "USD",
      ...(member.sector ? { sector: member.sector } : {}),
      portfolios: [], watchlists: [watchlistId], positions: [], custom: {}, tags: [] });
  }
  return { create, update, count: seen.size };
}

/**
 * Pane menu entries for a list of members (a theme's, a fund's): open them in
 * RRG, CORR, SIW or RIPL, or save them as a watchlist. Functions of disabled
 * plugins are left out; each destination gets as many as it takes.
 */
export function useMembersMenu(registrationId: string, list: { title: string; watchlistName: string; members: readonly MemberListing[] } | null) {
  const dialog = useOptionalDialog();
  const { createPaneFromTemplate, notify } = usePluginAppActions();
  const dispatch = useAppDispatch();
  const getState = useAppGetState();
  const disabledPlugins = usePaneAppConfig().disabledPlugins;
  usePaneMenuItems(registrationId, () => {
    const registry = getSharedRegistry();
    const symbols = list ? memberSymbols(list.members) : [];
    if (!list || !symbols.length || !dialog || !registry) return null;
    const destinations = MEMBER_DESTINATIONS.filter((destination) => {
      const owner = registry.getPaneTemplatePluginId?.(destination.templateId);
      return registry.paneTemplates.has(destination.templateId) && (!owner || !disabledPlugins.includes(owner));
    });
    const choices = memberDestinationChoices(symbols, destinations);
    const openIn = () => {
      void dialog.prompt<string>({
        closeOnClickOutside: true,
        content: (context: PromptContext<string>) => <ChoiceDialog {...context}
          title={tf("Open {title} members in", { title: list.title })}
          choices={choices.map(({ id, label, description, disabled }) => ({ id, label: t(label), description, disabled }))} />,
      }).then((templateId) => {
        const choice = choices.find((item) => item.id === templateId && !item.disabled);
        if (choice) createPaneFromTemplate(choice.id, { symbols: choice.symbols, arg: formatTickerListInput(choice.symbols) });
      }).catch(() => {});
    };
    const saveAsWatchlist = async (requested: string) => {
      const name = uniqueWatchlistName(requested, getState().config.watchlists);
      await createFormCollectionActions({ dataProvider: registry.marketData, dispatch, getState, pluginRegistry: registry,
        tickerRepository: registry.tickerRepository }, (body, options) => {
        if (options?.type === "error") notify({ body, type: "error" });
      }).createWatchlist(name);
      const watchlist = getState().config.watchlists.find((entry) => entry.name === name);
      if (!watchlist) throw new Error(t("The watchlist was not created."));
      const plan = planMemberWatchlist(getState().tickers, watchlist.id, list.members);
      for (const metadata of plan.create) {
        const ticker = await registry.tickerRepository.createTicker(metadata);
        dispatch({ type: "UPDATE_TICKER", ticker });
        registry.events.emit("ticker:added", { symbol: ticker.metadata.ticker, ticker });
      }
      for (const ticker of plan.update) {
        await registry.tickerRepository.saveTicker(ticker);
        dispatch({ type: "UPDATE_TICKER", ticker });
      }
      notify({ type: "success", body: tf("Saved {count} members to {name}.", { count: plan.count, name }) });
    };
    const total = symbols.length;
    return [
      ...(choices.length ? [{ id: "members-open-in", label: t("Open Members In…"), onSelect: openIn }] : []),
      { id: "members-save-watchlist", label: t("Save as Watchlist…"), onSelect: () => {
        void dialog.prompt<string>({
          closeOnClickOutside: true,
          content: (context: PromptContext<string>) => <TextPromptDialog {...context} title={t("Save as Watchlist")}
            body={[total > MEMBER_WATCHLIST_LIMIT
              ? tf("The first {count} of {total} members, as listed.", { count: MEMBER_WATCHLIST_LIMIT, total })
              : tf("All {count} members.", { count: total })]}
            label={t("Name")} initialValue={list.watchlistName} confirmLabel={t("Save")} />,
        }).then((name) => {
          if (!name?.trim()) return;
          saveAsWatchlist(name).catch((error: unknown) => {
            notify({ type: "error", body: error instanceof Error ? error.message : t("The watchlist was not saved.") });
          });
        }).catch(() => {});
      } },
    ];
  }, [createPaneFromTemplate, dialog, disabledPlugins, dispatch, getState, list, notify]);
}
