import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { expandUnits, hasIdentifier } from "./fulfillment.schema";

type DB = SupabaseClient<Database>;

export async function recordEvent(
  supabase: DB,
  params: {
    orderId: string;
    event: string;
    note?: string;
    actorEmail?: string;
    actorRole?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await supabase.from("order_events").insert({
    order_id: params.orderId,
    event: params.event,
    note: params.note ?? null,
    actor_email: params.actorEmail ?? null,
    actor_role: params.actorRole ?? "admin",
    metadata: (params.metadata ?? {}) as never,
  });
}

/** Throws when a serial / IMEI is already recorded on another order. */
export async function assertNoDuplicateIdentifiers(
  supabase: DB,
  orderId: string,
  rows: Array<{ serial_number?: string; imei_1?: string; imei_2?: string }>,
) {
  const values = new Map<string, string>(); // normalized -> field label
  const add = (v: string | undefined, label: string) => {
    const norm = (v ?? "").trim().toLowerCase();
    if (!norm) return;
    if (values.has(norm)) throw new Error(`Duplicate ${label} "${v}" appears twice in this order`);
    values.set(norm, label);
  };
  rows.forEach((r) => {
    add(r.serial_number, "serial number");
    add(r.imei_1, "IMEI");
    add(r.imei_2, "IMEI");
  });
  if (!values.size) return;

  const list = Array.from(values.keys());
  const { data: existing, error } = await supabase
    .from("order_item_identifiers")
    .select("order_id, serial_number, imei_1, imei_2")
    .neq("order_id", orderId);
  if (error) throw new Error(error.message);
  for (const row of existing ?? []) {
    for (const field of [row.serial_number, row.imei_1, row.imei_2]) {
      const norm = (field ?? "").trim().toLowerCase();
      if (norm && list.includes(norm)) {
        throw new Error(
          `"${field}" is already assigned to order #${String(row.order_id).slice(0, 8).toUpperCase()}. Each device can only be sold once.`,
        );
      }
    }
  }
}

/** Every physical unit on the order must carry an identifier before it can be marked ready. */
export async function assertIdentifiersComplete(supabase: DB, orderId: string) {
  const { data: order, error } = await supabase.from("orders").select("items").eq("id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  const items = Array.isArray(order?.items) ? (order!.items as Array<{ qty?: number; name?: string }>) : [];
  const units = expandUnits(items);
  if (!units.length) return;
  const { data: ids, error: e2 } = await supabase
    .from("order_item_identifiers")
    .select("*")
    .eq("order_id", orderId);
  if (e2) throw new Error(e2.message);
  const complete = (ids ?? []).filter((r) => hasIdentifier(r)).length;
  if (complete < units.length) {
    throw new Error(
      `Assign device serials/IMEI for all ${units.length} unit(s) before marking this order ready (${complete} recorded). Use Orders → Prepare.`,
    );
  }
}