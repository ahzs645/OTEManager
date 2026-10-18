// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  activeBankingTab,
  isBankingTab,
  resolveBankingTab,
} from "../extensions/vancity-payment-helper/bank-tab.js";

afterEach(() => vi.unstubAllGlobals());
const bank = { id: 17, url: "https://my.vancity.com/banking/home" };

test("a closed bank tab reconnects to the active bank in the last focused browser window", async () => {
  const query = vi.fn(async () => [bank]);
  vi.stubGlobal("chrome", {
    tabs: {
      get: vi.fn(async () => {
        throw new Error("No such tab");
      }),
      query,
    },
  });
  expect(await resolveBankingTab(7)).toEqual(bank);
  expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
});

test("a valid connected bank remains pinned when the user switches to OTEManager", async () => {
  const query = vi.fn(async () => [
    { id: 8, url: "https://manager.example.test/" },
  ]);
  vi.stubGlobal("chrome", { tabs: { get: vi.fn(async () => bank), query } });
  expect(await resolveBankingTab(17)).toEqual(bank);
  expect(query).not.toHaveBeenCalled();
});

test("Chrome-redacted tab metadata explains Connect Vancity instead of saying the bank is not open", async () => {
  vi.stubGlobal("chrome", { tabs: { query: vi.fn(async () => [{ id: 17 }]) } });
  await expect(activeBankingTab()).rejects.toThrow("Click Connect Vancity");
});

test("a pending payment never follows another active bank tab", async () => {
  const query = vi.fn(async () => [bank]);
  const get = vi.fn(async () => {
    throw new Error("No such tab");
  });
  vi.stubGlobal("chrome", { tabs: { get, query } });
  await expect(resolveBankingTab(7, { locked: true })).rejects.toThrow(
    "previously connected",
  );
  expect(query).not.toHaveBeenCalled();
  get.mockImplementation(async () => ({ id: 7 }) as any);
  await expect(resolveBankingTab(7, { locked: true })).rejects.toThrow(
    "Click Connect Vancity",
  );
  expect(query).not.toHaveBeenCalled();
});

test.each([
  "http://my.vancity.com/banking/home",
  "https://my.vancity.com.evil.test/banking/home",
  "https://my.vancity.com@evil.test/banking/home",
  "https://my.vancity.com/",
  "invalid",
])("only the exact HTTPS banking origin is accepted: %s", (url) => {
  expect(isBankingTab({ id: 17, url })).toBe(false);
});
