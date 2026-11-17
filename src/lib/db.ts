import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
export const prisma = require("./prisma").default;

/**
 * Select records from a table with optional where conditions.
 * Usage: db.select("profiles", { id: userId })
 * Returns: Array of records or null if error
 */
export async function select<T = any>(
  table: string,
  where: Record<string, any> = {},
  options: { select?: any; orderBy?: any; take?: number; skip?: number } = {}
): Promise<{ data: T[] | null; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { data: null, error: `Model ${table} not found in Prisma schema` };
    }
    const data = await model.findMany({
      where,
      ...options,
    });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Select a single record from a table.
 * Usage: db.selectSingle("profiles", { id: userId })
 * Returns: Single record or null
 */
export async function selectSingle<T = any>(
  table: string,
  where: Record<string, any> = {},
  options: { select?: any } = {}
): Promise<{ data: T | null; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { data: null, error: `Model ${table} not found in Prisma schema` };
    }
    const data = await model.findFirst({ where, ...options });
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Insert a record into a table.
 * Usage: db.insert("profiles", { id, email, ... })
 * Returns: Created record or null
 */
export async function insert<T = any>(
  table: string,
  data: Record<string, any>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { data: null, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.create({ data });
    return { data: result, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Update records in a table.
 * Usage: db.update("profiles", { id: userId }, { wallet_balance: 100 })
 * Returns: Number of updated records or error
 */
export async function update(
  table: string,
  where: Record<string, any>,
  data: Record<string, any>
): Promise<{ count: number; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { count: 0, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.updateMany({ where, data });
    return { count: result.count, error: null };
  } catch (err: any) {
    return { count: 0, error: err.message };
  }
}

/**
 * Update a single record in a table.
 * Usage: db.updateSingle("profiles", { id: userId }, { wallet_balance: 100 })
 * Returns: Updated record or null
 */
export async function updateSingle<T = any>(
  table: string,
  where: Record<string, any>,
  data: Record<string, any>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { data: null, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.update({ where, data });
    return { data: result, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Delete records from a table.
 * Usage: db.delete("profiles", { id: userId })
 * Returns: Number of deleted records or error
 */
export async function del(
  table: string,
  where: Record<string, any>
): Promise<{ count: number; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { count: 0, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.deleteMany({ where });
    return { count: result.count, error: null };
  } catch (err: any) {
    return { count: 0, error: err.message };
  }
}

/**
 * Delete a single record from a table.
 * Usage: db.deleteSingle("profiles", { id: userId })
 * Returns: Deleted record or null
 */
export async function deleteSingle<T = any>(
  table: string,
  where: Record<string, any>
): Promise<{ data: T | null; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { data: null, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.delete({ where });
    return { data: result, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Upsert records into a table.
 * Usage: db.upsert("provider_services", { id: serviceId }, { name, rate, ... })
 * Returns: Upserted record or null
 */
export async function upsert<T = any>(
  table: string,
  where: Record<string, any>,
  data: Record<string, any>,
  updateData: Record<string, any> = data
): Promise<{ data: T | null; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { data: null, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.upsert({ where, create: data, update: updateData });
    return { data: result, error: null };
  } catch (err: any) {
    return { data: null, error: err.message };
  }
}

/**
 * Count records in a table.
 * Usage: db.count("orders", { user_id: userId })
 * Returns: Count or error
 */
export async function count(
  table: string,
  where: Record<string, any> = {}
): Promise<{ count: number; error: string | null }> {
  try {
    const model = (prisma as any)[table];
    if (!model) {
      return { count: 0, error: `Model ${table} not found in Prisma schema` };
    }
    const result = await model.count({ where });
    return { count: result, error: null };
  } catch (err: any) {
    return { count: 0, error: err.message };
  }
}

export default { select, selectSingle, insert, update, updateSingle, del, deleteSingle, upsert, count };
