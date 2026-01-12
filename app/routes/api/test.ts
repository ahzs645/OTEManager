import { createAPIFileRoute } from "@tanstack/start/api";

export const APIRoute = createAPIFileRoute("/api/test")({
  GET: async () => {
    return new Response(JSON.stringify({ message: "Test route works!" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
