import {
  recordDefaults,
  recordFields,
  dateFields,
  type RowMap,
  type TableName,
} from "./model";

/** Validate legacy exports and every write using the same application field definitions. */
export function normalizeRecord<T extends TableName>(
  table: T,
  input: object,
  now = Date.now(),
): RowMap[T] {
  const defaults = Object.fromEntries(
    Object.entries(recordDefaults[table]).map(([k, v]) => [
      k,
      v === "$now" ? new Date(now) : v,
    ]),
  );
  const data: Record<string, unknown> = {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ),
  };
  const fields = recordFields[table];
  for (const key of Object.keys(data))
    if (!(key in fields)) throw new Error(`Unknown ${table} field: ${key}`);
  for (const [key, spec] of Object.entries(fields)) {
    let value = data[key];
    if (value === null && spec.nullable) continue;
    if (spec.kind === "timestamp") {
      const date =
        value instanceof Date ? value : new Date(value as string | number);
      if (
        value === null ||
        value === undefined ||
        !Number.isFinite(date.getTime())
      )
        throw new Error(`Invalid ${table}.${key} date`);
      data[key] = date;
    } else if (spec.enum) {
      if (!(spec.enum as readonly unknown[]).includes(value))
        throw new Error(`Invalid ${table}.${key}`);
    } else if (spec.kind === "integer") {
      if (!Number.isSafeInteger(value))
        throw new Error(`Invalid ${table}.${key} integer`);
    } else if (
      typeof value !== (spec.kind === "boolean" ? "boolean" : "string")
    ) {
      throw new Error(`Invalid ${table}.${key}`);
    }
  }
  if (typeof data.id !== "string" || !data.id.trim())
    throw new Error(`Missing ${table} ID`);
  return data as unknown as RowMap[T];
}
export function toDocument<T extends TableName>(
  table: T,
  row: RowMap[T],
): Record<string, any> {
  const data = { ...row } as Record<string, any>;
  for (const key of dateFields[table])
    if (data[key] instanceof Date) data[key] = data[key].getTime();
  return data;
}
export function fromDocument<T extends TableName>(
  table: T,
  doc: Record<string, any>,
): RowMap[T] {
  const { _id, _creationTime, ...data } = doc;
  for (const key of dateFields[table])
    if (data[key] !== null && data[key] !== undefined)
      data[key] = new Date(data[key]);
  return data as RowMap[T];
}
