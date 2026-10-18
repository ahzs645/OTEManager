export async function applyHelperSurface(surface) {
  if (!["sidepanel", "popup"].includes(surface))
    throw new Error("Choose Sidebar or Popover for the helper window.");
  if (!chrome.sidePanel?.setPanelBehavior || !chrome.action.setPopup) {
    if (surface === "sidepanel")
      throw new Error(
        "Chrome's sidebar is unavailable. Update Chrome or use Popover.",
      );
    return;
  }
  await chrome.action.setPopup({
    popup: surface === "popup" ? "popup.html?surface=popup" : "",
  });
  await chrome.sidePanel.setOptions({
    path: "popup.html",
    enabled: surface === "sidepanel",
  });
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: surface === "sidepanel",
  });
}

export async function initializeHelperSurface() {
  if (!chrome.sidePanel?.setPanelBehavior || !chrome.action.setPopup) return;
  const { helperSurface } = await chrome.storage.local.get("helperSurface");
  await applyHelperSurface(helperSurface === "popup" ? "popup" : "sidepanel");
}

export async function saveHelperSurface(surface) {
  const { helperSurface } = await chrome.storage.local.get("helperSurface");
  try {
    await applyHelperSurface(surface);
    await chrome.storage.local.set({ helperSurface: surface });
  } catch (error) {
    await applyHelperSurface(
      helperSurface === "popup" ? "popup" : "sidepanel",
    ).catch(() => {});
    throw error;
  }
  return { surface };
}
