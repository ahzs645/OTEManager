let pending: { blob: Blob; name: string } | null = null;
export function queueDesignCraftIssue(blob: Blob, name: string) { pending = { blob, name }; }
export function takeDesignCraftIssue() { const value = pending; pending = null; return value; }
