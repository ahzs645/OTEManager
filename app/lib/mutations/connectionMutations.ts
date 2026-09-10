import { createServerFn } from "@tanstack/react-start";
export const getConnectionConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL || "";
    try {
      const { health } = await import("../../../server/convex");
      await health();
      return {
        provider: "convex",
        url,
        connected: true,
        message: "Convex database and file storage are connected.",
      };
    } catch (e) {
      return {
        provider: "convex",
        url,
        connected: false,
        message: e instanceof Error ? e.message : "Unable to connect to Convex",
      };
    }
  },
);
