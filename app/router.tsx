import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // Preload on hover for faster navigation
    defaultPreload: "intent",
    // Cache loader data for 30 seconds - prevents refetching on back/forward
    defaultPreloadStaleTime: 30_000,
    // Keep showing current content while loading - only show pending state after 1 second
    defaultPendingMs: 1000,
    defaultPendingMinMs: 0,
    // Default stale time for all routes
    defaultStaleTime: 30_000,
    // Default garbage collection time
    defaultGcTime: 5 * 60 * 1000,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
