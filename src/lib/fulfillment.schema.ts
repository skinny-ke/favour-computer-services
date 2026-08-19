import { z } from "zod";

export const IdentifierRowSchema = z.object({
  item_index: z.coerce.number().int().min(0),
  product_id: z.string().uuid().nullable().optional().default(null),
  product_name: z.string().max(240).optional().default(""),
  qty: z.coerce.number().int().min(1).optional().default(1),
  serial_number: z.string().trim().max(120).optional().default(""),
  imei_1: z.string().trim().max(60).optional().default(""),
  imei_2: z.string().trim().max(60).optional().default(""),
  service_tag: z.string().trim().max(60).optional().default(""),
  asset_tag: z.string().trim().max(60).optional().default(""),
  other_identifier: z.string().trim().max(120).optional().default(""),
  warranty: z.string().trim().max(120).optional().default(""),
  warranty_start: z.string().trim().max(20).optional().default(""),
  warranty_months: z.coerce.number().int().min(0).max(120).optional().default(0),
  notes: z.string().trim().max(500).optional().default(""),
});

export const SaveIdentifiersSchema = z.object({
  order_id: z.string().uuid(),
  rows: z.array(IdentifierRowSchema).max(200),
});

export const ConfirmPickupSchema = z.object({
  order_id: z.string().uuid(),
  recipient_name: z.string().trim().min(2).max(160),
  picked_up_by: z.string().trim().max(160).optional().default(""),
  staff_name: z.string().trim().min(2).max(160),
  reference: z.string().trim().max(120).optional().default(""),
  signature: z.string().max(400000).optional().default(""),
  note: z.string().trim().max(500).optional().default(""),
});

export const OrderEventSchema = z.object({
  order_id: z.string().uuid(),
  event: z.string().trim().min(2).max(80),
  note: z.string().trim().max(500).optional().default(""),
  metadata: z.record(z.string(), z.any()).optional().default({}),
});

export type IdentifierRowInput = z.infer<typeof IdentifierRowSchema>;

export type OrderUnit = {
  item_index: number;
  product_id: string | null;
  product_name: string;
  unit_of: number;
  units_total: number;
  price: number;
};

/** Flattens order line items into one row per physical unit (qty 3 -> 3 units). */
export function expandUnits(
  items: Array<{ name?: string; qty?: number; price?: number; product_id?: string }>,
): OrderUnit[] {
  const units: OrderUnit[] = [];
  items.forEach((it, lineIdx) => {
    const qty = Math.max(1, Number(it.qty ?? 1));
    for (let u = 0; u < qty; u++) {
      units.push({
        item_index: lineIdx * 100 + u,
        product_id: typeof it.product_id === "string" && it.product_id.length === 36 ? it.product_id : null,
        product_name: String(it.name ?? ""),
        unit_of: u + 1,
        units_total: qty,
        price: Number(it.price ?? 0),
      });
    }
  });
  return units;
}

export function hasIdentifier(row: {
  serial_number?: string | null;
  imei_1?: string | null;
  service_tag?: string | null;
  asset_tag?: string | null;
  other_identifier?: string | null;
}): boolean {
  return Boolean(
    (row.serial_number ?? "").trim() ||
      (row.imei_1 ?? "").trim() ||
      (row.service_tag ?? "").trim() ||
      (row.asset_tag ?? "").trim() ||
      (row.other_identifier ?? "").trim(),
  );
}