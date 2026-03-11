import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/test')({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ message: "Test route works!" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
})
