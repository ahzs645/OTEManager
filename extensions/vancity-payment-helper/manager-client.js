// A user-entered URL grants access to that origin only. Requests run through
// OTEManager's signed-in page; the extension never receives server credentials.
export function managerSite(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Enter a complete OTEManager URL, including https:// or http://localhost.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    !(url.protocol === "https:" || (local && url.protocol === "http:")) ||
    url.hostname === "my.vancity.com"
  )
    throw new Error(
      "Use an HTTPS OTEManager site or a local development URL, without a username or password.",
    );
  return {
    origin: url.origin,
    url: `${url.origin}/utilities/payment-manager`,
    permission: `${url.protocol}//${url.host}/*`,
  };
}

export async function managerTab(site) {
  if (!(await chrome.permissions.contains({ origins: [site.permission] })))
    throw new Error(
      "Click Connect to allow the helper to access this OTEManager site.",
    );
  const tabs = await chrome.tabs.query({ url: site.permission });
  const existing = tabs.find((tab) => {
    try {
      const url = new URL(tab.url);
      return (
        url.origin === site.origin &&
        url.pathname.replace(/\/$/, "") === "/utilities/payment-manager"
      );
    } catch {
      return false;
    }
  });
  return (
    existing || (await chrome.tabs.create({ url: site.url, active: false }))
  );
}

export async function requestManager(site, request, reader) {
  const tab = await managerTab(site);
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    let result;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: reader,
        args: [request, site.origin],
      });
      result = results[0]?.result;
    } catch (error) {
      lastError = "Page is loading";
    }
    if (result?.status === "loading") lastError = result.message;
    else if (result?.status === "error") throw new Error(result.message);
    else if (result)
      return {
        ...result,
        connection: {
          ...result.connection,
          tabId: tab.id,
          origin: site.origin,
          live: true,
        },
      };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    lastError === "Page is loading"
      ? "OTEManager is still loading. Sign in there, then click Refresh payments."
      : lastError,
  );
}
