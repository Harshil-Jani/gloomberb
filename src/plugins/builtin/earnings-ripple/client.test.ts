import { describe, expect, test } from "bun:test";
import type { SupplyChainPayload } from "../../../api-client/supply-chain";
import { loadRipple } from "./client";

describe("loadRipple", () => {
  test("a calendar that fails while disclosures are still loading rejects once, with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(loadRipple(["CRUS", "QRVO"], {
        supplyChain: async () => { await Bun.sleep(30); return { says: [] } as unknown as SupplyChainPayload; },
        calendar: () => Promise.reject(new Error("calendar down")),
      })).rejects.toThrow("calendar down");
      await Bun.sleep(60);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
