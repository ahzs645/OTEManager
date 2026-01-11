import {
  getFullRouterManifest as getBaseFullRouterManifest,
} from "@tanstack/start/router-manifest";
import { getManifest } from "vinxi/manifest";
import type { Manifest } from "@tanstack/react-router";

const LEGACY_PREAMBLE_MARKER = "__vite_plugin_react_preamble_installed__";

function ensureTrailingSlash(path: string) {
  return path.endsWith("/") ? path : `${path}/`;
}

function getClientBase() {
  try {
    return getManifest("client")?.base ?? "/";
  } catch {
    return "/";
  }
}

function getRefreshPreamble(base: string) {
  const normalizedBase = ensureTrailingSlash(base);
  return [
    `import { injectIntoGlobalHook } from "${normalizedBase}@react-refresh";`,
    "injectIntoGlobalHook(window);",
    "window.$RefreshReg$ = () => {};",
    "window.$RefreshSig$ = () => (type) => type;",
  ].join("\n");
}

export function getFullRouterManifest(): Manifest {
  const routerManifest = getBaseFullRouterManifest();

  if (process.env.NODE_ENV === "development") {
    const rootRoute =
      (routerManifest.routes.__root__ =
        routerManifest.routes.__root__ || {});

    const assets = (rootRoute.assets ?? []).filter((asset: any) => {
      return !(
        asset?.tag === "script" &&
        typeof asset.children === "string" &&
        asset.children.includes(LEGACY_PREAMBLE_MARKER)
      );
    });

    // Ensure React Refresh preamble matches current @vitejs/plugin-react.
    assets.unshift({
      tag: "script",
      attrs: { type: "module" },
      children: getRefreshPreamble(getClientBase()),
    });

    rootRoute.assets = assets;
  }

  return routerManifest;
}

export function getRouterManifest() {
  const routerManifest = getFullRouterManifest();

  return {
    ...routerManifest,
    routes: Object.fromEntries(
      Object.entries(routerManifest.routes).map(([key, value]: any) => {
        const { preloads, assets } = value;
        return [key, { preloads, assets }];
      })
    ),
  };
}
