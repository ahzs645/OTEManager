import { makeFunctionReference } from "convex/server";
import { connection } from "./convex";
import { toWire, fromWire } from "../shared/codec";
import type { TableName, RowMap } from "../shared/model";
export async function list<T extends TableName>(
  table: T,
): Promise<RowMap[T][]> {
  const { client, secret } = connection();
  return fromWire(
    await client.query(makeFunctionReference<"query">("records:list"), {
      secret,
      table,
    }),
  );
}
export async function get<T extends TableName>(
  table: T,
  id: string,
): Promise<RowMap[T] | null> {
  const { client, secret } = connection();
  return fromWire(
    await client.query(makeFunctionReference<"query">("records:get"), {
      secret,
      table,
      id,
    }),
  );
}
export async function insert<T extends TableName>(
  table: T,
  data: Partial<RowMap[T]> | Record<string, unknown>,
): Promise<RowMap[T]> {
  const { client, secret } = connection();
  return fromWire(
    await client.mutation(makeFunctionReference<"mutation">("records:insert"), {
      secret,
      table,
      data: toWire(data),
    }),
  );
}
export async function patch<T extends TableName>(
  table: T,
  id: string,
  data: Partial<RowMap[T]> | Record<string, unknown>,
): Promise<RowMap[T]> {
  const { client, secret } = connection();
  return fromWire(
    await client.mutation(makeFunctionReference<"mutation">("records:patch"), {
      secret,
      table,
      id,
      data: toWire(data),
    }),
  );
}
