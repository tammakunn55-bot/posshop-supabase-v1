-- ============================================================================
-- SMART POS PRO v1.0.0 — DATABASE SCHEMA (ไฟล์เดียว รันได้ทั้งไฟล์)
-- ----------------------------------------------------------------------------
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- รันซ้ำได้ (idempotent): create ... if not exists / drop policy if exists / create or replace
-- ฟังก์ชัน RPC ที่เปลี่ยน signature จะถูกลบเวอร์ชันเก่าก่อนสร้างใหม่ (ส่วน B ข้อ 4)
--
-- โครงสร้างไฟล์
--   ส่วน A  ตาราง, ฟังก์ชันช่วย RLS, นโยบายสิทธิ์, Storage, audit, ลบข้อมูล
--   ส่วน B  กันแก้สต็อก/หนี้ตรงๆ, RPC ขาย/คืน/รับของ/ปรับสต็อก (idempotent), จำกัดสิทธิ์ execute
--   ส่วน C  งานดูแลรักษา
--
-- *** ยังไม่เคยรันกับ Postgres จริงหลังรวมไฟล์ — ทดสอบบนโปรเจกต์ Supabase ทดลองก่อนเสมอ ***
-- ============================================================================

-- ############################################################################
-- ส่วน A — ตาราง / RLS / Storage / audit
-- ############################################################################

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto; -- ให้ gen_random_uuid() ใช้ได้

-- ----------------------------------------------------------------------------
-- 1. CATEGORIES  (หมวดหมู่สินค้า — รองรับหมวดหมู่ย่อยผ่าน parent_id)
-- ----------------------------------------------------------------------------
-- หมายเหตุ: parent_id เป็นคอลัมน์ใหม่ที่ไม่มีในโค้ด sync เดิม (ฝั่งแอปยังไม่ได้ส่งค่า
-- นี้ขึ้นมา) เพิ่มไว้ให้พร้อมสำหรับฟีเจอร์หมวดหมู่ย่อยที่เพิ่งทำในแอป — ถ้าต้องการให้ค่า
-- นี้ sync ขึ้นมาจริง ต้องแก้ syncProductsToSupabase() ในแอปให้ส่ง parent_id เพิ่ม
create table if not exists categories (
  id            uuid primary key,
  name          text not null,
  icon          text default '📁',
  color         text default '#4F46E5',
  display_order integer default 0,
  parent_id     uuid references categories(id) on delete set null,
  created_at    timestamptz not null default now()
);
-- กัน error "column ... does not exist": ถ้าตาราง categories มีอยู่แล้วจากรอบรันก่อนหน้า
-- (เช่นตอนยังไม่มี parent_id) "create table if not exists" ข้างบนจะไม่สร้างคอลัมน์ใหม่ให้
-- เพราะตารางมีอยู่แล้ว ต้องสั่ง ALTER เพิ่มคอลัมน์ทีละคอลัมน์แบบนี้เสมอสำหรับของที่เพิ่มทีหลัง
alter table categories add column if not exists parent_id     uuid references categories(id) on delete set null;
alter table categories add column if not exists icon          text default '📁';
alter table categories add column if not exists color         text default '#4F46E5';
alter table categories add column if not exists display_order integer default 0;
create index if not exists idx_categories_parent on categories(parent_id);

-- ----------------------------------------------------------------------------
-- 2. PRODUCTS  (สินค้าระดับ "กลุ่ม" — ราคา/ทุน/สต็อกอยู่ที่ product_variants ทั้งหมด
--    products เก็บแค่ข้อมูลระดับ catalog ที่ใช้ร่วมกันทุกไซส์/รุ่น)
-- ----------------------------------------------------------------------------
create table if not exists products (
  id               uuid primary key,
  sku              text unique,
  name             text not null,
  image_url        text,
  min_stock_alert  numeric not null default 5,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table products add column if not exists sku              text;
alter table products add column if not exists image_url        text;
alter table products add column if not exists min_stock_alert  numeric not null default 5;
alter table products add column if not exists is_active        boolean not null default true;
alter table products add column if not exists updated_at       timestamptz not null default now();
create index if not exists idx_products_name on products using gin (to_tsvector('simple', name));
create index if not exists idx_products_active on products(is_active);
-- unique index แบบห่อ exception ไว้: ถ้ามีข้อมูลซ้ำอยู่แล้วในฐานข้อมูลจริง (เช่น SKU ซ้ำจาก
-- การใช้งานเดิม) จะแค่เตือนแล้วข้ามไป ไม่ทำให้ทั้งสคริปต์รันไม่ผ่าน — แต่แทนที่จะแค่บอกให้ไปรันเช็ค
-- เองทีหลัง (ซึ่งมักถูกลืม) บล็อกด้านล่างนี้รันการเช็คให้เลยตอนนี้ทันทีและ RAISE NOTICE ออกมาเป็น
-- รายการ SKU ที่ซ้ำจริงพร้อมจำนวนซ้ำ ให้เห็นในหน้าจอ SQL Editor ทันทีว่าต้องไปแก้อะไรบ้าง
do $$
declare
  v_dup record;
  v_found boolean := false;
begin
  for v_dup in
    select sku, count(*) as n from products where sku is not null group by sku having count(*) > 1
  loop
    v_found := true;
    raise notice 'SKU ซ้ำ: "%" พบ % รายการ — ต้องแก้ให้ไม่ซ้ำก่อนจึงจะสร้าง unique index ได้จริง', v_dup.sku, v_dup.n;
  end loop;
  if v_found then
    raise notice 'สรุป: พบ SKU ซ้ำในตาราง products อย่างน้อย 1 ชุด — ระบบยังไม่มี unique constraint บังคับ SKU จนกว่าจะแก้ข้อมูลซ้ำข้างต้นแล้วรันสคริปต์นี้ซ้ำ';
  end if;
end $$;
do $$ begin
  create unique index idx_products_sku_unique on products(sku) where sku is not null;
exception when unique_violation then
  raise notice 'ข้าม unique index บน products.sku — มี SKU ซ้ำอยู่ในข้อมูลจริง (ดูรายการ SKU ที่ซ้ำใน NOTICE ด้านบน) ต้องแก้ให้ไม่ซ้ำก่อน แล้วรันสคริปต์นี้ใหม่';
when duplicate_table then null;
end $$;

-- ----------------------------------------------------------------------------
-- 3. PRODUCT_CATEGORIES  (จุดเชื่อม many-to-many — 1 สินค้าอยู่ได้หลายหมวดหมู่)
-- ----------------------------------------------------------------------------
create table if not exists product_categories (
  product_id  uuid not null references products(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (product_id, category_id)
);
create index if not exists idx_prodcat_category on product_categories(category_id);

-- ----------------------------------------------------------------------------
-- 4. PRODUCT_VARIANTS  (แต่ละไซส์/สี/รุ่นของสินค้า — ราคา/ทุน/สต็อกอยู่ตรงนี้)
-- ----------------------------------------------------------------------------
create table if not exists product_variants (
  id              uuid primary key,
  product_id      uuid not null references products(id) on delete cascade,
  variant_name    text not null default 'ปกติ',
  barcode         text,
  price           numeric not null default 0 check (price >= 0),
  cost_price      numeric not null default 0 check (cost_price >= 0),
  stock_quantity  numeric not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table product_variants add column if not exists barcode        text;
alter table product_variants add column if not exists cost_price     numeric not null default 0;
alter table product_variants add column if not exists is_active      boolean not null default true;
-- ห่อ exception เหมือนกัน: บาร์โค้ดซ้ำ (เช่น "SKU1570") มักเกิดจากสินค้าหลายชิ้นที่ยังไม่ได้
-- ตั้งบาร์โค้ดจริง แล้วแอปเคยเติมค่า placeholder ซ้ำๆ กันไว้ — ถ้าซ้ำอยู่จริงจะข้ามการบังคับ
-- unique ไปก่อน (ไม่บล็อกการรันสคริปต์) แต่แทนที่จะบอกให้ไปรันเช็คเองทีหลัง บล็อกด้านล่างนี้
-- รันการเช็คให้ทันทีและ RAISE NOTICE รายการบาร์โค้ดที่ซ้ำจริงพร้อมจำนวนซ้ำออกมาให้เห็นเลย
-- (บาร์โค้ดซ้ำมีผลจริงกับหน้าขาย เพราะระบบสแกนอ้างอิงจากบาร์โค้ดเป็นตัวค้นหาสินค้า)
do $$
declare
  v_dup record;
  v_found boolean := false;
begin
  for v_dup in
    select barcode, count(*) as n from product_variants where barcode is not null group by barcode having count(*) > 1
  loop
    v_found := true;
    raise notice 'บาร์โค้ดซ้ำ: "%" พบ % รายการ — สแกนบาร์โค้ดนี้จะได้สินค้าไม่แน่นอนว่าตัวไหน ต้องแก้ก่อน', v_dup.barcode, v_dup.n;
  end loop;
  if v_found then
    raise notice 'สรุป: พบบาร์โค้ดซ้ำในตาราง product_variants อย่างน้อย 1 ชุด — ระบบยังไม่มี unique constraint บังคับบาร์โค้ดจนกว่าจะแก้ข้อมูลซ้ำข้างต้นแล้วรันสคริปต์นี้ซ้ำ';
  end if;
end $$;
do $$ begin
  create unique index idx_variants_barcode on product_variants(barcode) where barcode is not null;
exception when unique_violation then
  raise notice 'ข้าม unique index บน product_variants.barcode — มีบาร์โค้ดซ้ำอยู่ในข้อมูลจริง (ดูรายการที่ซ้ำใน NOTICE ด้านบน) ต้องแก้ให้ไม่ซ้ำก่อน แล้วรันสคริปต์นี้ใหม่';
when duplicate_table then null;
end $$;
create index if not exists idx_variants_product on product_variants(product_id);

-- ----------------------------------------------------------------------------
-- 5. PRODUCT_FRACTIONS  (หน่วยแบ่งขาย เช่น ตัดสายไฟขายเป็นเมตรจากม้วน 100 ม.)
-- ----------------------------------------------------------------------------
-- quantity_ratio = "1 หน่วยที่นับเป็นสต็อกจริง เท่ากับกี่หน่วยแบ่งขายนี้"
-- เช่น ม้วนสายไฟ 100 เมตร ขายปลีกเป็นเมตร -> quantity_ratio = 100
-- ตอนขาย ให้หักสต็อก = quantity_sold / quantity_ratio (ดู create_sale ด้านล่าง)
create table if not exists product_fractions (
  id              uuid primary key,
  variant_id      uuid not null references product_variants(id) on delete cascade,
  fraction_name   text not null,
  quantity_ratio  numeric not null check (quantity_ratio > 0),
  price           numeric not null default 0 check (price >= 0),
  barcode         text
);
alter table product_fractions add column if not exists barcode text;
create index if not exists idx_fractions_variant on product_fractions(variant_id);

-- ----------------------------------------------------------------------------
-- 6. CUSTOMERS  (customers.debt = ยอดหนี้ค้าง เปลี่ยนผ่าน RPC เท่านั้น ดูหมายเหตุการออกแบบข้อ 2)
-- ----------------------------------------------------------------------------
create table if not exists customers (
  id            uuid primary key,
  name          text not null,
  phone         text,
  address       text default '',
  credit_limit  numeric not null default 0,
  debt          numeric not null default 0,
  created_at    timestamptz not null default now()
);
alter table customers add column if not exists phone        text;
alter table customers add column if not exists address      text default '';
alter table customers add column if not exists credit_limit numeric not null default 0;
-- debt = ยอดหนี้ค้างชำระ (เดิมเก็บในเครื่องอย่างเดียว) — เพิ่มขึ้นมาให้ create_sale/process_return
-- บังคับวงเงินเครดิตได้จริงฝั่งเซิร์ฟเวอร์ แทนที่จะพึ่งการเช็คฝั่ง client เพียงอย่างเดียว
-- (ค่าตั้งต้น sync มาจาก db.customers[].debt ที่แอปคำนวณสะสมไว้อยู่แล้ว ดู syncProductsToSupabase)
alter table customers add column if not exists debt          numeric not null default 0;

-- ----------------------------------------------------------------------------
-- 7. SUPPLIERS
-- ----------------------------------------------------------------------------
create table if not exists suppliers (
  id          uuid primary key,
  name        text not null,
  phone       text,
  address     text default '',
  created_at  timestamptz not null default now()
);
alter table suppliers add column if not exists phone   text;
alter table suppliers add column if not exists address text default '';

-- ----------------------------------------------------------------------------
-- 8. APP_USERS  (พนักงาน/เจ้าของร้าน)
-- ----------------------------------------------------------------------------
-- auth_user_id ผูกกับ auth.users จริงสำหรับพนักงาน/เจ้าของร้านที่ผ่านการ "provision" แล้ว —
-- ตั้งแต่มี window.provisionEmployeeAuthAccount ฝั่งแอป ทุก role (ไม่ใช่แค่ OWNER อีกต่อไป) จะได้
-- บัญชี Supabase Auth สังเคราะห์เป็นของตัวเอง (อีเมลปลอมแบบ emp-<id>@pos.local + รหัสผ่านสุ่มที่
-- อุปกรณ์จำไว้ในเครื่อง ไม่เคยส่งขึ้น Supabase) เพื่อให้ is_manager()/is_staff() เช็คตรงกับ
-- "พนักงานที่ล็อกอิน PIN อยู่จริงตอนนี้" แทนที่จะเช็คแค่ session อุปกรณ์ที่ล็อกอินไว้เฉยๆ — ยังคง
-- เป็น NULL ได้สำหรับพนักงานที่ยังไม่เคย provision บนอุปกรณ์ไหนเลย (เช่นเพิ่งสร้างขณะออฟไลน์)
create table if not exists app_users (
  id            uuid primary key,
  auth_user_id  uuid references auth.users(id) on delete set null,
  name          text not null,
  pin           text not null, -- เก็บเฉพาะ SHA-256 hash เท่านั้น ห้ามเก็บเลข PIN ดิบเด็ดขาด
  role          text not null default 'CASHIER' check (role in ('OWNER','MANAGER','CASHIER')),
  permissions   jsonb not null default '[]'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table app_users add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table app_users add column if not exists permissions  jsonb not null default '[]'::jsonb;
alter table app_users add column if not exists is_active    boolean not null default true;
do $$ begin
  create unique index idx_app_users_auth on app_users(auth_user_id) where auth_user_id is not null;
exception when unique_violation then
  raise notice 'ข้าม unique index บน app_users.auth_user_id — มีพนักงานมากกว่า 1 คนผูกกับบัญชี Supabase Auth เดียวกันอยู่ ควรตรวจสอบ';
when duplicate_table then null;
end $$;
do $$ begin
  create unique index idx_app_users_one_owner on app_users((role = 'OWNER')) where role = 'OWNER';
exception when unique_violation then
  raise notice 'ข้าม unique index กัน OWNER ซ้ำ — มี OWNER มากกว่า 1 คนอยู่แล้วในข้อมูลจริง ควรตรวจสอบว่าตั้งใจหรือไม่';
when duplicate_table then null;
end $$;

-- ----------------------------------------------------------------------------
-- 9. SHIFTS  (เปิด-ปิดร้าน / เงินทอนเริ่มต้น-ปิด)
-- ----------------------------------------------------------------------------
create table if not exists shifts (
  id            uuid primary key,
  opened_at     timestamptz not null,
  closed_at     timestamptz,
  opening_cash  numeric not null default 0,
  closing_cash  numeric,
  status        text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_by     uuid references app_users(id),
  closed_by     uuid references app_users(id)
);
alter table shifts add column if not exists opening_cash numeric not null default 0;
alter table shifts add column if not exists closing_cash numeric;
alter table shifts add column if not exists opened_by    uuid references app_users(id);
alter table shifts add column if not exists closed_by    uuid references app_users(id);
create index if not exists idx_shifts_status on shifts(status);

-- ----------------------------------------------------------------------------
-- 10. BILLS  (บิลขาย)
-- ----------------------------------------------------------------------------
create table if not exists bills (
  id                uuid primary key,
  bill_number       text not null unique,
  customer_id       uuid references customers(id),
  user_id           uuid references app_users(id),
  shift_id          uuid references shifts(id),
  subtotal          numeric not null default 0,
  discount_amount   numeric not null default 0,
  tax_amount        numeric not null default 0,
  total             numeric not null default 0,
  payment_method    text not null default 'CASH', -- CASH / TRANSFER / CREDIT (ไม่ได้บังคับด้วย CHECK ตามที่แอปคาดหวัง)
  status            text not null default 'PAID' check (status in ('PAID','CANCELLED')),
  created_at        timestamptz not null default now()
);
alter table bills add column if not exists shift_id        uuid references shifts(id);
alter table bills add column if not exists discount_amount numeric not null default 0;
alter table bills add column if not exists tax_amount      numeric not null default 0;
alter table bills add column if not exists status          text not null default 'PAID';
create index if not exists idx_bills_shift on bills(shift_id);
create index if not exists idx_bills_customer on bills(customer_id);
create index if not exists idx_bills_created on bills(created_at);

-- ----------------------------------------------------------------------------
-- 11. BILL_ITEMS
-- ----------------------------------------------------------------------------
create table if not exists bill_items (
  id            uuid primary key,
  bill_id       uuid not null references bills(id) on delete cascade,
  product_id    uuid references products(id),
  variant_id    uuid references product_variants(id),
  fraction_id   uuid references product_fractions(id),
  item_name     text not null,
  quantity      numeric not null,
  unit_price    numeric not null,
  line_total    numeric not null
);
alter table bill_items add column if not exists fraction_id uuid references product_fractions(id);
create index if not exists idx_bill_items_bill on bill_items(bill_id);

-- ----------------------------------------------------------------------------
-- 12. PURCHASE_ORDERS / PURCHASE_ORDER_ITEMS  (รับสินค้าเข้าคลังจากซัพพลายเออร์)
-- ----------------------------------------------------------------------------
create table if not exists purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  po_number      text,
  supplier_id    uuid references suppliers(id),
  status         text not null default 'ORDERED' check (status in ('ORDERED','RECEIVED','CANCELLED')),
  document_ref   text,
  credit_terms   integer default 30,
  ordered_at     timestamptz not null default now(),
  received_at    timestamptz
);
alter table purchase_orders add column if not exists document_ref text;
alter table purchase_orders add column if not exists credit_terms integer default 30;
alter table purchase_orders add column if not exists received_at  timestamptz;

create table if not exists purchase_order_items (
  id                    uuid primary key default gen_random_uuid(),
  purchase_order_id     uuid not null references purchase_orders(id) on delete cascade,
  product_id            uuid references products(id),
  variant_id            uuid references product_variants(id),
  quantity              numeric not null,
  unit_cost             numeric not null default 0,
  received_quantity     numeric not null default 0
);
alter table purchase_order_items add column if not exists received_quantity numeric not null default 0;

-- ----------------------------------------------------------------------------
-- 13. INVENTORY_MOVEMENTS  (ออดิทสต็อก — เขียนโดย RPC เท่านั้น)
-- ----------------------------------------------------------------------------
create table if not exists inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  variant_id   uuid not null references product_variants(id),
  change_qty   numeric not null,     -- + เข้าสต็อก, - ออกสต็อก
  reason       text not null,        -- 'PURCHASE_RECEIPT', 'SALE', 'ADJUSTMENT', ...
  ref_type     text,                 -- 'purchase_order' / 'bill' / ...
  ref_id       uuid,
  created_at   timestamptz not null default now()
);
alter table inventory_movements add column if not exists ref_type text;
alter table inventory_movements add column if not exists ref_id   uuid;
create index if not exists idx_inv_move_variant on inventory_movements(variant_id);

-- ----------------------------------------------------------------------------
-- 14. CASH_LEDGER  (เงินสดเข้า/ออกลิ้นชักจริง — รับชำระหนี้, คืนเงิน, เงินเข้า/ออกที่บันทึกมือ)
-- ----------------------------------------------------------------------------
-- syncTransactionsToSupabase() ในแอปจะ push เข้าตารางนี้ทั้ง (1) db.cashLedger entries
-- ชนิด 'cash-in-ar' / 'expense-refund' และ (2) รายการเงินเข้า/ออกที่บันทึกมือระหว่างกะ
-- (db.shifts[].movements ชนิด 'IN'/'OUT' แปลงเป็น 'SHIFT_CASH_IN'/'SHIFT_CASH_OUT' ที่นี่)
-- ส่วน 'ACCOUNTS_PAYABLE' ไม่ได้อยู่ในตารางนี้แล้ว — ย้ายไปตาราง accounts_payable (14b)
-- ด้านล่างแทน เพราะเป็นยอดหนี้ค้างจ่าย ไม่ใช่รายการเงินสดเข้า/ออกแบบ income/expense
create table if not exists cash_ledger (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid references shifts(id),
  type         text not null,  -- 'cash-in-ar' / 'expense-refund' / 'SHIFT_CASH_IN' / 'SHIFT_CASH_OUT'
  income       numeric not null default 0,
  expense      numeric not null default 0,
  description  text,
  ref_id       text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_cash_ledger_shift on cash_ledger(shift_id);

-- ----------------------------------------------------------------------------
-- 14b. ACCOUNTS_PAYABLE  (เจ้าหนี้การค้า จากการรับสินค้าเข้าคลัง)
-- ----------------------------------------------------------------------------
-- แยกออกมาจาก cash_ledger โดยเจตนา: รายการนี้คือ "ยอดหนี้ค้างจ่าย" (a balance owed),
-- ไม่ใช่รายการเงินสดเข้า/ออกจริงแบบ income/expense — โครงสร้างต่างกัน (amount/supplier_id/
-- terms/status แทน income/expense/description) เหมือน customers.debt แต่ฝั่งซัพพลายเออร์
-- แทน ตรงกับ db.cashLedger entries ชนิด 'ACCOUNTS_PAYABLE' ที่แอปสร้างตอนรับสินค้าเข้าคลัง
-- (window.confirmReceivePO) — ไม่ยัดรวมเป็นแถวใน cash_ledger เพราะจะไม่มีคอลัมน์ไหนรับ
-- amount/terms/status ได้ตรงความหมายเลย
create table if not exists accounts_payable (
  id                 uuid primary key,
  supplier_id        uuid references suppliers(id),
  purchase_order_id  uuid references purchase_orders(id) on delete set null,
  doc_ref            text,
  amount             numeric not null default 0 check (amount >= 0),
  credit_terms       integer default 30,
  status             text not null default 'OPEN' check (status in ('OPEN','PAID')),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
alter table accounts_payable add column if not exists paid_at timestamptz;
create index if not exists idx_ap_supplier on accounts_payable(supplier_id);
create index if not exists idx_ap_status   on accounts_payable(status);

-- ============================================================================
-- 15. HELPER FUNCTIONS สำหรับ RLS (ใช้ auth.uid() เทียบกับ app_users.auth_user_id)
-- ============================================================================
-- DROP FUNCTION นำหน้าฟังก์ชัน RPC หลักทั้ง 3 ตัวเสมอ: CREATE OR REPLACE ใช้ไม่ได้ถ้า
-- ฟังก์ชันเดิมมี return type ต่างจากที่เขียนใหม่ (เช่นเคยมีเวอร์ชันทดลองที่ return ไม่เหมือนกัน)
-- (ไม่ทำแบบเดียวกันกับ is_staff/is_manager/is_owner ด้านล่าง เพราะ RLS policy อ้างอิงฟังก์ชัน
-- พวกนั้นอยู่ — ถ้า DROP จะพังตอนรันซ้ำครั้งที่สองเพราะมี object อื่นอ้างอิงอยู่ ส่วน RPC 3 ตัวนี้
-- ไม่มีอะไรอ้างอิงอยู่ จึง DROP ได้อย่างปลอดภัย)
-- DROP FUNCTION แบบระบุ signature ตรงๆ อาจไม่ตรงกับของเดิมในฐานข้อมูลจริง 100% (เช่นพารามิเตอร์
-- เดิมเป็นคนละชนิด/มี default อยู่) ทำให้ DROP...IF EXISTS หาไม่เจอ แล้ว CREATE OR REPLACE ชนกับ
-- ของเดิมที่ยังไม่ถูกลบอีกครั้ง — เปลี่ยนมาค้นหาทุก overload ของชื่อฟังก์ชันนี้จาก pg_proc ตรงๆ
-- แล้ว DROP ... CASCADE ทิ้งให้หมดไม่ว่าจะมี signature หน้าตาแบบไหนอยู่ก่อนก็ตาม
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.proname in ('bootstrap_first_owner', 'create_sale', 'receive_purchase_order', 'process_return', 'receive_customer_payment')
      and pg_function_is_visible(p.oid)
  loop
    execute format('drop function if exists %s cascade;', r.sig);
  end loop;
end $$;

create or replace function is_staff() returns boolean
language sql security definer stable as $$
  select exists (select 1 from app_users where auth_user_id = auth.uid() and is_active);
$$;

create or replace function is_manager() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from app_users
    where auth_user_id = auth.uid() and is_active and role in ('OWNER','MANAGER')
  );
$$;

create or replace function is_owner() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from app_users where auth_user_id = auth.uid() and is_active and role = 'OWNER'
  );
$$;

-- my_role(): ให้แอปถามว่าบัญชีที่ล็อกอินเป็นสิทธิ์อะไร (NULL = ยังไม่ผูกกับ app_users) ใช้ตรวจก่อนซิงค์สินค้า
create or replace function my_role() returns text
language sql security definer stable as $$
  select role from app_users where auth_user_id = auth.uid() and is_active limit 1
$$;

-- ============================================================================
-- 16. ROW LEVEL SECURITY
-- ============================================================================
alter table categories           enable row level security;
alter table products             enable row level security;
alter table product_categories   enable row level security;
alter table product_variants     enable row level security;
alter table product_fractions    enable row level security;
alter table customers            enable row level security;
alter table suppliers            enable row level security;
alter table app_users            enable row level security;
alter table shifts               enable row level security;
alter table bills                enable row level security;
alter table bill_items           enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_items enable row level security;
alter table inventory_movements  enable row level security;
alter table cash_ledger          enable row level security;
alter table accounts_payable     enable row level security;

-- พนักงานที่ล็อกอินแล้ว (มีแถวใน app_users) อ่าน/แก้ไขข้อมูลการขายประจำวันได้ทั้งหมด —
-- แคชเชียร์ต้องเปิดร้าน/ขายของ/เพิ่มลูกค้าได้โดยไม่ต้องรอสิทธิ์ manager
-- (drop policy if exists ก่อนสร้างทุกครั้ง เพื่อให้รันสคริปต์นี้ซ้ำได้โดยไม่ error
-- "policy already exists" ถ้าเคยรันผ่านไปแล้วบางส่วนก่อนหน้านี้)
do $$
declare t text;
begin
  foreach t in array array['categories','products','product_categories','product_variants',
                            'product_fractions','customers','shifts','bills','bill_items',
                            'purchase_orders','purchase_order_items','inventory_movements','cash_ledger',
                            'accounts_payable']
  loop
    execute format('drop policy if exists "staff_select_%1$s" on %1$s;', t);
    execute format('drop policy if exists "staff_insert_%1$s" on %1$s;', t);
    execute format('drop policy if exists "staff_update_%1$s" on %1$s;', t);
    execute format('drop policy if exists "manager_delete_%1$s" on %1$s;', t);
    execute format('create policy "staff_select_%1$s" on %1$s for select using (is_staff());', t);
    execute format('create policy "staff_insert_%1$s" on %1$s for insert with check (is_staff());', t);
    execute format('create policy "staff_update_%1$s" on %1$s for update using (is_staff()) with check (is_staff());', t);
    -- ลบข้อมูลจำกัดไว้ที่ manager ขึ้นไปเท่านั้น (กันแคชเชียร์ลบประวัติขาย/สินค้าโดยไม่ตั้งใจ)
    execute format('create policy "manager_delete_%1$s" on %1$s for delete using ((select is_manager()));', t);
  end loop;
end $$;

-- suppliers: เหมือนกลุ่มบนแต่แยกไว้เผื่ออยากจำกัดสิทธิ์ต่างจากกลุ่มขายในอนาคต
drop policy if exists "staff_select_suppliers" on suppliers;
drop policy if exists "manager_write_suppliers" on suppliers;
drop policy if exists "manager_insert_suppliers" on suppliers;
drop policy if exists "manager_update_suppliers" on suppliers;
drop policy if exists "manager_delete_suppliers" on suppliers;
create policy "staff_select_suppliers" on suppliers for select using (is_staff());
create policy "manager_insert_suppliers" on suppliers for insert with check ((select is_manager()));
create policy "manager_update_suppliers" on suppliers for update
  using ((select is_manager())) with check ((select is_manager()));
create policy "manager_delete_suppliers" on suppliers for delete using ((select is_manager()));

-- app_users: พนักงานเห็นได้แค่แถวตัวเอง, manager ขึ้นไปเห็น/แก้ไขได้ทุกคน
drop policy if exists "self_select_app_users" on app_users;
drop policy if exists "manager_write_app_users" on app_users;
drop policy if exists "manager_update_app_users" on app_users;
drop policy if exists "manager_delete_app_users" on app_users;
create policy "self_select_app_users" on app_users for select
  using (auth_user_id = (select auth.uid()) or (select is_manager()));
create policy "manager_write_app_users" on app_users for insert with check ((select is_manager()));
create policy "manager_update_app_users" on app_users for update
  using ((select is_manager())) with check ((select is_manager()));
create policy "manager_delete_app_users" on app_users for delete using ((select is_manager()));

-- ============================================================================
-- 20. STORAGE BUCKETS  (ตรงกับ client.storage.from(...) ที่แอปเรียกใช้จริง)
-- ============================================================================
-- product-images: public=true เพื่อให้ getPublicUrl() ใช้ได้ — on conflict do update บังคับเป็น public เสมอ
-- แม้เคยสร้างไว้เป็น private; จำกัดไฟล์ละไม่เกิน 5 MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('product-images', 'product-images', true, 5242880)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public)
values ('delivery-notes', 'delivery-notes', false)
on conflict (id) do nothing;

-- product-images: bucket เป็น public จึงโหลดรูปผ่าน getPublicUrl() ได้โดยไม่ผ่าน RLS
-- policy select จำกัดเฉพาะพนักงาน (กันคนนอกไล่ดูรายชื่อไฟล์) อัปโหลด/แก้ไข/ลบได้เฉพาะพนักงานที่ล็อกอิน
drop policy if exists "public_read_product_images" on storage.objects;
drop policy if exists "staff_read_product_images" on storage.objects;
drop policy if exists "staff_write_product_images" on storage.objects;
drop policy if exists "staff_update_product_images" on storage.objects;
drop policy if exists "staff_delete_product_images" on storage.objects;
create policy "staff_read_product_images" on storage.objects
  for select using (bucket_id = 'product-images' and is_staff());
create policy "staff_write_product_images" on storage.objects
  for insert with check (bucket_id = 'product-images' and is_staff());
create policy "staff_update_product_images" on storage.objects
  for update using (bucket_id = 'product-images' and is_staff());
create policy "staff_delete_product_images" on storage.objects
  for delete using (bucket_id = 'product-images' and is_staff());

-- delivery-notes: หลักฐานทางบัญชี ไม่เปิดสาธารณะ — พนักงานที่ล็อกอินแล้วอ่าน/อัปโหลด/ลบได้
drop policy if exists "staff_read_delivery_notes" on storage.objects;
drop policy if exists "staff_write_delivery_notes" on storage.objects;
drop policy if exists "staff_delete_delivery_notes" on storage.objects;
create policy "staff_read_delivery_notes" on storage.objects
  for select using (bucket_id = 'delivery-notes' and is_staff());
create policy "staff_write_delivery_notes" on storage.objects
  for insert with check (bucket_id = 'delivery-notes' and is_staff());
create policy "staff_delete_delivery_notes" on storage.objects
  for delete using (bucket_id = 'delivery-notes' and is_staff());

-- ============================================================================
-- หมายเหตุการออกแบบ
-- ============================================================================
-- 1. id ทุกตารางเป็น uuid — แอปแปล id ในเครื่องด้วย toUUID() แบบ deterministic ให้ upsert ตรงแถวเดิมเสมอ
-- 2. customers.debt และ product_variants.stock_quantity เป็นแหล่งความจริงบนเซิร์ฟเวอร์ เปลี่ยนผ่าน RPC เท่านั้น
--    (create_sale / process_return / receive_customer_payment / receive_goods / adjust_stock / seed_*)
--    แอปไม่ push สองคอลัมน์นี้ใน upsert และฝั่ง pull นำค่าจากเซิร์ฟเวอร์ไปเขียนทับค่าในเครื่อง
-- 3. cash_ledger = เงินสดเข้า/ออกลิ้นชัก, accounts_payable = เจ้าหนี้การค้าจากการรับสินค้า
-- 4. categories.parent_id เตรียมไว้สำหรับหมวดย่อย (แอปยังไม่ส่งค่านี้ขึ้นมา)
-- 5. bucket product-images ต้องเป็น public จึงโหลดรูปในแอปได้ (ส่วน 20 บังคับให้เป็น public ทุกครั้งที่รัน)
-- ============================================================================

-- ============================================================================
-- 21. สินค้าหลายขนาด: รหัส (SKU) และรูปภาพแยกตามขนาด
-- ----------------------------------------------------------------------------
-- เดิม product_variants ไม่มีคอลัมน์ sku/image_url ของตัวเอง — ทุกขนาดในสินค้าเดียวกัน
-- ใช้ sku และรูปของ products (สินค้าหลัก) ร่วมกันหมด ทำให้แยกสต็อกแยกรหัสต่อขนาดไม่ได้จริง
-- (กรณี "กระดาษกาวย่น 1 นิ้ว" / "กระดาษกาวย่น 1-1/2 นิ้ว" ที่ร้านใช้คนละรหัสต่อขนาด)
--
-- เพิ่มแบบไม่กระทบของเดิม (additive เท่านั้น): sku/image_url เป็น NULL ได้ — ถ้าเว้นว่างไว้
-- แปลว่าขนาดนั้น "ใช้รหัส/รูปเดียวกับสินค้าหลัก" ตามที่ตั้งใจไว้ ถ้าใส่ค่าแปลว่า "ขนาดนี้มีรหัส/
-- รูปของตัวเอง แยกจากสินค้าหลัก" — sku ไม่บังคับ unique ข้ามทั้งตาราง products+product_variants
-- รวมกัน เพราะ Postgres ทำ unique constraint ข้ามสองตารางไม่ได้ตรงๆ ฝั่งแอปเป็นคนกันไม่ให้ชนกันเอง
-- ============================================================================
alter table product_variants add column if not exists sku text;
alter table product_variants add column if not exists image_url text;
drop index if exists idx_product_variants_sku;
create unique index idx_product_variants_sku on product_variants(sku) where sku is not null;

-- ============================================================================
-- 21b. ลบข้อมูล / ประวัติการใช้งาน (audit) / ป้องกันการแก้สิทธิ์พนักงานฝั่งเซิร์ฟเวอร์
-- ----------------------------------------------------------------------------
-- รันซ้ำได้ปลอดภัย (idempotent) — วางต่อท้าย pos_schema.sql เดิมแล้วรันทั้งไฟล์ หรือรันเฉพาะไฟล์นี้กับฐานข้อมูลที่ติดตั้งไว้แล้วก็ได้
-- แอปต้องอาศัยส่วนนี้: ปุ่มลบ/รวมสินค้าซ้ำ และหน้า "ประวัติการใช้งาน (คลาวด์)" ต้องอาศัยของในไฟล์นี้
-- (เดิมหัวข้อนี้ใช้เลข "21." ซ้ำกับ PATCH ก่อนหน้า — เปลี่ยนเป็น "21b." ตามธรรมเนียมของไฟล์นี้เอง
-- ที่เคยใช้ "14b." มาก่อนแล้ว กันสับสนเวลาอ้างอิงเลขหัวข้อ)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 21.1  คอลัมน์ is_active เพิ่มเติม — ใช้ "เก็บเข้าประวัติ" แทนการลบถาวรเมื่อรายการนั้นมีธุรกรรมผูกอยู่
--       (products / product_variants / app_users มี is_active อยู่แล้วจากไฟล์เดิม)
-- ----------------------------------------------------------------------------
alter table customers        add column if not exists is_active boolean not null default true;
alter table suppliers        add column if not exists is_active boolean not null default true;
alter table product_fractions add column if not exists is_active boolean not null default true;

-- ----------------------------------------------------------------------------
-- 21.2  audit_logs — ประวัติการเข้าใช้และการทำรายการ (เพิ่มได้อย่างเดียว แก้/ลบไม่ได้แม้เป็นเจ้าของร้าน)
--       actor_app_user_id ตั้งใจ "ไม่" ทำ foreign key: กันไม่ให้การลบพนักงานไปแตะประวัติ และประวัติคงอยู่แม้พนักงานถูกลบ
--       received_by = บัญชี Supabase ที่ส่งแถวนี้เข้ามาจริง (เซิร์ฟเวอร์ใส่ให้เอง) — ใช้เทียบกับ actor_name ตอนตรวจสอบ
--       ข้อควรรู้: แอปเป็นผู้ระบุ actor_name เอง (เซิร์ฟเวอร์ไม่รู้ว่าใครกด PIN) จึงเทียบกับ received_by ได้ว่าเครื่อง/บัญชีไหนส่งมา
-- ----------------------------------------------------------------------------
create table if not exists audit_logs (
  id                 uuid primary key,
  occurred_at        timestamptz not null default now(),
  actor_app_user_id  uuid,
  actor_name         text,
  actor_role         text,
  action             text not null,
  entity             text,
  entity_id          text,
  detail             text,
  meta               jsonb,
  device_id          text,
  received_at        timestamptz not null default now(),
  received_by        uuid default auth.uid()
);
create index if not exists idx_audit_occurred on audit_logs(occurred_at desc);
create index if not exists idx_audit_actor    on audit_logs(actor_name, occurred_at desc);
create index if not exists idx_audit_action   on audit_logs(action, occurred_at desc);
create index if not exists idx_audit_entity   on audit_logs(entity, entity_id);

alter table audit_logs enable row level security;
drop policy if exists "staff_insert_audit_logs"   on audit_logs;
drop policy if exists "manager_select_audit_logs" on audit_logs;
create policy "staff_insert_audit_logs"   on audit_logs for insert with check (is_staff());
create policy "manager_select_audit_logs" on audit_logs for select using (is_manager());
-- ไม่มี policy update/delete = ถูกปฏิเสธทุกกรณี; trigger ด้านล่างกันซ้ำอีกชั้น (รวมผู้ใช้ที่ข้าม RLS ได้ และ TRUNCATE)
create or replace function audit_logs_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'audit_logs เป็นประวัติแบบเพิ่มได้อย่างเดียว ห้ามแก้ไข/ลบ';
end;
$$;
drop trigger if exists trg_audit_logs_no_update   on audit_logs;
drop trigger if exists trg_audit_logs_no_truncate on audit_logs;
create trigger trg_audit_logs_no_update   before update or delete on audit_logs for each row       execute function audit_logs_immutable();
create trigger trg_audit_logs_no_truncate before truncate          on audit_logs for each statement execute function audit_logs_immutable();

-- ----------------------------------------------------------------------------
-- 21.3  has_perm(p) — ผู้จัดการ/เจ้าของมีทุกสิทธิ์ แคชเชียร์มีเฉพาะที่เจ้าของติ๊กให้ (app_users.permissions)
-- ----------------------------------------------------------------------------
create or replace function has_perm(p_perm text) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from app_users
    where auth_user_id = auth.uid() and is_active
      and (role in ('OWNER','MANAGER') or coalesce(permissions, '[]'::jsonb) @> to_jsonb(p_perm))
  );
$$;

-- ----------------------------------------------------------------------------
-- 21.5  ป้องกันการแก้ตำแหน่ง/สิทธิ์พนักงานเกินอำนาจ (ฝั่งเซิร์ฟเวอร์ — แอปฝั่งเครื่องแค่ซ่อนปุ่ม ยังไม่พอ)
--       policy เดิมให้ "ผู้จัดการ" เขียนตาราง app_users ได้ทุกแถว รวมถึงแถวเจ้าของร้านและการเลื่อนตำแหน่งตัวเอง
--       กติกา: ผู้จัดการเพิ่ม/แก้/ลบได้เฉพาะบัญชี CASHIER (และห้ามเปลี่ยนใครเป็น MANAGER/OWNER) — เจ้าของทำได้ทุกอย่าง
--       ยกเว้น: ตอนยังไม่มีเจ้าของเลย (bootstrap_first_owner) และคำสั่งที่รันจาก SQL editor / service role (auth.uid() เป็น NULL)
-- ----------------------------------------------------------------------------
create or replace function guard_app_users_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or is_owner() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.role = 'OWNER' and not exists (select 1 from app_users where role = 'OWNER') then return new; end if;
    if new.role <> 'CASHIER' then raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่เพิ่มบัญชีผู้จัดการ/เจ้าของได้'; end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'CASHIER' or new.role <> 'CASHIER' then raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขบัญชีผู้จัดการ/เจ้าของ หรือเปลี่ยนตำแหน่งได้'; end if;
    return new;
  else
    if old.role <> 'CASHIER' then raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่ลบบัญชีผู้จัดการ/เจ้าของได้'; end if;
    return old;
  end if;
end;
$$;
drop trigger if exists trg_guard_app_users on app_users;
create trigger trg_guard_app_users before insert or update or delete on app_users for each row execute function guard_app_users_change();

-- ============================================================================
-- 22. คอลัมน์/นโยบายเสริมสำหรับแอป
-- ============================================================================

-- products.group_name / display_order (จัดกลุ่มและเรียงลำดับสินค้าเอง)
alter table products add column if not exists group_name    text;
alter table products add column if not exists display_order integer default 0;
create index if not exists idx_products_group on products(group_name);

-- delete_entity: ปฏิเสธเมื่อหาผู้เรียกไม่เจอ (กัน NULL ทำให้ข้ามการเช็คสิทธิ์ใน plpgsql)
create or replace function delete_entity(p_kind text, p_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer as $$
declare
  v_mode      text := 'deleted';
  v_has_hist  boolean;
  v_row       record;
  v_me        app_users%rowtype;
  v_tag       text := '#arch-' || left(p_id::text, 8);
begin
  if not is_staff() then
    raise exception 'ต้องเข้าสู่ระบบเป็นพนักงานก่อน';
  end if;
  select * into v_me from app_users where auth_user_id = auth.uid() and is_active limit 1;
  if v_me.id is null then
    raise exception 'ไม่พบบัญชีพนักงานที่ใช้งานอยู่ — กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่';
  end if;

  if p_kind in ('product','variant','fraction','category') then
    if not has_perm('products.delete') then raise exception 'ไม่มีสิทธิ์ลบสินค้า/หมวดหมู่ (products.delete)'; end if;
  elsif p_kind = 'customer' then
    if not has_perm('customers.delete') then raise exception 'ไม่มีสิทธิ์ลบลูกค้า (customers.delete)'; end if;
  elsif p_kind in ('supplier','purchase_order') then
    if not has_perm('suppliers.manage') then raise exception 'ไม่มีสิทธิ์จัดการซัพพลายเออร์/ใบสั่งซื้อ (suppliers.manage)'; end if;
  elsif p_kind = 'employee' then
    if not has_perm('employees.manage') then raise exception 'ไม่มีสิทธิ์จัดการพนักงาน (employees.manage)'; end if;
  else
    raise exception 'ไม่รู้จักชนิดข้อมูลที่จะลบ: %', p_kind;
  end if;

  if p_kind = 'product' then
    if not exists (select 1 from products where id = p_id) then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    v_has_hist :=
         exists (select 1 from bill_items where product_id = p_id)
      or exists (select 1 from purchase_order_items where product_id = p_id)
      or exists (select 1 from inventory_movements m join product_variants v on v.id = m.variant_id where v.product_id = p_id);
    if v_has_hist then
      update products set is_active = false,
             sku = case when sku is null then null when sku like '%#arch-%' then sku else sku || v_tag end
       where id = p_id;
      update product_variants set is_active = false, barcode = null,
             sku = case when sku is null then null when sku like '%#arch-%' then sku else sku || '#arch-' || left(id::text, 8) end
       where product_id = p_id;
      update product_fractions set is_active = false where variant_id in (select id from product_variants where product_id = p_id);
      v_mode := 'archived';
    else
      delete from products where id = p_id;
    end if;

  elsif p_kind = 'variant' then
    if not exists (select 1 from product_variants where id = p_id) then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    v_has_hist :=
         exists (select 1 from bill_items where variant_id = p_id)
      or exists (select 1 from purchase_order_items where variant_id = p_id)
      or exists (select 1 from inventory_movements where variant_id = p_id);
    if v_has_hist then
      update product_variants set is_active = false, barcode = null,
             sku = case when sku is null then null when sku like '%#arch-%' then sku else sku || v_tag end
       where id = p_id;
      update product_fractions set is_active = false where variant_id = p_id;
      v_mode := 'archived';
    else
      delete from product_variants where id = p_id;
    end if;

  elsif p_kind = 'fraction' then
    if not exists (select 1 from product_fractions where id = p_id) then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    if exists (select 1 from bill_items where fraction_id = p_id) then
      update product_fractions set is_active = false where id = p_id;
      v_mode := 'archived';
    else
      delete from product_fractions where id = p_id;
    end if;

  elsif p_kind = 'category' then
    if not exists (select 1 from categories where id = p_id) then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    delete from categories where id = p_id;

  elsif p_kind = 'customer' then
    select * into v_row from customers where id = p_id;
    if not found then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    if coalesce(v_row.debt, 0) > 0 then raise exception 'ลูกค้า "%" ยังมีหนี้ค้าง % บาท — ต้องรับชำระให้หมดก่อนถึงจะลบได้', v_row.name, v_row.debt; end if;
    if exists (select 1 from bills where customer_id = p_id) then
      update customers set is_active = false where id = p_id; v_mode := 'archived';
    else
      delete from customers where id = p_id;
    end if;

  elsif p_kind = 'supplier' then
    if not exists (select 1 from suppliers where id = p_id) then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    if exists (select 1 from purchase_orders where supplier_id = p_id) or exists (select 1 from accounts_payable where supplier_id = p_id) then
      update suppliers set is_active = false where id = p_id; v_mode := 'archived';
    else
      delete from suppliers where id = p_id;
    end if;

  elsif p_kind = 'purchase_order' then
    select * into v_row from purchase_orders where id = p_id;
    if not found then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    if v_row.status = 'RECEIVED' or exists (select 1 from purchase_order_items where purchase_order_id = p_id and coalesce(received_quantity, 0) > 0) then
      raise exception 'ใบสั่งซื้อ % รับสินค้าเข้าคลังแล้ว ลบไม่ได้ (มีประวัติสต็อกผูกอยู่)', v_row.po_number;
    end if;
    delete from purchase_orders where id = p_id;

  elsif p_kind = 'employee' then
    select * into v_row from app_users where id = p_id;
    if not found then return jsonb_build_object('mode','missing','kind',p_kind); end if;
    if v_row.role = 'OWNER' then raise exception 'ลบเจ้าของร้านไม่ได้'; end if;
    if v_row.id = v_me.id then raise exception 'ลบบัญชีของตัวเองไม่ได้'; end if;
    if v_me.role <> 'OWNER' and v_row.role <> 'CASHIER' then raise exception 'ผู้จัดการลบได้เฉพาะบัญชีแคชเชียร์'; end if;
    if exists (select 1 from bills where user_id = p_id) or exists (select 1 from shifts where opened_by = p_id or closed_by = p_id) then
      update app_users set is_active = false where id = p_id; v_mode := 'archived';
    else
      delete from app_users where id = p_id;
    end if;
  end if;

  insert into audit_logs (id, actor_app_user_id, actor_name, actor_role, action, entity, entity_id, detail, meta, device_id)
  values (gen_random_uuid(), v_me.id, v_me.name, v_me.role, 'SERVER_DELETE', p_kind, p_id::text,
          coalesce(p_note, '') || ' → ' || case v_mode when 'archived' then 'เก็บเข้าประวัติ' else 'ลบถาวร' end,
          jsonb_build_object('mode', v_mode), 'server');

  return jsonb_build_object('mode', v_mode, 'kind', p_kind);
end;
$$;

-- audit_logs: เพิ่มแถวตรงได้เฉพาะ manager ขึ้นไป (การเขียนจริงทั้งหมดทำผ่าน RPC แบบ security definer)
drop policy if exists "staff_insert_audit_logs" on audit_logs;
drop policy if exists "manager_insert_audit_logs" on audit_logs;
create policy "manager_insert_audit_logs" on audit_logs for insert with check (is_manager());

-- ซ่อนต้นทุน (cost_price) จากแคชเชียร์ที่ระดับเซิร์ฟเวอร์: ตารางจริงอ่านได้เฉพาะ manager ขึ้นไป
-- ส่วนแคชเชียร์อ่านผ่าน product_variants_view ซึ่งมาส์ก cost_price เป็น NULL
drop policy if exists "staff_select_product_variants" on product_variants;
create policy "manager_select_product_variants" on product_variants for select using (is_manager());

create or replace view product_variants_view as
select
  id, product_id, variant_name, barcode, sku, image_url,
  price,
  case when is_manager() then cost_price else null end as cost_price,
  stock_quantity, is_active, created_at
from product_variants
where is_staff();   -- ผู้ที่ไม่ใช่พนักงานอ่านไม่ได้ (view รันด้วยสิทธิ์เจ้าของจึงข้าม RLS ของตารางจริง)

revoke all on product_variants_view from public, anon;
grant select on product_variants_view to authenticated;

-- product_fractions ไม่มีคอลัมน์ต้นทุน จึงไม่ต้องมาส์ก (policy staff_select_product_fractions ครอบคลุมแล้ว)

-- categories.code: รหัสหมวดหมู่ (ใช้กับไฟล์นำเข้าสินค้า)
alter table categories add column if not exists code text;

-- ############################################################################
-- ส่วน B — ความถูกต้องของยอดและ RPC
-- ############################################################################
-- 0. คอลัมน์/ตารางใหม่ ------------------------------------------------------
-- "seeded" = ค่าตั้งต้นของสต็อก/หนี้ถูกส่งขึ้นเซิร์ฟเวอร์แล้วหรือยัง
-- แถวที่มีอยู่ตอนรัน migration นี้ถือว่า seeded แล้ว (ADD COLUMN default true) แล้วค่อยเปลี่ยน default เป็น false
alter table product_variants add column if not exists stock_seeded boolean not null default true;
alter table product_variants alter column stock_seeded set default false;
alter table customers        add column if not exists debt_seeded  boolean not null default true;
alter table customers        alter column debt_seeded  set default false;
alter table bill_items       add column if not exists returned_qty numeric not null default 0;
alter table inventory_movements add column if not exists op_ref text;
alter table inventory_movements add column if not exists note   text;
alter table cash_ledger      add column if not exists op_ref text;
alter table purchase_orders  add column if not exists client_ref text;
create unique index if not exists idx_inv_move_op_ref    on inventory_movements(op_ref)  where op_ref is not null;
create unique index if not exists idx_cash_ledger_op_ref on cash_ledger(op_ref)          where op_ref is not null;
create unique index if not exists idx_po_client_ref      on purchase_orders(client_ref)  where client_ref is not null;

create table if not exists bill_returns (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,               -- เลขใบลดหนี้ (กันส่งซ้ำ)
  bill_id      uuid not null references bills(id),
  refund_total numeric not null default 0,
  method       text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
alter table bill_returns enable row level security;
drop policy if exists "staff_select_bill_returns" on bill_returns;
create policy "staff_select_bill_returns" on bill_returns for select using (is_staff());

create or replace function pos_schema_version() returns int
language sql stable set search_path = public, pg_temp as $$ select 2 $$;

-- 1. กัน "แก้สต็อก/หนี้ตรงๆ" — ต้องผ่าน RPC เท่านั้น (RPC ตั้ง app.balance_write = on) ----------
-- auth.uid() เป็น NULL (SQL Editor / service role) ผ่านได้เสมอ
create or replace function guard_balance_columns() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.balance_write', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'product_variants' then
    if tg_op = 'INSERT' then
      if coalesce(new.stock_quantity, 0) <> 0 then
        raise exception 'ห้ามตั้งสต็อกตรงๆ — ใช้ seed_variant_stock / adjust_stock / รับสินค้า / ขาย เท่านั้น';
      end if;
    elsif new.stock_quantity is distinct from old.stock_quantity then
      raise exception 'ห้ามแก้ stock_quantity ตรงๆ — ใช้ adjust_stock / รับสินค้า / ขาย / คืนสินค้า เท่านั้น';
    end if;
  elsif tg_table_name = 'customers' then
    if tg_op = 'INSERT' then
      if coalesce(new.debt, 0) <> 0 then
        raise exception 'ห้ามตั้งยอดหนี้ตรงๆ — ใช้ seed_customer_debt / receive_customer_payment / ขายเชื่อ เท่านั้น';
      end if;
    elsif new.debt is distinct from old.debt then
      raise exception 'ห้ามแก้ยอดหนี้ตรงๆ — ใช้ receive_customer_payment / ขายเชื่อ / คืนสินค้า เท่านั้น';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_variant_stock on product_variants;
create trigger trg_guard_variant_stock before insert or update on product_variants
  for each row execute function guard_balance_columns();
drop trigger if exists trg_guard_customer_debt on customers;
create trigger trg_guard_customer_debt before insert or update on customers
  for each row execute function guard_balance_columns();

-- 2. จำกัดสิทธิ์เขียนตรงบนตาราง (ธุรกรรมเขียนผ่าน RPC เท่านั้น) ---------------------------------
do $$
declare t text;
begin
  -- บิล/รายการบิล/ประวัติสต็อก: อ่านได้ แต่ห้ามเขียนตรง (RPC แบบ security definer ข้าม RLS อยู่แล้ว)
  foreach t in array array['bills','bill_items','inventory_movements'] loop
    execute format('drop policy if exists "staff_insert_%1$s" on %1$s;', t);
    execute format('drop policy if exists "staff_update_%1$s" on %1$s;', t);
    execute format('drop policy if exists "manager_delete_%1$s" on %1$s;', t);
  end loop;
  -- ข้อมูลหลัก/บัญชี: เขียนได้เฉพาะ manager ขึ้นไป
  foreach t in array array['categories','products','product_categories','product_variants','product_fractions',
                           'purchase_orders','purchase_order_items','cash_ledger','accounts_payable'] loop
    execute format('drop policy if exists "staff_insert_%1$s" on %1$s;', t);
    execute format('drop policy if exists "staff_update_%1$s" on %1$s;', t);
    execute format('drop policy if exists "manager_insert_%1$s" on %1$s;', t);
    execute format('drop policy if exists "manager_update_%1$s" on %1$s;', t);
    execute format('create policy "manager_insert_%1$s" on %1$s for insert with check ((select is_manager()));', t);
    execute format('create policy "manager_update_%1$s" on %1$s for update using ((select is_manager())) with check ((select is_manager()));', t);
  end loop;
end $$;

-- 3. constraint (NOT VALID = ไม่ตรวจข้อมูลเก่า แต่บังคับกับข้อมูลใหม่) ------------------------
do $$ begin
  alter table bills add constraint bills_payment_method_chk
    check (upper(payment_method) in ('CASH','TRANSFER','CREDIT')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table bill_items add constraint bill_items_qty_pos_chk check (quantity > 0) not valid;
exception when duplicate_object then null; end $$;

-- 4. RPC -----------------------------------------------------------------------------------
-- ลบฟังก์ชันเวอร์ชันเก่าทุก signature ก่อน (ชื่อเดียวกันแต่พารามิเตอร์ต่างกันจะไม่ชนกัน)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('create_sale','process_return','receive_customer_payment','adjust_stock',
                               'bootstrap_first_owner','receive_purchase_order','receive_goods',
                               'seed_variant_stock','seed_customer_debt')
  loop
    execute format('drop function if exists %s cascade;', r.sig);
  end loop;
end $$;

-- 4.1 bootstrap_first_owner — ตรวจรูปแบบ hash + กันแข่งกันสร้าง OWNER
create or replace function bootstrap_first_owner(p_name text, p_pin text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'ต้องเข้าสู่ระบบก่อนตั้งค่าเจ้าของร้าน'; end if;
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 100 then raise exception 'ชื่อเจ้าของร้านไม่ถูกต้อง'; end if;
  if p_pin !~ '^[0-9a-f]{64}$' and p_pin !~ '^pbkdf2\$[0-9]+\$[0-9a-f]+\$[0-9a-f]{64}$' then
    raise exception 'รูปแบบ PIN hash ไม่ถูกต้อง (ห้ามส่ง PIN ดิบ)';
  end if;
  perform pg_advisory_xact_lock(hashtext('bootstrap_first_owner'));
  if exists (select 1 from app_users where role = 'OWNER') then raise exception 'มี OWNER อยู่แล้ว'; end if;
  insert into app_users (id, auth_user_id, name, pin, role, permissions, is_active)
  values (gen_random_uuid(), auth.uid(), btrim(p_name), p_pin, 'OWNER', '["ALL"]'::jsonb, true)
  returning id into new_id;
  return new_id;
end $$;

-- 4.2 create_sale — idempotent ตามเลขบิล; ตรวจส่วนลด/จำนวน/วงเงิน/สต็อก; ล็อกแถวเรียงตาม id (กัน deadlock)
--      p_tax_mode: 'NONE' | 'INCLUDED' (ราคารวม VAT แล้ว: VAT แยกจากยอดที่เก็บจริง) | 'EXCLUDED' (บวก VAT เพิ่ม)
--      bills.tax_amount เก็บจำนวน VAT จริงทุกโหมด (ใช้ยื่น ภ.พ.30)
create or replace function create_sale(
  p_bill_number text, p_customer_id uuid, p_user_id uuid, p_shift_id uuid,
  p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_items jsonb,
  p_allow_negative boolean default false, p_tax_mode text default 'NONE',
  p_expected_total numeric default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing bills%rowtype;  v_bill_id uuid := gen_random_uuid();
  v_subtotal numeric := 0;   v_discount numeric := coalesce(p_discount_amount, 0);
  v_tax numeric := coalesce(p_tax_amount, 0);  v_total numeric;
  v_method text := upper(coalesce(nullif(p_payment_method, ''), 'CASH'));
  v_item jsonb; v_qty numeric; v_price numeric;
  v_variant product_variants%rowtype; v_fraction product_fractions%rowtype;
  v_deduct numeric; v_server_price numeric;
  v_customer customers%rowtype; v_cust_id uuid := p_customer_id;
  v_user_id uuid := p_user_id; v_shift_id uuid := p_shift_id; v_me app_users%rowtype;
begin
  if not is_staff() then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;
  perform set_config('app.balance_write', 'on', true);
  if coalesce(btrim(p_bill_number), '') = '' then raise exception 'ต้องระบุเลขที่บิล'; end if;

  select * into v_existing from bills where bill_number = p_bill_number;
  if found then
    return jsonb_build_object('bill_id', v_existing.id, 'total', v_existing.total, 'duplicate', true);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'บิลต้องมีรายการสินค้าอย่างน้อย 1 รายการ';
  end if;
  if v_method not in ('CASH','TRANSFER','CREDIT') then raise exception 'วิธีชำระเงินไม่ถูกต้อง: %', v_method; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;  v_price := (v_item->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'จำนวนของ "%" ต้องมากกว่า 0', v_item->>'item_name'; end if;
    if v_price is null or v_price < 0 then raise exception 'ราคาของ "%" ไม่ถูกต้อง', v_item->>'item_name'; end if;
    v_subtotal := v_subtotal + v_qty * v_price;
  end loop;
  v_subtotal := round(v_subtotal, 2);
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'ส่วนลด % ไม่ถูกต้อง (ยอดรวมก่อนลด %)', v_discount, v_subtotal;
  end if;
  v_total := round(v_subtotal - v_discount
             + case when upper(coalesce(p_tax_mode, 'NONE')) = 'EXCLUDED' then v_tax else 0 end, 2);

  -- ตัวอ้างอิงที่อาจยังไม่ถูก sync: ไม่ให้บิลล้มเพราะ FK (ลูกค้าเชื่อต้องมีจริงเท่านั้น)
  if v_user_id  is not null and not exists (select 1 from app_users where id = v_user_id)  then v_user_id := null; end if;
  if v_shift_id is not null and not exists (select 1 from shifts    where id = v_shift_id) then v_shift_id := null; end if;
  select * into v_me from app_users where auth_user_id = auth.uid() and is_active limit 1;

  if v_method = 'CREDIT' then
    if v_cust_id is null then raise exception 'ขายเชื่อต้องระบุลูกค้า'; end if;
    select * into v_customer from customers where id = v_cust_id for update;
    if not found then raise exception 'ไม่พบลูกค้าบนเซิร์ฟเวอร์ (ยังไม่ได้ซิงค์ลูกค้า)'; end if;
    if (v_customer.debt + v_total) > v_customer.credit_limit then
      raise exception 'ยอดหนี้รวมจะเกินวงเงินเครดิต (วงเงิน % หนี้เดิม % ยอดนี้ %)',
        v_customer.credit_limit, v_customer.debt, v_total;
    end if;
    update customers set debt = debt + v_total where id = v_cust_id;
  elsif v_cust_id is not null and not exists (select 1 from customers where id = v_cust_id) then
    v_cust_id := null;
  end if;

  -- ล็อก variant ทั้งหมดของบิลเรียงตาม id ก่อน (ป้องกัน deadlock เวลาขายพร้อมกันหลายเครื่อง)
  perform 1 from product_variants
   where id in (select nullif(x->>'variant_id', '')::uuid from jsonb_array_elements(p_items) x
                 where nullif(x->>'variant_id', '') is not null)
   order by id for update;

  insert into bills (id, bill_number, customer_id, user_id, shift_id, subtotal, discount_amount, tax_amount,
                     total, payment_method, status)
  values (v_bill_id, p_bill_number, v_cust_id, v_user_id, v_shift_id, v_subtotal, v_discount, v_tax,
          v_total, v_method, 'PAID');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;  v_price := (v_item->>'unit_price')::numeric;
    insert into bill_items (id, bill_id, product_id, variant_id, fraction_id, item_name, quantity, unit_price, line_total)
    values (gen_random_uuid(), v_bill_id, nullif(v_item->>'product_id', '')::uuid,
            nullif(v_item->>'variant_id', '')::uuid, nullif(v_item->>'fraction_id', '')::uuid,
            coalesce(v_item->>'item_name', '(ไม่ระบุชื่อ)'), v_qty, v_price, v_qty * v_price);

    if nullif(v_item->>'variant_id', '') is not null then
      select * into v_variant from product_variants where id = (v_item->>'variant_id')::uuid;
      if not found then
        raise exception 'ไม่พบสินค้า "%" บนเซิร์ฟเวอร์ (ยังไม่ซิงค์สินค้า หรือถูกลบแล้ว)', v_item->>'item_name';
      end if;
      v_server_price := v_variant.price;
      if nullif(v_item->>'fraction_id', '') is not null then
        select * into v_fraction from product_fractions
         where id = (v_item->>'fraction_id')::uuid and variant_id = v_variant.id;
        if not found then raise exception 'ไม่พบหน่วยแบ่งขายของ "%"', v_item->>'item_name'; end if;
        v_deduct := v_qty / v_fraction.quantity_ratio;
        v_server_price := v_fraction.price;
      else
        v_deduct := v_qty;
      end if;

      if abs(v_price - v_server_price) > 0.005 then   -- ไม่บล็อกการขาย แต่บันทึกร่องรอยไว้ตรวจสอบ
        insert into audit_logs (id, actor_app_user_id, actor_name, actor_role, action, entity, entity_id, detail, device_id)
        values (gen_random_uuid(), v_me.id, v_me.name, v_me.role, 'PRICE_MISMATCH', 'bill', v_bill_id::text,
                format('บิล %s สินค้า %s ขายที่ %s แต่ราคาในระบบ %s', p_bill_number, v_item->>'item_name', v_price, v_server_price),
                'server');
      end if;
      if not p_allow_negative and v_variant.stock_quantity - v_deduct < 0 then
        raise exception 'สินค้า "%" คงเหลือไม่พอ (คงเหลือ % ต้องการ %)',
          v_item->>'item_name', v_variant.stock_quantity, v_deduct;
      end if;
      update product_variants set stock_quantity = stock_quantity - v_deduct where id = v_variant.id;
      insert into inventory_movements (variant_id, change_qty, reason, ref_type, ref_id)
      values (v_variant.id, -v_deduct, 'SALE', 'bill', v_bill_id);
    end if;
  end loop;

  if p_expected_total is not null and abs(p_expected_total - v_total) > 0.05 then
    insert into audit_logs (id, actor_app_user_id, actor_name, actor_role, action, entity, entity_id, detail, device_id)
    values (gen_random_uuid(), v_me.id, v_me.name, v_me.role, 'TOTAL_MISMATCH', 'bill', v_bill_id::text,
            format('บิล %s ยอดจากเครื่อง %s แต่เซิร์ฟเวอร์คำนวณ %s', p_bill_number, p_expected_total, v_total), 'server');
  end if;
  return jsonb_build_object('bill_id', v_bill_id, 'total', v_total, 'duplicate', false);
end $$;

-- 4.3 process_return — ใช้ราคาจากบิลจริง (ไม่เชื่อราคาจากเครื่อง), หักสัดส่วนส่วนลด, กันคืนเกิน, idempotent
create or replace function process_return(
  p_bill_id uuid, p_items jsonb, p_full_return boolean default false,
  p_return_ref text default null, p_shift_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bill bills%rowtype; v_prev bill_returns%rowtype; v_item jsonb; v_bi bill_items%rowtype;
  v_qty numeric; v_variant product_variants%rowtype; v_fraction product_fractions%rowtype;
  v_restock numeric; v_gross numeric := 0; v_factor numeric; v_refund numeric;
  v_all_returned boolean; v_ref text; v_shift uuid := p_shift_id; v_n int := 0;
begin
  if not is_staff() then raise exception 'ไม่มีสิทธิ์บันทึกการคืนสินค้า'; end if;
  perform set_config('app.balance_write', 'on', true);
  if p_return_ref is not null then
    select * into v_prev from bill_returns where ref = p_return_ref;
    if found then return jsonb_build_object('refund_total', v_prev.refund_total, 'duplicate', true); end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ไม่มีรายการคืน';
  end if;

  select * into v_bill from bills where id = p_bill_id for update;
  if not found then raise exception 'ไม่พบบิล id=%', p_bill_id; end if;
  if v_bill.status = 'CANCELLED' then raise exception 'บิล % ถูกคืนครบ/ยกเลิกแล้ว', v_bill.bill_number; end if;
  v_factor := case when v_bill.subtotal > 0
                   then (v_bill.subtotal - v_bill.discount_amount) / v_bill.subtotal else 1 end;
  v_ref := coalesce(p_return_ref, gen_random_uuid()::text);
  if v_shift is not null and not exists (select 1 from shifts where id = v_shift) then v_shift := null; end if;
  if v_shift is null then v_shift := v_bill.shift_id; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'จำนวนคืนต้องมากกว่า 0'; end if;
    select * into v_bi from bill_items
     where bill_id = p_bill_id
       and variant_id  is not distinct from nullif(v_item->>'variant_id', '')::uuid
       and fraction_id is not distinct from nullif(v_item->>'fraction_id', '')::uuid
       and (quantity - returned_qty) >= v_qty
     order by (quantity - returned_qty) desc limit 1 for update;
    if not found then raise exception 'จำนวนที่คืนเกินจำนวนที่ขายไป หรือไม่พบรายการนี้ในบิล'; end if;

    update bill_items set returned_qty = returned_qty + v_qty where id = v_bi.id;
    v_gross := v_gross + v_qty * v_bi.unit_price;

    if v_bi.variant_id is not null then
      select * into v_variant from product_variants where id = v_bi.variant_id for update;
      if found then
        if v_bi.fraction_id is not null then
          select * into v_fraction from product_fractions where id = v_bi.fraction_id;
          v_restock := v_qty / coalesce(v_fraction.quantity_ratio, 1);
        else
          v_restock := v_qty;
        end if;
        update product_variants set stock_quantity = stock_quantity + v_restock where id = v_variant.id;
        v_n := v_n + 1;
        insert into inventory_movements (variant_id, change_qty, reason, ref_type, ref_id, op_ref)
        values (v_variant.id, v_restock, 'RETURN', 'bill', p_bill_id, v_ref || '#' || v_n);
      end if;
    end if;
  end loop;

  v_refund := round(v_gross * v_factor, 2);
  select not exists (select 1 from bill_items where bill_id = p_bill_id and quantity - returned_qty > 0.00005)
    into v_all_returned;
  if v_all_returned then update bills set status = 'CANCELLED' where id = p_bill_id; end if;

  if upper(v_bill.payment_method) = 'CREDIT' and v_bill.customer_id is not null then
    update customers set debt = greatest(0, debt - v_refund) where id = v_bill.customer_id;
  else
    insert into cash_ledger (shift_id, type, income, expense, description, ref_id, op_ref)
    values (v_shift, 'expense-refund', 0, v_refund, 'คืนสินค้าบิล ' || v_bill.bill_number, p_bill_id::text, v_ref);
  end if;
  insert into bill_returns (ref, bill_id, refund_total, method) values (v_ref, p_bill_id, v_refund, v_bill.payment_method);
  return jsonb_build_object('refund_total', v_refund, 'bill_cancelled', v_all_returned, 'duplicate', false);
end $$;

-- 4.4 receive_customer_payment — idempotent ด้วย p_op_ref
create or replace function receive_customer_payment(
  p_customer_id uuid, p_amount numeric, p_shift_id uuid, p_op_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_customer customers%rowtype; v_applied numeric; v_prev cash_ledger%rowtype; v_shift uuid := p_shift_id;
begin
  if not is_staff() then raise exception 'ไม่มีสิทธิ์บันทึกการรับชำระหนี้'; end if;
  perform set_config('app.balance_write', 'on', true);
  if coalesce(p_amount, 0) <= 0 then raise exception 'จำนวนเงินที่รับชำระต้องมากกว่า 0'; end if;
  if p_op_ref is not null then
    select * into v_prev from cash_ledger where op_ref = p_op_ref;
    if found then return jsonb_build_object('applied', v_prev.income, 'duplicate', true); end if;
  end if;
  select * into v_customer from customers where id = p_customer_id for update;
  if not found then raise exception 'ไม่พบลูกค้า id=%', p_customer_id; end if;
  v_applied := least(p_amount, v_customer.debt);
  if v_applied <= 0 then
    return jsonb_build_object('applied', 0, 'remaining_debt', v_customer.debt, 'duplicate', false);
  end if;
  if v_shift is not null and not exists (select 1 from shifts where id = v_shift) then v_shift := null; end if;
  update customers set debt = debt - v_applied where id = p_customer_id;
  insert into cash_ledger (shift_id, type, income, expense, description, ref_id, op_ref)
  values (v_shift, 'cash-in-ar', v_applied, 0, 'รับชำระหนี้จาก ' || v_customer.name, p_customer_id::text, p_op_ref);
  return jsonb_build_object('applied', v_applied, 'remaining_debt', v_customer.debt - v_applied, 'duplicate', false);
end $$;

-- 4.5 adjust_stock — manager ขึ้นไป, idempotent ด้วย p_op_ref, เก็บเหตุผล
create or replace function adjust_stock(
  p_variant_id uuid, p_mode text, p_value numeric, p_reason text default null, p_op_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_variant product_variants%rowtype; v_new numeric; v_change numeric;
begin
  if not is_manager() then raise exception 'เฉพาะผู้จัดการขึ้นไปเท่านั้นที่ปรับจำนวนสต็อกด้วยมือได้'; end if;
  perform set_config('app.balance_write', 'on', true);
  if p_mode not in ('SET', 'DELTA') then raise exception 'p_mode ต้องเป็น SET หรือ DELTA'; end if;
  if p_op_ref is not null and exists (select 1 from inventory_movements where op_ref = p_op_ref) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_variant from product_variants where id = p_variant_id for update;
  if not found then raise exception 'ไม่พบสินค้า variant id=%', p_variant_id; end if;
  v_new := case when p_mode = 'SET' then greatest(0, p_value)
                else greatest(0, v_variant.stock_quantity + p_value) end;
  v_change := v_new - v_variant.stock_quantity;
  update product_variants set stock_quantity = v_new, stock_seeded = true where id = p_variant_id;
  if v_change <> 0 then
    insert into inventory_movements (variant_id, change_qty, reason, ref_type, ref_id, op_ref, note)
    values (p_variant_id, v_change, 'ADJUSTMENT', 'manual', null, p_op_ref, p_reason);
  end if;
  return jsonb_build_object('variant_id', p_variant_id, 'new_stock', v_new, 'change', v_change, 'duplicate', false);
end $$;

-- 4.6 seed_* — ส่งค่าตั้งต้น (ครั้งเดียว) ของสต็อก/หนี้ที่เซิร์ฟเวอร์ยังไม่เคยรู้ ไม่ทับค่าที่ seeded แล้ว
create or replace function seed_variant_stock(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_v product_variants%rowtype; v_applied int := 0; v_qty numeric;
begin
  if not is_manager() then raise exception 'เฉพาะผู้จัดการขึ้นไป'; end if;
  perform set_config('app.balance_write', 'on', true);
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_v from product_variants where id = (v_item->>'variant_id')::uuid for update;
    if found and not v_v.stock_seeded then
      v_qty := greatest(0, coalesce((v_item->>'stock')::numeric, 0));
      update product_variants set stock_quantity = v_qty, stock_seeded = true where id = v_v.id;
      if v_qty <> 0 then
        insert into inventory_movements (variant_id, change_qty, reason, ref_type, note)
        values (v_v.id, v_qty, 'OPENING_BALANCE', 'seed', 'ยอดยกมาจากเครื่องแรกที่ซิงค์');
      end if;
      v_applied := v_applied + 1;
    end if;
  end loop;
  return jsonb_build_object('applied', v_applied);
end $$;

create or replace function seed_customer_debt(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_c customers%rowtype; v_applied int := 0;
begin
  if not is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform set_config('app.balance_write', 'on', true);
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_c from customers where id = (v_item->>'customer_id')::uuid for update;
    if found and not v_c.debt_seeded then
      update customers set debt = greatest(0, coalesce((v_item->>'debt')::numeric, 0)), debt_seeded = true
       where id = v_c.id;
      v_applied := v_applied + 1;
    end if;
  end loop;
  return jsonb_build_object('applied', v_applied);
end $$;

-- 4.7 receive_goods — ใบรับของ + บวกสต็อก + ต้นทุนถัวเฉลี่ย ใน transaction เดียว, idempotent ด้วย p_client_ref
-- p_items: [{product_id, variant_id, quantity, unit_cost}]
create or replace function receive_goods(
  p_client_ref text, p_supplier_id uuid, p_doc_ref text, p_terms integer, p_received_at timestamptz, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_po purchase_orders%rowtype; v_item jsonb; v_variant product_variants%rowtype;
  v_qty numeric; v_cost numeric; v_new_cost numeric; v_sup uuid := p_supplier_id; v_po_id uuid;
begin
  if not is_manager() then raise exception 'ต้องเป็นผู้จัดการขึ้นไปจึงจะรับสินค้าเข้าคลังได้'; end if;
  perform set_config('app.balance_write', 'on', true);
  if coalesce(btrim(p_client_ref), '') = '' then raise exception 'ต้องระบุ client_ref'; end if;
  select * into v_po from purchase_orders where client_ref = p_client_ref;
  if found then return jsonb_build_object('po_id', v_po.id, 'duplicate', true); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ไม่มีรายการรับสินค้า';
  end if;
  if v_sup is not null and not exists (select 1 from suppliers where id = v_sup) then v_sup := null; end if;

  insert into purchase_orders (po_number, supplier_id, status, document_ref, credit_terms, ordered_at, received_at, client_ref)
  values (p_doc_ref, v_sup, 'RECEIVED', p_doc_ref, coalesce(p_terms, 30), coalesce(p_received_at, now()), now(), p_client_ref)
  returning id into v_po_id;

  perform 1 from product_variants
   where id in (select nullif(x->>'variant_id', '')::uuid from jsonb_array_elements(p_items) x
                 where nullif(x->>'variant_id', '') is not null)
   order by id for update;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;  v_cost := coalesce((v_item->>'unit_cost')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'จำนวนรับต้องมากกว่า 0'; end if;
    insert into purchase_order_items (purchase_order_id, product_id, variant_id, quantity, unit_cost, received_quantity)
    values (v_po_id, nullif(v_item->>'product_id', '')::uuid, nullif(v_item->>'variant_id', '')::uuid,
            v_qty, v_cost, v_qty);

    if nullif(v_item->>'variant_id', '') is not null then
      select * into v_variant from product_variants where id = (v_item->>'variant_id')::uuid;
      if not found then raise exception 'ไม่พบสินค้า variant id=%', v_item->>'variant_id'; end if;
      v_new_cost := v_variant.cost_price;
      if v_cost > 0 then
        if v_variant.stock_quantity > 0 then
          v_new_cost := round((v_variant.stock_quantity * v_variant.cost_price + v_qty * v_cost)
                              / (v_variant.stock_quantity + v_qty), 2);
        else
          v_new_cost := v_cost;       -- สต็อกเดิมเป็น 0/ติดลบ: ใช้ต้นทุนล่าสุดตรงๆ
        end if;
      end if;
      update product_variants
         set stock_quantity = stock_quantity + v_qty, cost_price = v_new_cost, stock_seeded = true
       where id = v_variant.id;
      insert into inventory_movements (variant_id, change_qty, reason, ref_type, ref_id)
      values (v_variant.id, v_qty, 'PURCHASE_RECEIPT', 'purchase_order', v_po_id);
    end if;
  end loop;
  return jsonb_build_object('po_id', v_po_id, 'duplicate', false);
end $$;

-- 5. search_path ของ security definer ทุกตัวใน public + จำกัดสิทธิ์ execute ---------------------
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('create_sale','process_return','receive_customer_payment','adjust_stock',
                               'bootstrap_first_owner','receive_purchase_order','receive_goods',
                               'seed_variant_stock','seed_customer_debt','delete_entity',
                               'is_staff','is_manager','is_owner','has_perm','my_role')
  loop
    begin
      execute format('revoke all on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated', r.sig);
    exception when undefined_object then null;   -- ไม่ใช่ Supabase (ไม่มี role anon/authenticated)
    end;
  end loop;
end $$;

-- ############################################################################
-- ส่วน C — งานดูแลรักษา
-- ############################################################################
-- ล้างรูปที่เผลอเก็บเป็น base64/blob ลงตาราง (แอปจะอัปโหลดขึ้น Storage ใหม่ตอนซิงค์)
update products         set image_url = null where image_url ~ '^(data:|blob:)';
update product_variants set image_url = null where image_url ~ '^(data:|blob:)';
