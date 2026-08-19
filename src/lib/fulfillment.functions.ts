import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, logAudit } from "./admin/audit.server";
import {
  ConfirmPickupSchema,
  OrderEventSchema,
  SaveIdentifiersSchema,
} from "./fulfillment.schema";
import {
  assertIdentifiersComplete,
  assertNoDuplicateIdentifiers,
  recordEvent,
} from "./fulfillment.server";

export const adminGetFulfillment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: order, error } = await context.supabase
      .from("orders").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    const [{ data: identifiers }, { data: events }] = await Promise.all([
      context.supabase.from("order_item_identifiers").select("*").eq("order_id", data.id).order("item_index"),
      context.supabase.from("order_events").select("*").eq("order_id", data.id).order("created_at", { ascending: false }),
    ]);
    return { order, identifiers: identifiers ?? [], events: events ?? [] };
  });

export const saveOrderIdentifiers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof SaveIdentifiersSchema>) => SaveIdentifiersSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await assertNoDuplicateIdentifiers(context.supabase, data.order_id, data.rows);

    const payload = data.rows.map((r) => ({
      order_id: data.order_id,
      item_index: r.item_index,
      product_id: r.product_id ?? null,
      product_name: r.product_name ?? "",
      qty: 1,
      serial_number: r.serial_number || null,
      imei_1: r.imei_1 || null,
      imei_2: r.imei_2 || null,
      service_tag: r.service_tag || null,
      asset_tag: r.asset_tag || null,
      other_identifier: r.other_identifier || null,
      warranty: r.warranty || null,
      warranty_start: r.warranty_start || null,
      warranty_months: r.warranty_months || null,
      notes: r.notes || null,
    }));

    const { error } = await context.supabase
      .from("order_item_identifiers")
      .upsert(payload as never, { onConflict: "order_id,item_index" });
    if (error) {
      if (/duplicate key|uniq_oii/i.test(error.message)) {
        throw new Error("One of these serials/IMEI is already recorded on another order.");
      }
      throw new Error(error.message);
    }

    await recordEvent(context.supabase, {
      orderId: data.order_id,
      event: "devices_assigned",
      note: `${payload.length} device record(s) saved`,
      actorEmail: context.claims?.email ?? "",
    });
    await logAudit(context.supabase, {
      adminId: context.userId, adminEmail: context.claims?.email ?? "",
      action: "assign_devices", entity: "order", entityId: data.order_id,
      details: { units: payload.length },
    });
    return { ok: true, saved: payload.length };
  });

export const markOrderReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await assertIdentifiersComplete(context.supabase, data.id);
    const { error } = await context.supabase.from("orders").update({ status: "ready" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("order_item_identifiers").update({ locked: true }).eq("order_id", data.id);
    await recordEvent(context.supabase, {
      orderId: data.id, event: "ready", note: "Order verified and marked ready",
      actorEmail: context.claims?.email ?? "",
    });
    await logAudit(context.supabase, {
      adminId: context.userId, adminEmail: context.claims?.email ?? "",
      action: "status", entity: "order", entityId: data.id, details: { status: "ready" },
    });
    return { ok: true };
  });

export const confirmPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof ConfirmPickupSchema>) => ConfirmPickupSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("orders")
      .update({
        status: "picked_up",
        pickup_confirmed_at: new Date().toISOString(),
        pickup_recipient_name: data.recipient_name,
        pickup_picked_up_by: data.picked_up_by || data.recipient_name,
        pickup_staff_name: data.staff_name,
        pickup_reference: data.reference || null,
        pickup_signature: data.signature || null,
      })
      .eq("id", data.order_id);
    if (error) throw new Error(error.message);
    await recordEvent(context.supabase, {
      orderId: data.order_id,
      event: "picked_up",
      note: `Collected by ${data.picked_up_by || data.recipient_name}; released by ${data.staff_name}${data.note ? ` — ${data.note}` : ""}`,
      actorEmail: context.claims?.email ?? "",
      metadata: { reference: data.reference, signed: Boolean(data.signature) },
    });
    await logAudit(context.supabase, {
      adminId: context.userId, adminEmail: context.claims?.email ?? "",
      action: "pickup_confirmed", entity: "order", entityId: data.order_id,
      details: { recipient: data.recipient_name, staff: data.staff_name },
    });
    return { ok: true };
  });

export const addOrderEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof OrderEventSchema>) => OrderEventSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await recordEvent(context.supabase, {
      orderId: data.order_id, event: data.event, note: data.note,
      actorEmail: context.claims?.email ?? "", metadata: data.metadata,
    });
    await logAudit(context.supabase, {
      adminId: context.userId, adminEmail: context.claims?.email ?? "",
      action: data.event, entity: "order", entityId: data.order_id, details: data.metadata,
    });
    return { ok: true };
  });