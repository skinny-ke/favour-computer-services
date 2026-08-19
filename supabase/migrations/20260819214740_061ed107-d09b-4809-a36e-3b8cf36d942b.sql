-- ============ ORDER ITEM DEVICE IDENTIFIERS ============
CREATE TABLE public.order_item_identifiers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_index integer NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  qty integer NOT NULL DEFAULT 1,
  serial_number text,
  imei_1 text,
  imei_2 text,
  service_tag text,
  asset_tag text,
  other_identifier text,
  warranty text,
  warranty_start date,
  warranty_months integer,
  notes text,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, item_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_item_identifiers TO authenticated;
GRANT ALL ON public.order_item_identifiers TO service_role;

ALTER TABLE public.order_item_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "identifiers owner or admin read" ON public.order_item_identifiers
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.id = order_item_identifiers.order_id
    AND (o.user_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
         OR lower(o.customer_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
));

CREATE POLICY "identifiers admin insert" ON public.order_item_identifiers
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "identifiers admin update" ON public.order_item_identifiers
FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "identifiers admin delete" ON public.order_item_identifiers
FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_oii_updated BEFORE UPDATE ON public.order_item_identifiers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Prevent the same physical device being sold twice
CREATE UNIQUE INDEX uniq_oii_serial ON public.order_item_identifiers (lower(serial_number)) WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE UNIQUE INDEX uniq_oii_imei1 ON public.order_item_identifiers (lower(imei_1)) WHERE imei_1 IS NOT NULL AND imei_1 <> '';
CREATE UNIQUE INDEX uniq_oii_imei2 ON public.order_item_identifiers (lower(imei_2)) WHERE imei_2 IS NOT NULL AND imei_2 <> '';
CREATE INDEX idx_oii_order ON public.order_item_identifiers (order_id);

-- ============ PICKUP CONFIRMATION ON ORDERS ============
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_recipient_name text,
  ADD COLUMN IF NOT EXISTS pickup_picked_up_by text,
  ADD COLUMN IF NOT EXISTS pickup_staff_name text,
  ADD COLUMN IF NOT EXISTS pickup_reference text,
  ADD COLUMN IF NOT EXISTS pickup_signature text,
  ADD COLUMN IF NOT EXISTS delivery_note_number text;

-- ============ REAL ORDER TIMELINE EVENTS ============
CREATE TABLE public.order_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event text NOT NULL,
  note text,
  actor_email text,
  actor_role text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.order_events TO authenticated;
GRANT ALL ON public.order_events TO service_role;

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events owner or admin read" ON public.order_events
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.orders o
  WHERE o.id = order_events.order_id
    AND (o.user_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin')
         OR lower(o.customer_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
));

CREATE POLICY "events admin insert" ON public.order_events
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_order_events_order ON public.order_events (order_id, created_at DESC);