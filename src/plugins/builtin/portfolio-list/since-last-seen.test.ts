import { expect, test } from "bun:test";
import { movesSince, noteDeparture, takeReturnMoves } from "./since-last-seen";

const AWAY_MS = 120_000;

test("only rows priced on both sides that moved at least 0.01% are recapped", () => {
  const moves = movesSince(
    new Map([["AAPL", 200], ["MSFT", 400], ["FLAT", 100], ["GONE", 50], ["ZERO", 0]]),
    new Map([["AAPL", 202], ["MSFT", 396], ["FLAT", 100.004], ["ZERO", 1], ["NEW", 10]]),
  );
  expect([...moves.keys()].sort()).toEqual(["AAPL", "MSFT"]);
  expect(moves.get("AAPL")).toBeCloseTo(1);
  expect(moves.get("MSFT")).toBeCloseTo(-1);
});

test("coming back recaps only after the away threshold, and a short glance resets the clock", () => {
  const before = new Map([["AAPL", 200]]);
  const after = new Map([["AAPL", 210]]);

  noteDeparture("pane", 0, before);
  expect(takeReturnMoves("pane", AWAY_MS - 1, after, AWAY_MS)).toBeNull();
  // The glance used up the departure: a later return without a new one shows nothing.
  expect(takeReturnMoves("pane", AWAY_MS * 2, after, AWAY_MS)).toBeNull();

  noteDeparture("pane", 0, before);
  expect(takeReturnMoves("pane", AWAY_MS, after, AWAY_MS)?.get("AAPL")).toBeCloseTo(5);
});
