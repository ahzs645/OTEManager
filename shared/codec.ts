// Convex stores timestamps as numbers. The existing UI consumes Date objects.
export function toWire(value: any): any {
  if (value instanceof Date) return { oteDateISO: value.toISOString() };
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, toWire(v)]),
    );
  return value === undefined ? null : value;
}
export function fromWire(value: any): any {
  if (
    value &&
    typeof value === "object" &&
    typeof value.oteDateISO === "string" &&
    Object.keys(value).length === 1
  )
    return new Date(value.oteDateISO);
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fromWire(v)]),
    );
  return value;
}
