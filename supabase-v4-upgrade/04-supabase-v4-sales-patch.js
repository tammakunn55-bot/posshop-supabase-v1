/* Smart POS V4 sales adapter — load AFTER 04-supabase.js.
 * Compatible with the actual processPaymentRequest payload in 01-core.js:
 * bill_id, idempotency_key, payment_method, customer_id, received, change, items[].
 * Server SQL remains the source of truth for stock and sale rows.
 */
(() => {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const first = (...xs) => xs.find(x => x !== undefined && x !== null && x !== '');
  const num = (x, fallback = 0) => { const n = Number(x); return Number.isFinite(n) ? n : fallback; };
  const arr = x => Array.isArray(x) ? x : [];
  const round2 = n => Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const getClient = () => {
    if (typeof window.getSupabaseClient !== 'function') throw new Error('getSupabaseClient() ไม่พร้อม');
    const c = window.getSupabaseClient();
    if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL/anon key');
    return c;
  };
  async function currentStoreId(c) {
    const { data, error } = await c.rpc('get_my_store');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.store_id) throw new Error('บัญชีนี้ยังไม่มีร้านที่เปิดใช้งาน');
    return row.store_id;
  }
  function localVariantKey(item) {
    return String(first(item?.variant_id, item?.variantId, item?.product_variant_id,
      item?.productVariantId, item?.variant?.id, item?.variant?.local_id,
      item?.local_variant_id, item?.localVariantId, '')).trim();
  }
  function localFractionKey(item) {
    return String(first(item?.fractionId, item?.fraction_id, item?.fraction?.id, '')).trim();
  }
  async function resolveVariants(c, storeId, rawItems) {
    const keys = [...new Set(rawItems.map(localVariantKey).filter(Boolean))];
    if (!keys.length || rawItems.some(x => !localVariantKey(x))) {
      throw new Error('รายการขายบางรายการไม่มี variant_id/variantId ที่ระบุรุ่นสินค้า');
    }
    const resolved = new Map();
    const uuidKeys = keys.filter(k => UUID.test(k));
    const localKeys = keys.filter(k => !UUID.test(k));
    const fetchRows = async (column, values) => {
      if (!values.length) return;
      const { data, error } = await c.from('product_variants')
        .select('id,local_id,sku,product_id,cost,selling_price,stock,unit')
        .eq('store_id', storeId).in(column, values);
      if (error) throw error;
      for (const row of data || []) {
        resolved.set(row.id, row);
        if (row.local_id) resolved.set(row.local_id, row);
        if (row.sku) resolved.set(row.sku, row);
      }
    };
    await fetchRows('id', uuidKeys);
    await fetchRows('local_id', localKeys);
    const missingSku = localKeys.filter(k => !resolved.has(k));
    await fetchRows('sku', missingSku);

    const fractionKeys = [...new Set(rawItems.map(localFractionKey).filter(Boolean))];
    const fractionMap = new Map();
    const fetchFractions = async (column, values) => {
      if (!values.length) return;
      const { data, error } = await c.from('product_fractions')
        .select('id,local_id,variant_id,fraction_name,multiplier,fraction_price,active')
        .eq('store_id', storeId).eq('active', true).in(column, values);
      if (error) throw error;
      for (const f of data || []) { fractionMap.set(f.id, f); if (f.local_id) fractionMap.set(f.local_id, f); }
    };
    await fetchFractions('id', fractionKeys.filter(k => UUID.test(k)));
    await fetchFractions('local_id', fractionKeys.filter(k => !UUID.test(k)));

    return rawItems.map((item, i) => {
      const key = localVariantKey(item), row = resolved.get(key);
      if (!row) throw new Error(`ไม่พบรุ่นสินค้าใน Supabase สำหรับรายการที่ ${i + 1} (รหัส ${key}) กรุณาซิงค์สินค้าก่อนขาย`);
      const qty = num(first(item.qty, item.quantity), 0);
      if (qty <= 0) throw new Error(`จำนวนสินค้าในรายการที่ ${i + 1} ต้องมากกว่า 0`);
      const fractionKey = localFractionKey(item);
      let fraction = null, multiplier = 1, unitPrice, sellingQty, sellingLineTotal, fractionQty = null;
      if (fractionKey) {
        fraction = fractionMap.get(fractionKey);
        if (!fraction) throw new Error(`ไม่พบหน่วยแบ่งขายสำหรับรายการที่ ${i + 1} กรุณาซิงค์หน่วยย่อยก่อนขาย`);
        if (fraction.variant_id !== row.id) throw new Error(`หน่วยแบ่งขายของรายการที่ ${i + 1} ไม่ตรงกับรุ่นสินค้า`);
        multiplier = num(fraction.multiplier, 0);
        const fractionPrice = num(fraction.fraction_price, -1);
        if (multiplier <= 0 || fractionPrice < 0) throw new Error(`ตัวคูณหรือราคาหน่วยย่อยไม่ถูกต้องในรายการที่ ${i + 1}`);
        fractionQty = qty;
        sellingQty = Math.round((qty * multiplier + Number.EPSILON) * 10000) / 10000;
        unitPrice = fractionPrice / multiplier; // effective price per base-stock unit, verified by SQL
        sellingLineTotal = round2(qty * fractionPrice);
      } else {
        const suppliedMultiplier = num(item.multiplier, 1);
        if (Math.abs(suppliedMultiplier - 1) > 0.000001) {
          throw new Error(`รายการที่ ${i + 1} ใช้ตัวคูณ ${suppliedMultiplier} แต่ไม่มี fractionId ที่ตรวจสอบได้`);
        }
        sellingQty = qty;
        unitPrice = num(row.selling_price, 0);
        sellingLineTotal = round2(sellingQty * unitPrice);
      }
      return {
        source: item, variant: row, localVariantId: key, fraction,
        fractionQty, multiplier, baseQty: sellingQty, unitPrice,
        lineTotal: sellingLineTotal, discount: 0, vatAmount: 0,
        cost: num(row.cost, 0)
      };
    });
  }
  async function resolveCustomerId(c, storeId, rawId) {
    if (!rawId || rawId === 'GENERAL') return null;
    const key = String(rawId).trim();
    if (UUID.test(key)) {
      const { data, error } = await c.from('customers').select('id').eq('store_id', storeId).eq('id', key).limit(1);
      if (error) throw error;
      if (data?.length) return data[0].id;
      throw new Error(`ไม่พบลูกค้า UUID ${key} ในร้านปัจจุบัน`);
    }
    for (const column of ['local_id', 'code']) {
      const { data, error } = await c.from('customers').select('id').eq('store_id', storeId).eq(column, key).limit(1);
      if (error) throw error;
      if (data?.length) return data[0].id;
    }
    throw new Error(`ไม่พบลูกค้ารหัส ${key} ใน Supabase กรุณาซิงค์ข้อมูลลูกค้าก่อนขาย`);
  }
  function paymentMethod(value) {
    const v = String(value || 'CASH').toLowerCase();
    const map = { cash:'cash', transfer:'transfer', promptpay:'promptpay', card:'card', credit:'credit', other:'other' };
    return map[v] || (v === 'qr' ? 'promptpay' : 'other');
  }
  window.processSaleAtomicOnline = async function(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('ข้อมูลการขายไม่ถูกต้อง');
    const c = getClient();
    const { data: authData, error: authError } = await c.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user) throw new Error('กรุณาเข้าสู่ระบบ Supabase ก่อนบันทึกการขาย');
    const storeId = await currentStoreId(c);
    const rawItems = arr(first(payload.items, payload.cartItems, payload.cart, payload.lines));
    if (!rawItems.length) throw new Error('ไม่มีรายการสินค้าในบิล');
    const resolved = await resolveVariants(c, storeId, rawItems);
    const invoice = String(first(payload.invoice_no, payload.invoiceNo, payload.bill_id, payload.billId, payload.invoiceNumber, payload.invoice, '')).trim();
    if (!invoice) throw new Error('ข้อมูลบิลไม่มีเลขที่ใบเสร็จ (bill_id/invoice_no)');

    const subtotal = round2(resolved.reduce((s, x) => s + x.lineTotal, 0));
    const discount = round2(num(first(payload.discount, payload.totalDiscount), 0));
    const taxable = round2(Math.max(0, subtotal - discount));
    const vatRate = num(first(payload.vat_rate, payload.vatRate), 0);
    const suppliedVatAmount = first(payload.vat_amount, payload.vatAmount);
    const vatAmount = suppliedVatAmount === undefined ? round2(taxable * vatRate / 100) : round2(num(suppliedVatAmount, 0));
    // Do not trust totals supplied by the browser; derive the invoice total from resolved server prices and tax inputs.
    const grandTotal = round2(taxable + vatAmount);
    const method = paymentMethod(first(payload.payment_method, payload.paymentMethod, payload.method, 'cash'));
    const received = num(first(payload.received, payload.paid_total, payload.paidTotal, payload.paidAmount), grandTotal);
    const paidTotal = method === 'credit' ? 0 : Math.max(0, Math.min(received, grandTotal));
    const changeAmount = method === 'cash' ? round2(Math.max(0, received - grandTotal)) : 0;
    if (grandTotal < 0 || paidTotal < 0) throw new Error('ยอดขายหรือยอดรับชำระไม่ถูกต้อง');
    const customerId = await resolveCustomerId(c, storeId, first(payload.customer_id, payload.customerId, payload.customer?.id, null));
    const idempotencyKey = String(first(payload.idempotency_key, payload.idempotencyKey, `invoice:${invoice}`)).slice(0, 200);
    const sqlItems = resolved.map(x => ({
      variant_id: x.variant.id, qty: x.baseQty, unit_price: x.unitPrice,
      discount: x.discount, vat_amount: x.vatAmount,
      fraction_id: x.fraction?.id || null,
      fraction_qty: x.fraction ? x.fractionQty : null,
      fraction_multiplier: x.fraction ? x.multiplier : null
    }));
    const { data: saleId, error } = await c.rpc('process_sale_atomic', {
      p_invoice_no: invoice, p_customer_id: customerId, p_items: sqlItems,
      p_subtotal: subtotal, p_discount: discount, p_taxable: taxable,
      p_vat_rate: vatRate, p_vat_amount: vatAmount, p_grand_total: grandTotal,
      p_paid_total: paidTotal, p_change_amount: changeAmount,
      p_payment_method: method, p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    if (!saleId) throw new Error('Supabase ไม่คืนรหัสรายการขาย');

    // SQL RPC returns only sale UUID. Rebuild the shape expected by 01-core.js.
    const { data: sale, error: saleError } = await c.from('sales')
      .select('id,invoice_no,subtotal,grand_total,paid_total,change_amount,idempotency_key')
      .eq('store_id', storeId).eq('id', saleId).single();
    if (saleError) throw saleError;
    const items = resolved.map(x => {
      const qty = num(x.source.qty ?? x.source.quantity, 0);
      const displayPrice = x.fraction ? num(x.fraction.fraction_price, 0) : num(x.variant.selling_price, 0);
      const unitCostAtDisplayUnit = round2(x.cost * x.multiplier);
      return {
        productId: x.source.product_id ?? x.source.productId ?? x.variant.product_id,
        variantId: x.source.variant_id ?? x.source.variantId ?? x.variant.local_id ?? x.variant.id,
        name: x.source.name ?? x.source.product_name ?? '', qty, multiplier: x.multiplier,
        price: displayPrice,
        fractionId: x.source.fractionId ?? x.source.fraction_id ?? null,
        costAtSale: unitCostAtDisplayUnit,
        profitAtSale: round2((displayPrice - unitCostAtDisplayUnit) * qty)
      };
    });
    const totalCost = round2(resolved.reduce((s, x) => s + x.baseQty * x.cost, 0));
    return {
      sale_id: sale.id, bill_id: sale.invoice_no, idempotency_key: sale.idempotency_key,
      items, total: num(sale.grand_total, grandTotal), total_cost: totalCost,
      profit_at_sale: round2(num(sale.grand_total, grandTotal) - totalCost),
      received, change: num(sale.change_amount, changeAmount)
    };
  };
})();
