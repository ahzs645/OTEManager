import { createFileRoute } from "@tanstack/react-router";

export async function handleNativeRequest(request: Request) {
  const { nativeService, NativeRequestError } = await import("../../server/designcraft-native");
  try {
    const service = await nativeService(), url = new URL(request.url);
    if (request.method === "POST") return Response.json(await service.submitRequest(request), { status: 202, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "GET") return Response.json({ error: "Method not supported" }, { status: 405 });
    const id = url.searchParams.get("job");
    if (!id) return Response.json(await service.capabilities(), { headers: { "Cache-Control": "no-store" } });
    const artifact = url.searchParams.get("artifact");
    if (!artifact) return Response.json(await service.get(id), { headers: { "Cache-Control": "no-store" } });
    const file = await service.artifact(id, artifact);
    return new Response(new Uint8Array(file.buffer), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `attachment; filename="${file.name}"`, "Content-Length": String(file.bytes), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Native export failed" }, { status: error instanceof NativeRequestError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const Route = createFileRoute("/api/designcraft/native")({ server: { handlers: { GET: ({ request }) => handleNativeRequest(request), POST: ({ request }) => handleNativeRequest(request) } } });
