// Self-contained: executed only after the user opens the helper on OTEManager.
export function readPaymentManagerExport(connectionOnly = false) {
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
    ["http:", "https:"].includes(location.protocol);
  if (
    !(
      local || location.origin === "https://otemanager.k8s.overtheedgepaper.ca"
    ) ||
    location.pathname.replace(/\/$/, "") !== "/utilities/payment-manager"
  )
    return {
      status: "error",
      message:
        "Open the helper on OTEManager's Payment Manager page. Localhost and the OTEManager site are supported.",
    };
  let connection = null;
  try {
    const value = JSON.parse(
      document.querySelector(
        'script#ote-payment-helper-connection[type="application/json"]',
      )?.textContent || "null",
    );
    if (value?.protocolVersion === 1 && /^[\w-]{1,100}$/.test(value.bridgeId))
      connection = { protocolVersion: 1, bridgeId: value.bridgeId };
  } catch {
    /* Older OTEManager pages support import without write-back. */
  }
  if (connectionOnly)
    return connection
      ? { status: "connected", connection }
      : {
          status: "error",
          message:
            "This Payment Manager page does not support receipt write-back yet. Use the updated local app or deploy the repo changes.",
        };
  const exportNode = document.querySelector(
    'script#ote-payment-helper-export[type="application/json"]',
  );
  if (
    !exportNode?.textContent ||
    exportNode.textContent.length > 2 * 1024 * 1024
  )
    return {
      status: "error",
      message:
        "In Payment Manager, click Preview export and select the payments to import first.",
    };
  try {
    const batch = JSON.parse(exportNode.textContent);
    if (!batch.payments?.length)
      return {
        status: "error",
        message: "Select at least one payment in Payment Manager.",
      };
    return connection
      ? { status: "export", batch, connection }
      : { status: "export", batch };
  } catch {
    return {
      status: "error",
      message:
        "The page export is invalid. Refresh Payment Manager and preview again.",
    };
  }
}

// Self-contained, injected only into the exact tab and origin that the user
// connected. The page performs its own normal server mutation; no bank secrets.
export async function writePaymentConfirmation(
  data,
  connection,
  retry = false,
) {
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
    ["http:", "https:"].includes(location.protocol);
  if (
    !(
      local ||
      location.origin === "https://otemanager.k8s.overtheedgepaper.ca" ||
      (connection.live === true && location.protocol === "https:")
    ) ||
    location.origin !== connection.origin ||
    location.pathname.replace(/\/$/, "") !== "/utilities/payment-manager"
  )
    return {
      success: false,
      error:
        "The connected tab has left its original OTEManager Payment Manager.",
    };
  let marker;
  try {
    marker = JSON.parse(
      document.getElementById("ote-payment-helper-connection")?.textContent ||
        "null",
    );
  } catch {}
  if (marker?.protocolVersion !== 1 || marker.bridgeId !== connection.bridgeId)
    return {
      success: false,
      error:
        "OTEManager was closed, reloaded, or changed. Reconnect its tab and retry the stored receipt.",
    };
  const node = document.createElement("script");
  const requestId = crypto.randomUUID();
  node.id = `ote-payment-receipt-${requestId}`;
  node.type = "application/json";
  node.textContent = JSON.stringify({ data, retry });
  if (node.textContent.length > 100_000)
    return { success: false, error: "Receipt is too large." };
  document.body.append(node);
  return new Promise((resolve) => {
    const finish = (result) => {
      observer.disconnect();
      clearTimeout(timeout);
      node.remove();
      resolve(result);
    };
    const observer = new MutationObserver(() => {
      const raw = node.getAttribute("data-result");
      if (!raw) return;
      try {
        finish(JSON.parse(raw));
      } catch {
        finish({ success: false, error: "Invalid OTEManager response." });
      }
    });
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["data-result"],
    });
    const timeout = setTimeout(
      () =>
        finish({
          success: false,
          error:
            "OTEManager did not respond. Receipt saved; reconnect and retry.",
        }),
      15000,
    );
    window.dispatchEvent(
      new CustomEvent("ote:payment-confirmation", {
        detail: JSON.stringify({ bridgeId: connection.bridgeId, requestId }),
      }),
    );
  });
}

// Self-contained: Chrome grants the user-configured origin before injection.
export async function readLivePayments(request, origin) {
  if (
    location.origin !== origin ||
    location.pathname.replace(/\/$/, "") !== "/utilities/payment-manager"
  )
    return {
      status: "error",
      message:
        "The connected tab has left OTEManager's Payment Manager. Reconnect the site.",
    };
  let marker;
  try {
    marker = JSON.parse(
      document.getElementById("ote-payment-helper-connection")?.textContent ||
        "null",
    );
  } catch {}
  if (!marker)
    return {
      status: "loading",
      message:
        "Open OTEManager and sign in, then refresh payments in the helper.",
    };
  if (
    marker.protocolVersion !== 1 ||
    !marker.capabilities?.includes("live-payments")
  )
    return {
      status: "error",
      message:
        "This OTEManager version needs the live-connection update. Update the app, then refresh its Payment Manager page.",
    };
  const connection = { protocolVersion: 1, bridgeId: marker.bridgeId };
  if (request.connectionOnly) return { status: "connected", connection };
  const node = document.createElement("script");
  const requestId = crypto.randomUUID();
  node.id = `ote-payment-list-${requestId}`;
  node.type = "application/json";
  node.textContent = JSON.stringify(request);
  document.body.append(node);
  return new Promise((resolve) => {
    const finish = (result) => {
      observer.disconnect();
      clearTimeout(timeout);
      node.remove();
      resolve(result);
    };
    const observer = new MutationObserver(() => {
      const raw = node.getAttribute("data-result");
      if (!raw) return;
      try {
        if (raw.length > 2 * 1024 * 1024)
          throw new Error(
            "Payment list is too large. Narrow the publication filter.",
          );
        const result = JSON.parse(raw);
        finish(
          result.success
            ? { status: "payments", ...result.catalog, connection }
            : { status: "error", message: result.error },
        );
      } catch (error) {
        finish({ status: "error", message: error.message });
      }
    });
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["data-result"],
    });
    const timeout = setTimeout(
      () =>
        finish({
          status: "error",
          message:
            "OTEManager did not respond. Sign in there, then refresh payments.",
        }),
      15000,
    );
    window.dispatchEvent(
      new CustomEvent("ote:payment-list", {
        detail: JSON.stringify({ bridgeId: marker.bridgeId, requestId }),
      }),
    );
  });
}
