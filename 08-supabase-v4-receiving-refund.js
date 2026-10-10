/* Smart POS V4 receiving/refund adapter. Load after 04-supabase.js and SQL migrations. */
(() => {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const client = () => {
    if (typeof window.getSupabaseClient !== 'function') throw new Error('getSupabaseClient() ไม่พร้อม');
    const c = window.getSupabaseClient();
    if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL/anon key');
    return c;
  };
  async function authClient() {
    const c = client();
    const { data, error } = await c.auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error('กรุณาเข้าสู่ระบบ Supabase ก่อนดำเนินการ');
    return c;
  }
  async function storeId(c) {
    const { data, error } = await c.rpc('get_my_store');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.store_id) throw new Error('บัญชีนี้ยังไม่มีร้านที่เปิดใช้งาน');
    return row.store_id;
  }
  async function resolveVariant(c, sid, key) {
    const value = String(key ?? '').trim();
    if (!value) throw new Error('รายการสินค้าไม่มี variant_id');
    const cols = UUID.test(value) ? ['id'] : ['local_id', 'sku', 'barcode'];
    for (const col of cols) {
      let q = c.from('product_variants').select('id').eq('store_id', sid).limit(1);
      const { data, error } = await q.eq(col, value);
      if (error) throw error;
      if (data?.length) return data[0].id;
    }
    throw new Error(`ไม่พบรุ่นสินค้า ${value} ในร้านปัจจุบัน`);
  }
  async function resolveSupplier(c, sid, raw) {
    if (!raw) return null;
    const value = String(raw).trim();
    for (const col of (UUID.test(value) ? ['id'] : ['local_id', 'code'])) {
      const { data, error } = await c.from('suppliers').select('id').eq('store_id', sid).eq(col, value).limit(1);
      if (error) throw error;
      if (data?.length) return data[0].id;
    }
    throw new Error(`ไม่พบซัพพลายเออร์ ${value} ในร้านปัจจุบัน`);
  }
  window.postSupabaseReceiving = async function(input) {
    if (!input || typeof input !== 'object') throw new Error('ข้อมูลรับสินค้าไม่ถูกต้อง');
    const c = await authClient(), sid = await storeId(c);
    const number = String(input.receiving_no ?? input.receivingNo ?? input.id ?? '').trim();
    if (!number) throw new Error('กรุณาระบุเลขที่ใบรับสินค้า');
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('กรุณาระบุรายการสินค้าที่รับ');
    const items = [];
    for (const item of input.items) {
      const key = item.variant_id ?? item.variantId ?? item.local_variant_id ?? item.sku ?? item.barcode;
      const qty = Number(item.qty ?? item.quantity ?? item.received_qty);
      const cost = Number(item.unit_cost ?? item.cost ?? item.price ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('จำนวนรับสินค้าต้องมากกว่า 0');
      if (!Number.isFinite(cost) || cost < 0) throw new Error('ต้นทุนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      items.push({ variant_id: await resolveVariant(c, sid, key), qty, unit_cost: cost });
    }
    const supplierId = await resolveSupplier(c, sid, input.supplier_id ?? input.supplierId ?? input.supplier?.id);
    const { data, error } = await c.rpc('post_receiving_atomic', {
      p_receiving_no: number, p_supplier_id: supplierId, p_items: items,
      p_supplier_invoice_no: input.supplier_invoice_no ?? input.supplierInvoiceNo ?? null,
      p_supplier_delivery_no: input.supplier_delivery_no ?? input.supplierDeliveryNo ?? null,
      p_notes: input.notes ?? input.note ?? null
    });
    if (error) throw error;
    if (!data) throw new Error('Supabase ไม่คืนรหัสใบรับสินค้า');
    return { ok: true, receiving_id: data, receiving_no: number };
  };
  window.refundSupabaseSale = async function(input) {
    if (!input || typeof input !== 'object') throw new Error('ข้อมูลคืนสินค้าไม่ถูกต้อง');
    const c = await authClient();
    const number = String(input.refund_no ?? input.refundNo ?? input.id ?? '').trim();
    const saleId = String(input.sale_id ?? input.saleId ?? '').trim();
    if (!number) throw new Error('กรุณาระบุเลขที่ใบคืนสินค้า');
    if (!UUID.test(saleId)) throw new Error('sale_id ต้องเป็น UUID ของรายการขายใน Supabase');
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('กรุณาระบุรายการคืนสินค้า');
    const items = input.items.map(item => {
      const saleItemId = String(item.sale_item_id ?? item.saleItemId ?? '').trim();
      const qty = Number(item.qty ?? item.quantity);
      if (!UUID.test(saleItemId)) throw new Error('sale_item_id ต้องเป็น UUID ของรายการขาย');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('จำนวนคืนสินค้าต้องมากกว่า 0');
      return { sale_item_id: saleItemId, qty };
    });
    const { data, error } = await c.rpc('refund_sale_atomic', {
      p_refund_no: number, p_sale_id: saleId, p_items: items,
      p_reason: input.reason ?? input.note ?? null,
      p_restock: input.restock !== false
    });
    if (error) throw error;
    if (!data) throw new Error('Supabase ไม่คืนรหัสใบคืนสินค้า');
    return { ok: true, refund_id: data, refund_no: number };
  };
})();
