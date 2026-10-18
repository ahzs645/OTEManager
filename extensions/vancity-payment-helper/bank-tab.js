export const BANK_SITE_PERMISSION = "https://my.vancity.com/*";
export const BANK_ACCESS_MESSAGE =
  "Click Connect Vancity in the helper and allow access to my.vancity.com, then try again. The sidebar can stay open while you use the bank.";

export function isBankingTab(tab) {
  if (!Number.isSafeInteger(tab?.id) || tab.id <= 0 || !tab.url) return false;
  try {
    const url = new URL(tab.url);
    return (
      url.origin === "https://my.vancity.com" &&
      url.pathname.startsWith("/banking/")
    );
  } catch {
    return false;
  }
}

export async function activeBankingTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const tab = tabs[0];
  if (!tab?.url) throw new Error(BANK_ACCESS_MESSAGE);
  if (!isBankingTab(tab))
    throw new Error(
      "Select your Vancity banking tab, then click Connect Vancity in the helper.",
    );
  return tab;
}

export async function resolveBankingTab(id, { locked = false } = {}) {
  if (id) {
    const saved = await chrome.tabs.get(id).catch(() => null);
    if (isBankingTab(saved)) return saved;
    if (locked) {
      if (saved && !saved.url) throw new Error(BANK_ACCESS_MESSAGE);
      throw new Error(
        "A payment is waiting on the previously connected bank tab. Check its confirmation or match its saved receipt in Sent history before connecting another tab.",
      );
    }
  }
  return activeBankingTab();
}
