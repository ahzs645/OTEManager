export function requireServer(secret: string) {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (!expected || secret !== expected)
    throw new Error("Unauthorized server connection");
}
