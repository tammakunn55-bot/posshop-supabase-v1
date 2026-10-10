-- SMART POS SUPABASE V4 — CLEAN BASELINE / ONE-RUN INSTALL
-- For a NEW, dedicated Supabase project only. Do not use as an in-place migration on a live database.
-- This is the consolidated source of truth; previous numbered migration files are intentionally not required.
-- Browser code must use the anon/publishable key only. Never put service_role in client-side files.
-- VAT model: VAT-exclusive (added to taxable amount). Fraction multiplier = base-stock units per selling unit.

begin;

-- SMART POS V4 - SINGLE RUN
-- Canonical schema for Supabase/PostgreSQL
-- Fresh-project install. Does NOT use pos_state as source of truth.
-- Browser: Supabase Auth + RLS. No service_role key in client.

create extension if not exists pgcrypto;

-- ============================================================
-- 1) CORE: profiles / stores / members
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  tax_id text,
  phone text,
  email text,
  address text,
  vat_enabled boolean not null default true,
  vat_rate numeric(5,2) not null default 7.00,
  currency text not null default 'THB',
  timezone text not null default 'Asia/Bangkok',
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'cashier' check (role in ('owner','manager','cashier','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index if not exists idx_store_members_user on public.store_members(user_id, active);

-- ============================================================
-- 2) MASTER DATA
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  brand text,
  description text,
  group_name text,
  primary_image_path text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_categories (
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key(product_id, category_id)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  barcode text,
  unit text not null default 'ชิ้น',
  cost numeric(14,4) not null default 0 check(cost >= 0),
  selling_price numeric(14,4) not null default 0 check(selling_price >= 0),
  stock numeric(14,4) not null default 0 check(stock >= 0),
  min_stock numeric(14,4) not null default 0 check(min_stock >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, sku)
);
create unique index if not exists ux_product_variant_barcode_store on public.product_variants(store_id, barcode) where barcode is not null and barcode <> '';
create index if not exists idx_variants_product on public.product_variants(product_id);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  storage_path text not null,
  original_filename text,
  is_primary boolean not null default false,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, storage_path)
);
create index if not exists idx_product_images_product on public.product_images(product_id, is_primary desc, created_at desc);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text,
  name text not null,
  phone text,
  email text,
  tax_id text,
  address text,
  credit_limit numeric(14,2) not null default 0,
  credit_days integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_customers_code_store on public.customers(store_id, code) where code is not null and code <> '';

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text,
  name text not null,
  phone text,
  email text,
  tax_id text,
  address text,
  credit_terms integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_suppliers_code_store on public.suppliers(store_id, code) where code is not null and code <> '';

-- ============================================================
-- 3) INVENTORY / COST
-- ============================================================
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening','purchase','sale','sale_void','refund','adjustment','transfer_in','transfer_out')),
  qty numeric(14,4) not null check(qty <> 0),
  unit_cost numeric(14,4) not null default 0,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_variant_time on public.stock_movements(store_id, variant_id, created_at desc);

create table if not exists public.cost_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  old_cost numeric(14,4) not null default 0,
  new_cost numeric(14,4) not null default 0,
  qty_received numeric(14,4),
  reference_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4) PURCHASE / RECEIVING
-- ============================================================
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_no text not null,
  status text not null default 'draft' check(status in ('draft','ordered','partial','received','cancelled')),
  ordered_at timestamptz,
  expected_at timestamptz,
  supplier_invoice_no text,
  notes text,
  total numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, order_no)
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  ordered_qty numeric(14,4) not null check(ordered_qty > 0),
  received_qty numeric(14,4) not null default 0 check(received_qty >= 0),
  unit_cost numeric(14,4) not null default 0 check(unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.receiving_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  receiving_no text not null,
  supplier_delivery_no text,
  supplier_invoice_no text,
  status text not null default 'posted' check(status in ('draft','posted','void')),
  received_at timestamptz not null default now(),
  total numeric(14,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(store_id, receiving_no)
);

create table if not exists public.receiving_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  receiving_id uuid not null references public.receiving_documents(id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  received_qty numeric(14,4) not null check(received_qty > 0),
  unit_cost numeric(14,4) not null default 0 check(unit_cost >= 0),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5) SALES / PAYMENTS / REFUNDS
-- ============================================================
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  invoice_no text not null,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'completed' check(status in ('draft','completed','void','refunded','partial_refund')),
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  change_amount numeric(14,2) not null default 0,
  payment_status text not null default 'paid' check(payment_status in ('unpaid','partial','paid','credit','reversed')),
  note text,
  idempotency_key text,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, invoice_no)
);
create unique index if not exists ux_sales_idempotency on public.sales(store_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_sales_store_date on public.sales(store_id, sold_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  qty numeric(14,4) not null check(qty > 0),
  unit_price numeric(14,4) not null default 0,
  discount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  unit_cost_at_sale numeric(14,4) not null default 0,
  profit_at_sale numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  fraction_id uuid,
  fraction_name_snapshot text,
  fraction_multiplier_at_sale numeric(14,6),
  fraction_qty_at_sale numeric(14,4),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  method text not null check(method in ('cash','transfer','promptpay','card','credit','other')),
  amount numeric(14,2) not null check(amount >= 0),
  reference_no text,
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  refund_no text not null,
  status text not null default 'completed' check(status in ('completed','void')),
  total numeric(14,2) not null default 0,
  reason text,
  refunded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(store_id, refund_no)
);

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  refund_id uuid not null references public.refunds(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  qty numeric(14,4) not null check(qty > 0),
  unit_price numeric(14,4) not null default 0,
  unit_cost_at_sale numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 6) CASH / SHIFT / AUDIT
-- ============================================================
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cashier_id uuid not null references auth.users(id) on delete restrict,
  opening_cash numeric(14,2) not null default 0,
  closing_cash numeric(14,2),
  expected_cash numeric(14,2),
  difference numeric(14,2),
  status text not null default 'open' check(status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_store_time on public.audit_logs(store_id, created_at desc);

create table if not exists public.error_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7) UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','stores','store_members','categories','products','product_variants','product_images','customers','suppliers','purchase_orders','receiving_documents','sales'] LOOP
    EXECUTE format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    EXECUTE format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- 8) AUTH -> PROFILE
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, phone)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.phone)
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 9) STORE HELPERS
-- ============================================================
create or replace function public.current_store_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select sm.store_id
  from public.store_members sm
  where sm.user_id = auth.uid() and sm.active = true
  order by case sm.role when 'owner' then 1 when 'manager' then 2 else 3 end, sm.created_at
  limit 1
$$;

create or replace function public.current_store_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select sm.role
  from public.store_members sm
  where sm.user_id = auth.uid() and sm.active = true
  order by case sm.role when 'owner' then 1 when 'manager' then 2 else 3 end, sm.created_at
  limit 1
$$;

create or replace function public.is_store_role(p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_store_role() = any(p_roles), false)
$$;

create or replace function public.create_store(p_name text, p_code text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_store uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.stores(name, code, created_by) values(trim(p_name), nullif(trim(p_code),''), auth.uid()) returning id into v_store;
  insert into public.store_members(store_id,user_id,role) values(v_store,auth.uid(),'owner');
  return v_store;
end $$;

create or replace function public.add_store_member(p_user_id uuid, p_role text default 'cashier')
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_store uuid;
begin
  v_store := public.current_store_id();
  if v_store is null or public.current_store_role() not in ('owner','manager') then raise exception 'Not authorized'; end if;
  if p_role not in ('manager','cashier','staff') then raise exception 'Invalid role'; end if;
  insert into public.store_members(store_id,user_id,role,active) values(v_store,p_user_id,p_role,true)
  on conflict(store_id,user_id) do update set role=excluded.role, active=true, updated_at=now();
end $$;

create or replace function public.remove_store_member(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_store_role() <> 'owner' then raise exception 'Only owner can remove members'; end if;
  update public.store_members set active=false, updated_at=now()
  where store_id=public.current_store_id() and user_id=p_user_id and role <> 'owner';
end $$;

-- The final, hardened process_sale_atomic RPC is defined once at the end of this file.

-- ============================================================
-- 11) RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','stores','store_members','categories','products','product_categories','product_variants','product_images','customers','suppliers','stock_movements','cost_history','purchase_orders','purchase_order_items','receiving_documents','receiving_items','sales','sale_items','payments','refunds','refund_items','cash_sessions','audit_logs','error_logs'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
  END LOOP;
END $$;

-- Drop only policies owned by this canonical schema names; avoids OR-combining with legacy policies.
DO $$
DECLARE r record;
BEGIN
  FOR r IN select schemaname,tablename,policyname from pg_policies where schemaname='public' LOOP
    execute format('drop policy if exists %I on public.%I',r.policyname,r.tablename);
  END LOOP;
END $$;

create policy profiles_self on public.profiles for all to authenticated
using(id=auth.uid()) with check(id=auth.uid());

create policy stores_member_select on public.stores for select to authenticated
using(id=public.current_store_id());
create policy stores_owner_update on public.stores for update to authenticated
using(id=public.current_store_id() and public.current_store_role()='owner')
with check(id=public.current_store_id());

create policy members_select on public.store_members for select to authenticated
using(store_id=public.current_store_id());
create policy members_manage on public.store_members for all to authenticated
using(store_id=public.current_store_id() and public.current_store_role() in ('owner','manager'))
with check(store_id=public.current_store_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','products','product_categories','product_variants','product_images','customers','suppliers','stock_movements','cost_history','purchase_orders','purchase_order_items','receiving_documents','receiving_items','sales','sale_items','payments','refunds','refund_items','cash_sessions'] LOOP
    EXECUTE format('create policy %I_store_select on public.%I for select to authenticated using(store_id=public.current_store_id())',t,t);
    EXECUTE format('create policy %I_store_insert on public.%I for insert to authenticated with check(store_id=public.current_store_id())',t,t);
    EXECUTE format('create policy %I_store_update on public.%I for update to authenticated using(store_id=public.current_store_id()) with check(store_id=public.current_store_id())',t,t);
    EXECUTE format('create policy %I_store_delete on public.%I for delete to authenticated using(store_id=public.current_store_id())',t,t);
  END LOOP;
END $$;

create policy audit_select on public.audit_logs for select to authenticated using(store_id=public.current_store_id());
create policy audit_insert on public.audit_logs for insert to authenticated with check(store_id=public.current_store_id() and (actor_id is null or actor_id=auth.uid()));
create policy error_select on public.error_logs for select to authenticated using(store_id=public.current_store_id());
create policy error_insert on public.error_logs for insert to authenticated with check(store_id=public.current_store_id() and (user_id is null or user_id=auth.uid()));

-- ============================================================
-- 12) STORAGE
-- ============================================================
insert into storage.buckets(id,name,public) values('product-images','product-images',false)
on conflict(id) do update set public=false;

create policy product_images_select on storage.objects for select to authenticated
using(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);
create policy product_images_insert on storage.objects for insert to authenticated
with check(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);
create policy product_images_update on storage.objects for update to authenticated
using(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text)
with check(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);
create policy product_images_delete on storage.objects for delete to authenticated
using(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);

-- ============================================================
-- 13) GRANTS
-- ============================================================
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.current_store_id(), public.current_store_role(), public.is_store_role(text[]), public.create_store(text,text), public.add_store_member(uuid,text), public.remove_store_member(uuid) to authenticated;

-- ============================================================
-- 14) COMMENTS / IMPORTANT RULES
-- ============================================================
comment on table public.stores is 'One store/tenant. Data isolation is by store_id + RLS.';
comment on table public.store_members is 'Auth users assigned to a store. Owner/manager/cashier/staff roles.';
comment on table public.product_variants is 'Sellable SKU/barcode/unit and current stock/cost/price.';
comment on table public.stock_movements is 'Immutable inventory ledger. Stock changes must create a movement.';
comment on table public.sale_items is 'Historical sales snapshot. unit_cost_at_sale never changes when current cost changes.';
comment on table public.product_images is 'Metadata for files in Supabase Storage. Storage path is not a permanent signed URL.';
comment on table public.audit_logs is 'Who did what, to which entity, and when.';

-- Legacy public.pos_state is intentionally not used as the source of truth.


-- Stable local IDs used to map existing browser POS identifiers to database UUIDs.
alter table public.categories add column if not exists local_id text;
alter table public.products add column if not exists local_id text;
alter table public.product_variants add column if not exists local_id text;
alter table public.customers add column if not exists local_id text;
alter table public.suppliers add column if not exists local_id text;
create unique index if not exists categories_store_local_id_uq on public.categories(store_id, local_id);
create unique index if not exists products_store_local_id_uq on public.products(store_id, local_id);
create unique index if not exists product_variants_store_local_id_uq on public.product_variants(store_id, local_id);
create unique index if not exists customers_store_local_id_uq on public.customers(store_id, local_id);
create unique index if not exists suppliers_store_local_id_uq on public.suppliers(store_id, local_id);

create table if not exists public.product_fractions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  local_id text,
  fraction_name text not null,
  multiplier numeric(14,6) not null default 1 check(multiplier > 0),
  fraction_price numeric(14,4) not null default 0 check(fraction_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, local_id)
);
create index if not exists idx_product_fractions_variant_active on public.product_fractions(store_id,variant_id,active);
alter table public.sale_items drop constraint if exists sale_items_fraction_id_fkey;
alter table public.sale_items add constraint sale_items_fraction_id_fkey foreign key (fraction_id) references public.product_fractions(id) on delete set null;
alter table public.product_fractions enable row level security;
drop policy if exists product_fractions_store_select on public.product_fractions;
create policy product_fractions_store_select on public.product_fractions for select to authenticated
  using (store_id=public.current_store_id());
drop policy if exists product_fractions_store_insert on public.product_fractions;
create policy product_fractions_store_insert on public.product_fractions for insert to authenticated
  with check (store_id=public.current_store_id() and public.is_store_role(array['owner','manager']));
drop policy if exists product_fractions_store_update on public.product_fractions;
create policy product_fractions_store_update on public.product_fractions for update to authenticated
  using (store_id=public.current_store_id() and public.is_store_role(array['owner','manager']))
  with check (store_id=public.current_store_id() and public.is_store_role(array['owner','manager']));
drop policy if exists product_fractions_store_delete on public.product_fractions;
create policy product_fractions_store_delete on public.product_fractions for delete to authenticated
  using (store_id=public.current_store_id() and public.is_store_role(array['owner','manager']));
grant select,insert,update,delete on public.product_fractions to authenticated;

create or replace function public.get_my_store()
returns table(store_id uuid, store_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select sm.store_id, s.name as store_name, sm.role
  from public.store_members sm
  join public.stores s on s.id = sm.store_id
  where sm.user_id = auth.uid()
    and sm.active = true
    and s.active = true
  order by case sm.role when 'owner' then 1 when 'manager' then 2 else 3 end,
           sm.created_at
  limit 1
$$;
grant execute on function public.get_my_store() to authenticated;

create or replace function public.set_variant_stock(
  p_variant_id uuid,
  p_new_stock numeric,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := public.current_store_id();
  v_variant public.product_variants%rowtype;
  v_delta numeric;
  v_type text;
begin
  if v_store is null then raise exception 'Store session not found'; end if;
  if not public.is_store_role(array['owner','manager']) then raise exception 'Only owner or manager can adjust stock'; end if;
  if p_new_stock is null or p_new_stock < 0 then raise exception 'Stock must be zero or greater'; end if;

  select * into v_variant
  from public.product_variants
  where id = p_variant_id and store_id = v_store
  for update;
  if not found then raise exception 'Product variant not found in current store'; end if;

  v_delta := p_new_stock - v_variant.stock;
  if v_delta = 0 then return v_variant.stock; end if;
  v_type := case when v_variant.stock = 0 and p_new_stock > 0 then 'opening' else 'adjustment' end;

  update public.product_variants
  set stock = p_new_stock, updated_at = now()
  where id = v_variant.id;

  insert into public.stock_movements(
    store_id, variant_id, movement_type, qty, unit_cost, reference_type, note, created_by
  ) values (
    v_store, v_variant.id, v_type, v_delta, v_variant.cost, 'manual_stock_set', nullif(trim(p_note), ''), auth.uid()
  );

  insert into public.audit_logs(store_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_store, auth.uid(), 'STOCK_SET', 'product_variant', v_variant.id::text,
    jsonb_build_object('old_stock', v_variant.stock, 'new_stock', p_new_stock, 'delta', v_delta, 'note', p_note));

  return p_new_stock;
end $$;
grant execute on function public.set_variant_stock(uuid,numeric,text) to authenticated;


-- Sale voids and payment reversals are kept as accounting/audit records; original payments are never deleted.
create table if not exists public.sale_voids (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  void_no text not null,
  reason text,
  reversed_total numeric(14,2) not null default 0 check (reversed_total >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, void_no),
  unique (store_id, sale_id)
);
create table if not exists public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_void_id uuid not null references public.sale_voids(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete set null,
  method text not null check (method in ('cash','transfer','promptpay','card','credit','other')),
  amount numeric(14,2) not null check (amount >= 0),
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists ux_payment_reversals_void_payment
  on public.payment_reversals(store_id, sale_void_id, payment_id) where payment_id is not null;
alter table public.sale_voids enable row level security;
alter table public.payment_reversals enable row level security;
drop policy if exists sale_voids_store_select on public.sale_voids;
create policy sale_voids_store_select on public.sale_voids for select to authenticated
  using (store_id=public.current_store_id());
drop policy if exists payment_reversals_store_select on public.payment_reversals;
create policy payment_reversals_store_select on public.payment_reversals for select to authenticated
  using (store_id=public.current_store_id());
grant select,insert,update,delete on public.sale_voids, public.payment_reversals to authenticated;


create or replace function public.post_receiving_atomic(
  p_receiving_no text,
  p_supplier_id uuid,
  p_items jsonb,
  p_supplier_invoice_no text default null,
  p_supplier_delivery_no text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := public.current_store_id();
  v_receiving uuid;
  v_supplier uuid;
  x jsonb;
  v_variant public.product_variants%rowtype;
  v_qty numeric;
  v_cost numeric;
  v_total numeric := 0;
  v_old_cost numeric;
begin
  if v_store is null then raise exception 'Store session not found'; end if;
  if not public.is_store_role(array['owner','manager']) then raise exception 'Only owner or manager can post receiving'; end if;
  if nullif(trim(p_receiving_no), '') is null then raise exception 'Receiving number is required'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Receiving items must be a JSON array'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Receiving items are required'; end if;

  -- Idempotent retry: never apply the same receiving number twice.
  select id into v_receiving from public.receiving_documents
    where store_id = v_store and receiving_no = trim(p_receiving_no);
  if v_receiving is not null then return v_receiving; end if;

  if p_supplier_id is not null then
    select id into v_supplier from public.suppliers where id=p_supplier_id and store_id=v_store and active=true;
    if v_supplier is null then raise exception 'Supplier not found in current store'; end if;
  end if;

  -- Avoid ambiguous duplicate lines for the same variant in one receiving document.
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    group by e.value->>'variant_id' having count(*) > 1
  ) then raise exception 'Duplicate variant_id in receiving items; combine quantities first'; end if;

  -- Validate and calculate before creating any records.
  for x in select value from jsonb_array_elements(p_items) loop
    select * into v_variant from public.product_variants
      where id=(x->>'variant_id')::uuid and store_id=v_store and active=true for update;
    if not found then raise exception 'Product variant not found: %', x->>'variant_id'; end if;
    v_qty := (x->>'qty')::numeric;
    v_cost := coalesce((x->>'unit_cost')::numeric, v_variant.cost);
    if v_qty is null or v_qty <= 0 then raise exception 'Receiving quantity must be greater than zero'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Unit cost must be zero or greater'; end if;
    v_total := v_total + v_qty * v_cost;
  end loop;

  insert into public.receiving_documents(
    store_id, supplier_id, receiving_no, supplier_delivery_no, supplier_invoice_no,
    status, total, notes, created_by
  ) values (
    v_store, v_supplier, trim(p_receiving_no), nullif(trim(p_supplier_delivery_no), ''),
    nullif(trim(p_supplier_invoice_no), ''), 'posted', round(v_total,2), nullif(trim(p_notes), ''), auth.uid()
  ) returning id into v_receiving;

  for x in select value from jsonb_array_elements(p_items) loop
    select * into v_variant from public.product_variants
      where id=(x->>'variant_id')::uuid and store_id=v_store and active=true for update;
    v_qty := (x->>'qty')::numeric;
    v_cost := coalesce((x->>'unit_cost')::numeric, v_variant.cost);
    v_old_cost := v_variant.cost;

    insert into public.receiving_items(store_id, receiving_id, variant_id, received_qty, unit_cost)
      values(v_store, v_receiving, v_variant.id, v_qty, v_cost);
    update public.product_variants
      set stock=stock+v_qty, cost=v_cost, updated_at=now()
      where id=v_variant.id;
    insert into public.stock_movements(store_id, variant_id, movement_type, qty, unit_cost, reference_type, reference_id, note, created_by)
      values(v_store, v_variant.id, 'purchase', v_qty, v_cost, 'receiving', v_receiving, 'รับสินค้าเข้า '||trim(p_receiving_no), auth.uid());
    insert into public.cost_history(store_id, variant_id, old_cost, new_cost, qty_received, reference_id, created_by)
      values(v_store, v_variant.id, v_old_cost, v_cost, v_qty, v_receiving, auth.uid());
  end loop;

  insert into public.audit_logs(store_id, actor_id, action, entity_type, entity_id, metadata)
    values(v_store, auth.uid(), 'RECEIVING_POSTED', 'receiving', v_receiving::text,
      jsonb_build_object('receiving_no',trim(p_receiving_no),'total',round(v_total,2),'item_count',jsonb_array_length(p_items)));
  return v_receiving;
end $$;

create or replace function public.refund_sale_atomic(
  p_refund_no text,
  p_sale_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_restock boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := public.current_store_id();
  v_refund uuid;
  v_existing_sale uuid;
  v_sale public.sales%rowtype;
  x jsonb;
  v_sale_item public.sale_items%rowtype;
  v_variant public.product_variants%rowtype;
  v_qty numeric;
  v_previously_refunded numeric;
  v_remaining_qty numeric;
  v_previously_refunded_total numeric;
  v_previously_refunded_vat numeric;
  v_line_total numeric;
  v_line_vat numeric;
  v_total numeric := 0;
begin
  if v_store is null then raise exception 'Store session not found'; end if;
  if not public.is_store_role(array['owner','manager']) then raise exception 'Only owner or manager can refund sales'; end if;
  if nullif(trim(p_refund_no), '') is null then raise exception 'Refund number is required'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Refund items must be a JSON array'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Refund items are required'; end if;

  -- A duplicate refund number is a retry, not a second stock addition.
  select id, sale_id into v_refund, v_existing_sale from public.refunds where store_id=v_store and refund_no=trim(p_refund_no);
  if v_refund is not null then
    if v_existing_sale <> p_sale_id then raise exception 'Refund number already belongs to a different sale'; end if;
    return v_refund;
  end if;

  select * into v_sale from public.sales where id=p_sale_id and store_id=v_store for update;
  if not found then raise exception 'Sale not found in current store'; end if;
  if v_sale.status not in ('completed','partial_refund') then raise exception 'Sale is not refundable in its current status'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    group by e.value->>'sale_item_id' having count(*) > 1
  ) then raise exception 'Duplicate sale_item_id in refund items; combine quantities first'; end if;

  -- Validate quantities against sold qty minus all previously completed refunds.
  for x in select value from jsonb_array_elements(p_items) loop
    select * into v_sale_item from public.sale_items
      where id=(x->>'sale_item_id')::uuid and sale_id=v_sale.id and store_id=v_store;
    if not found then raise exception 'Sale item not found on this sale: %', x->>'sale_item_id'; end if;
    v_qty := (x->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Refund quantity must be greater than zero'; end if;
    select coalesce(sum(ri.qty),0),
           coalesce(sum(ri.line_total),0),
           coalesce(sum(ri.vat_amount),0)
      into v_previously_refunded, v_previously_refunded_total, v_previously_refunded_vat
      from public.refund_items ri join public.refunds r on r.id=ri.refund_id
      where ri.sale_item_id=v_sale_item.id and ri.store_id=v_store and r.status='completed';
    v_remaining_qty := v_sale_item.qty - v_previously_refunded;
    if v_qty > v_remaining_qty then
      raise exception 'Refund quantity exceeds remaining sold quantity for item %', v_sale_item.id;
    end if;
    -- Give the final refund the rounding remainder so multiple partial refunds
    -- cannot leave or over-refund a few cents after the full quantity is returned.
    if v_qty = v_remaining_qty then
      v_line_total := round(v_sale_item.line_total - v_previously_refunded_total, 2);
      v_line_vat := round(coalesce(v_sale_item.vat_amount,0) - v_previously_refunded_vat, 2);
    else
      v_line_total := round((v_sale_item.line_total / v_sale_item.qty) * v_qty, 2);
      v_line_vat := round((coalesce(v_sale_item.vat_amount,0) / v_sale_item.qty) * v_qty, 2);
    end if;
    v_total := v_total + v_line_total + v_line_vat;
  end loop;

  insert into public.refunds(store_id, sale_id, refund_no, status, total, reason, created_by)
    values(v_store, v_sale.id, trim(p_refund_no), 'completed', round(v_total,2), nullif(trim(p_reason), ''), auth.uid())
    returning id into v_refund;

  for x in select value from jsonb_array_elements(p_items) loop
    select * into v_sale_item from public.sale_items
      where id=(x->>'sale_item_id')::uuid and sale_id=v_sale.id and store_id=v_store;
    v_qty := (x->>'qty')::numeric;
    select coalesce(sum(ri.qty),0), coalesce(sum(ri.line_total),0), coalesce(sum(ri.vat_amount),0)
      into v_previously_refunded, v_previously_refunded_total, v_previously_refunded_vat
      from public.refund_items ri join public.refunds r on r.id=ri.refund_id
      where ri.sale_item_id=v_sale_item.id and ri.store_id=v_store and r.status='completed';
    v_remaining_qty := v_sale_item.qty - v_previously_refunded;
    if v_qty = v_remaining_qty then
      v_line_total := round(v_sale_item.line_total - v_previously_refunded_total, 2);
      v_line_vat := round(coalesce(v_sale_item.vat_amount,0) - v_previously_refunded_vat, 2);
    else
      v_line_total := round((v_sale_item.line_total / v_sale_item.qty) * v_qty, 2);
      v_line_vat := round((coalesce(v_sale_item.vat_amount,0) / v_sale_item.qty) * v_qty, 2);
    end if;
    insert into public.refund_items(store_id, refund_id, sale_item_id, variant_id, qty, unit_price, unit_cost_at_sale, line_total, vat_amount)
      values(v_store, v_refund, v_sale_item.id, v_sale_item.variant_id, v_qty,
        v_sale_item.unit_price, v_sale_item.unit_cost_at_sale, v_line_total, v_line_vat);

    if coalesce(p_restock, true) then
      select * into v_variant from public.product_variants
        where id=v_sale_item.variant_id and store_id=v_store for update;
      if not found then raise exception 'Product variant missing for returned sale item'; end if;
      update public.product_variants set stock=stock+v_qty, updated_at=now() where id=v_variant.id;
      insert into public.stock_movements(store_id, variant_id, movement_type, qty, unit_cost, reference_type, reference_id, note, created_by)
        values(v_store, v_variant.id, 'refund', v_qty, v_sale_item.unit_cost_at_sale, 'refund', v_refund,
          'คืนสินค้าใบเสร็จ '||v_sale.invoice_no, auth.uid());
    end if;
  end loop;

  update public.sales set status=case when not exists (
      select 1 from public.sale_items si
      where si.store_id=v_store and si.sale_id=v_sale.id
        and coalesce((select sum(ri.qty) from public.refund_items ri
          join public.refunds rr on rr.id=ri.refund_id
          where ri.sale_item_id=si.id and rr.status='completed'),0) < si.qty
    ) then 'refunded' else 'partial_refund' end,
    updated_at=now() where id=v_sale.id;

  insert into public.audit_logs(store_id, actor_id, action, entity_type, entity_id, metadata)
    values(v_store, auth.uid(), 'SALE_REFUNDED', 'sale', v_sale.id::text,
      jsonb_build_object('refund_id',v_refund,'refund_no',trim(p_refund_no),'total',round(v_total,2),'restocked',p_restock));
  return v_refund;
end $$;

create or replace function public.void_sale_atomic(
  p_void_no text,
  p_sale_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := public.current_store_id();
  v_void uuid;
  v_existing_sale uuid;
  v_sale public.sales%rowtype;
  v_item record;
  v_reversed_total numeric(14,2) := 0;
  v_has_payments boolean := false;
begin
  if v_store is null then raise exception 'Store session not found'; end if;
  if not public.is_store_role(array['owner','manager']) then
    raise exception 'Only owner or manager can void a sale';
  end if;
  if nullif(trim(p_void_no), '') is null then raise exception 'Void number is required'; end if;
  if p_sale_id is null then raise exception 'Sale ID is required'; end if;

  -- Lock sale first so two concurrent requests cannot both restore stock.
  select * into v_sale from public.sales
    where id = p_sale_id and store_id = v_store for update;
  if not found then raise exception 'Sale not found in current store'; end if;

  -- Idempotent retry by void number.
  select id, sale_id into v_void, v_existing_sale from public.sale_voids
    where store_id = v_store and void_no = trim(p_void_no);
  if v_void is not null then
    if v_existing_sale <> p_sale_id then
      raise exception 'Void number already belongs to a different sale';
    end if;
    return v_void;
  end if;

  -- If a void already exists for this sale, do not restore stock a second time.
  select id, sale_id into v_void, v_existing_sale from public.sale_voids
    where store_id = v_store and sale_id = p_sale_id;
  if v_void is not null then
    raise exception 'Sale has already been voided with void number %',
      (select sv.void_no from public.sale_voids sv where sv.id = v_void);
  end if;

  if v_sale.status <> 'completed' then
    raise exception 'Only completed sales can be voided; use the refund workflow for refunded or partial-refund sales';
  end if;
  if exists (select 1 from public.refunds r where r.store_id=v_store and r.sale_id=p_sale_id and r.status='completed') then
    raise exception 'Sale has completed refunds and cannot be voided';
  end if;

  select exists(select 1 from public.payments p where p.store_id=v_store and p.sale_id=p_sale_id)
    into v_has_payments;
  select coalesce(sum(p.amount),0)::numeric(14,2) into v_reversed_total
    from public.payments p where p.store_id=v_store and p.sale_id=p_sale_id;

  insert into public.sale_voids(store_id, sale_id, void_no, reason, reversed_total, created_by)
    values(v_store, p_sale_id, trim(p_void_no), nullif(trim(p_reason), ''), v_reversed_total, auth.uid())
    returning id into v_void;

  -- Return every sold quantity to stock and write a matching stock movement.
  for v_item in
    select si.variant_id, si.qty, si.unit_cost_at_sale, si.product_name_snapshot
      from public.sale_items si
      where si.store_id=v_store and si.sale_id=p_sale_id
      order by si.variant_id
  loop
    perform 1 from public.product_variants pv
      where pv.id=v_item.variant_id and pv.store_id=v_store for update;
    if not found then raise exception 'Variant missing while voiding sale'; end if;
    update public.product_variants
      set stock=stock+v_item.qty, updated_at=now()
      where id=v_item.variant_id and store_id=v_store;
    insert into public.stock_movements(
      store_id, variant_id, movement_type, qty, unit_cost,
      reference_type, reference_id, note, created_by
    ) values (
      v_store, v_item.variant_id, 'sale_void', v_item.qty, v_item.unit_cost_at_sale,
      'sale_void', v_void,
      'ยกเลิกบิล '||v_sale.invoice_no||' - '||v_item.product_name_snapshot, auth.uid()
    );
  end loop;

  -- Keep original payments intact; create matching reversal records instead of deleting history.
  insert into public.payment_reversals(
    store_id, sale_void_id, sale_id, payment_id, method, amount, reason, created_by
  )
  select v_store, v_void, p_sale_id, p.id, p.method, p.amount,
    nullif(trim(p_reason), ''), auth.uid()
  from public.payments p
  where p.store_id=v_store and p.sale_id=p_sale_id;

  update public.sales
    set status='void', payment_status=case when v_has_payments then 'reversed' else 'unpaid' end,
        updated_at=now()
    where id=p_sale_id and store_id=v_store;

  insert into public.audit_logs(store_id, actor_id, action, entity_type, entity_id, metadata)
    values(v_store, auth.uid(), 'SALE_VOIDED', 'sale', p_sale_id::text,
      jsonb_build_object('void_id',v_void,'void_no',trim(p_void_no),
        'invoice_no',v_sale.invoice_no,'reversed_total',v_reversed_total,
        'stock_restored',true,'payment_reversal_records',v_has_payments));

  return v_void;
end $$;

create or replace function public.process_sale_atomic(
  p_invoice_no text,
  p_customer_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_taxable numeric,
  p_vat_rate numeric,
  p_vat_amount numeric,
  p_grand_total numeric,
  p_paid_total numeric,
  p_change_amount numeric,
  p_payment_method text default 'cash',
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := public.current_store_id();
  v_sale uuid;
  v_existing_key text;
  x jsonb;
  v_variant public.product_variants%rowtype;
  v_fraction public.product_fractions%rowtype;
  v_fraction_id uuid;
  v_fraction_qty numeric;
  v_multiplier numeric;
  v_expected_qty numeric;
  v_base_price numeric;
  v_qty numeric;
  v_unit_price numeric;
  v_input_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_vat numeric;
  v_cost numeric;
  v_name text;
  v_sku text;
  v_profit numeric;
  v_calc_subtotal numeric := 0;
  v_calc_taxable numeric := 0;
  v_calc_vat numeric := 0;
  v_calc_grand numeric := 0;
  v_vat_allocated numeric := 0;
  v_item_count integer := 0;
  v_item_index integer := 0;
  v_tol numeric := 0.02;
begin
  if v_store is null then raise exception 'Store session not found'; end if;
  if not public.is_store_role(array['owner','manager','cashier']) then raise exception 'Not authorized'; end if;
  if nullif(trim(p_invoice_no), '') is null then raise exception 'Invoice number is required'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Sale items must be a JSON array'; end if;
  v_item_count := jsonb_array_length(p_items);
  if v_item_count = 0 then raise exception 'Sale items are required'; end if;
  if p_subtotal is null or p_subtotal < 0 or p_discount is null or p_discount < 0
     or p_taxable is null or p_taxable < 0 or p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100
     or p_vat_amount is null or p_vat_amount < 0 or p_grand_total is null or p_grand_total < 0
     or p_paid_total is null or p_paid_total < 0 or p_change_amount is null or p_change_amount < 0 then
    raise exception 'Sale totals or VAT rate are invalid';
  end if;
  if p_payment_method not in ('cash','transfer','promptpay','card','credit','other') then
    raise exception 'Unsupported payment method';
  end if;
  if p_paid_total > p_grand_total + v_tol then raise exception 'Paid total cannot exceed grand total'; end if;
  if p_discount > p_subtotal + v_tol then raise exception 'Bill discount cannot exceed subtotal'; end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.store_id = v_store
  ) then raise exception 'Customer does not belong to the current store'; end if;

  -- Serialize retries by idempotency key and invoice number before validating a retry payload.
  if nullif(trim(p_idempotency_key), '') is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_store::text || ':sale-key:' || trim(p_idempotency_key), 0));
    select id into v_sale from public.sales
      where store_id = v_store and idempotency_key = trim(p_idempotency_key);
    if v_sale is not null then return v_sale; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_store::text || ':sale-invoice:' || trim(p_invoice_no), 0));
  select id, idempotency_key into v_sale, v_existing_key from public.sales
    where store_id = v_store and invoice_no = trim(p_invoice_no);
  if v_sale is not null then
    if nullif(trim(p_idempotency_key), '') is not null and v_existing_key = trim(p_idempotency_key) then return v_sale; end if;
    raise exception 'Invoice number already exists: %', trim(p_invoice_no);
  end if;

  -- Validate all item prices against the server-side variant price and derive subtotal.
  -- Client-provided prices differing by more than 0.01 are rejected; actual stored price is server-side.
  for x in
    select e.value from jsonb_array_elements(p_items) as e(value)
    order by (e.value->>'variant_id')
  loop
    if nullif(x->>'variant_id','') is null then raise exception 'Each sale item requires variant_id'; end if;
    v_qty := (x->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    v_discount := coalesce((x->>'discount')::numeric, 0);
    if v_discount < 0 then raise exception 'Item discount cannot be negative'; end if;
    select * into v_variant from public.product_variants
      where id = (x->>'variant_id')::uuid and store_id = v_store and active = true
      for update;
    if not found then raise exception 'Product variant not found: %', x->>'variant_id'; end if;
    v_fraction_id := nullif(x->>'fraction_id','')::uuid;
    if v_fraction_id is not null then
      select * into v_fraction from public.product_fractions
      where id=v_fraction_id and store_id=v_store and variant_id=v_variant.id and active=true
      for share;
      if not found then raise exception 'Fraction unit not found or inactive for SKU %',v_variant.sku; end if;
      v_fraction_qty := (x->>'fraction_qty')::numeric;
      v_multiplier := (x->>'fraction_multiplier')::numeric;
      if v_fraction_qty is null or v_fraction_qty<=0 then raise exception 'Invalid fraction quantity'; end if;
      if v_multiplier is null or v_multiplier<=0 or abs(v_multiplier-v_fraction.multiplier)>0.000001 then
        raise exception 'Fraction multiplier mismatch for %',v_fraction.fraction_name;
      end if;
      v_expected_qty := round(v_fraction_qty*v_fraction.multiplier,4);
      if abs(v_qty-v_expected_qty)>0.000001 then raise exception 'Base quantity mismatch for fraction %',v_fraction.fraction_name; end if;
      v_base_price := v_fraction.fraction_price/v_fraction.multiplier;
    else
      v_fraction_qty := null;
      v_multiplier := 1;
      v_base_price := v_variant.selling_price;
    end if;
    v_input_price := coalesce((x->>'unit_price')::numeric, v_base_price);
    if abs(v_input_price-v_base_price)>0.01 then
      raise exception 'Price mismatch for SKU %. Refresh product/fraction price before sale.',v_variant.sku;
    end if;
    if v_discount>(case when v_fraction_id is not null then v_fraction_qty*v_fraction.fraction_price else v_qty*v_base_price end) then
      raise exception 'Item discount exceeds line value for SKU %',v_variant.sku;
    end if;
    v_calc_subtotal := v_calc_subtotal+round((case when v_fraction_id is not null then v_fraction_qty*v_fraction.fraction_price else v_qty*v_base_price end)-v_discount,2);
  end loop;
  v_calc_subtotal := round(v_calc_subtotal, 2);
  if abs(p_subtotal - v_calc_subtotal) > v_tol then
    raise exception 'Subtotal mismatch: expected %, received %', v_calc_subtotal, p_subtotal;
  end if;
  v_calc_taxable := round(v_calc_subtotal - p_discount, 2);
  if abs(p_taxable - v_calc_taxable) > v_tol then
    raise exception 'Taxable amount mismatch: expected %, received %', v_calc_taxable, p_taxable;
  end if;
  v_calc_vat := round(v_calc_taxable * p_vat_rate / 100, 2);
  if abs(p_vat_amount - v_calc_vat) > v_tol then
    raise exception 'VAT mismatch: expected %, received %', v_calc_vat, p_vat_amount;
  end if;
  v_calc_grand := round(v_calc_taxable + v_calc_vat, 2);
  if abs(p_grand_total - v_calc_grand) > v_tol then
    raise exception 'Grand total mismatch: expected %, received %', v_calc_grand, p_grand_total;
  end if;

  insert into public.sales(
    store_id, invoice_no, customer_id, cashier_id, subtotal, discount, taxable_amount,
    vat_rate, vat_amount, grand_total, paid_total, change_amount, payment_status, idempotency_key
  ) values (
    v_store, trim(p_invoice_no), p_customer_id, auth.uid(), v_calc_subtotal, round(p_discount,2),
    v_calc_taxable, p_vat_rate, v_calc_vat, v_calc_grand, p_paid_total, p_change_amount,
    case when p_payment_method = 'credit' then 'credit'
         when p_paid_total >= v_calc_grand then 'paid'
         when p_paid_total > 0 then 'partial' else 'unpaid' end,
    nullif(trim(p_idempotency_key), '')
  ) returning id into v_sale;

  v_item_index := 0;
  v_vat_allocated := 0;
  for x in
    select e.value from jsonb_array_elements(p_items) as e(value)
    order by (e.value->>'variant_id')
  loop
    v_item_index := v_item_index + 1;
    select * into v_variant from public.product_variants
      where id = (x->>'variant_id')::uuid and store_id = v_store and active = true for update;
    if not found then raise exception 'Product variant not found: %', x->>'variant_id'; end if;
    v_qty := (x->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    if v_variant.stock < v_qty then raise exception 'Insufficient stock for SKU %', v_variant.sku; end if;
    v_fraction_id := nullif(x->>'fraction_id','')::uuid;
    if v_fraction_id is not null then
      select * into v_fraction from public.product_fractions
      where id=v_fraction_id and store_id=v_store and variant_id=v_variant.id and active=true
      for share;
      if not found then raise exception 'Fraction unit not found or inactive for SKU %',v_variant.sku; end if;
      v_fraction_qty := (x->>'fraction_qty')::numeric;
      v_multiplier := (x->>'fraction_multiplier')::numeric;
      if v_fraction_qty is null or v_fraction_qty<=0 or v_multiplier is null or v_multiplier<=0
         or abs(v_multiplier-v_fraction.multiplier)>0.000001
         or abs(v_qty-round(v_fraction_qty*v_fraction.multiplier,4))>0.000001 then
        raise exception 'Invalid fraction quantity/multiplier for SKU %',v_variant.sku;
      end if;
      v_unit_price := v_fraction.fraction_price/v_fraction.multiplier;
    else
      v_fraction_qty := null; v_multiplier := 1;
      v_unit_price := v_variant.selling_price;
    end if;
    v_discount := coalesce((x->>'discount')::numeric, 0);
    if v_discount < 0 or v_discount > (case when v_fraction_id is not null then v_fraction_qty*v_fraction.fraction_price else v_qty*v_unit_price end) then raise exception 'Invalid discount for SKU %', v_variant.sku; end if;
    v_line_total := round((case when v_fraction_id is not null then v_fraction_qty*v_fraction.fraction_price else v_qty*v_unit_price end) - v_discount, 2);

    -- Allocate the invoice VAT proportionally across lines; final line receives rounding remainder.
    if v_item_index = v_item_count then
      v_vat := round(v_calc_vat - v_vat_allocated, 2);
    elsif v_calc_subtotal > 0 then
      v_vat := round(v_calc_vat * v_line_total / v_calc_subtotal, 2);
      v_vat_allocated := v_vat_allocated + v_vat;
    else
      v_vat := 0;
    end if;

    select p.name into v_name from public.products p where p.id = v_variant.product_id and p.store_id = v_store;
    v_sku := v_variant.sku;
    v_cost := v_variant.cost;
    v_profit := round(v_line_total - (v_qty * v_cost), 2);
    insert into public.sale_items(
      store_id, sale_id, variant_id, product_name_snapshot, sku_snapshot, qty, unit_price,
      discount, vat_rate, vat_amount, unit_cost_at_sale, profit_at_sale, line_total,
      fraction_id, fraction_name_snapshot, fraction_multiplier_at_sale, fraction_qty_at_sale
    ) values (
      v_store, v_sale, v_variant.id, v_name, v_sku, v_qty, v_unit_price,
      v_discount, p_vat_rate, v_vat, v_cost, v_profit, v_line_total,
      v_fraction_id, case when v_fraction_id is not null then v_fraction.fraction_name else null end,
      case when v_fraction_id is not null then v_multiplier else null end, v_fraction_qty
    );
    update public.product_variants set stock = stock - v_qty, updated_at = now()
      where id = v_variant.id and store_id = v_store;
    insert into public.stock_movements(
      store_id, variant_id, movement_type, qty, unit_cost, reference_type, reference_id, created_by
    ) values (v_store, v_variant.id, 'sale', -v_qty, v_cost, 'sale', v_sale, auth.uid());
  end loop;

  insert into public.payments(store_id, sale_id, customer_id, method, amount, created_by)
    values(v_store, v_sale, p_customer_id, p_payment_method, p_paid_total, auth.uid());
  insert into public.audit_logs(store_id, actor_id, action, entity_type, entity_id, metadata)
    values(v_store, auth.uid(), 'SALE_COMPLETED', 'sale', v_sale::text,
      jsonb_build_object('invoice_no', trim(p_invoice_no), 'total', v_calc_grand,
        'idempotency_key', nullif(trim(p_idempotency_key), '')));
  return v_sale;
end $$;


-- Explicit privileges for objects created after the canonical grants section.
grant execute on function public.post_receiving_atomic(text,uuid,jsonb,text,text,text) to authenticated;
grant execute on function public.refund_sale_atomic(text,uuid,jsonb,text,boolean) to authenticated;
grant execute on function public.void_sale_atomic(text,uuid,text) to authenticated;
grant execute on function public.process_sale_atomic(text,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to authenticated;

comment on function public.process_sale_atomic(text,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) is
  'Atomically records sales using server-side prices, validates totals, serializes retries, locks stock and supports fraction units.';
comment on function public.post_receiving_atomic(text,uuid,jsonb,text,text,text) is
  'Atomically posts receiving documents, updates stock and cost history, and records stock movements.';
comment on function public.refund_sale_atomic(text,uuid,jsonb,text,boolean) is
  'Atomically records refunds, prevents over-refunding, optionally restocks and records stock movements.';
comment on function public.void_sale_atomic(text,uuid,text) is
  'Voids a completed sale, restores stock and records payment reversal audit rows without deleting original payments.';

commit;
