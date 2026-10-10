/* Smart POS V4 stock-control adapter — load after 04-supabase.js and the compatibility migration.
 * Stock is changed only through the audited set_variant_stock RPC. Product sync does not write stock.
 */
(() => {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function client() {
    if (typeof window.getSupabaseClient !== 'function') throw new Error('getSupabaseClient() ไม่พร้อม');
    const c = window.getSupabaseClient();
    if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL/anon key');
    return c;
  }
  async function storeId(c) {
    const { data, error } = await c.rpc('get_my_store');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.store_id) throw new Error('บัญชีนี้ยังไม่มีร้านที่เปิดใช้งาน');
    return row.store_id;
  }
  window.setSupabaseVariantStock = async function (localOrUuid, newStock, note = '') {
    const key = String(localOrUuid ?? '').trim();
    const value = Number(newStock);
    if (!key) throw new Error('กรุณาระบุรหัสรุ่นสินค้า');
    if (!Number.isFinite(value) || value < 0) throw new Error('สต็อกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    const c = client();
    const { data: auth, error: authError } = await c.auth.getUser();
    if (authError) throw authError;
    if (!auth?.user) throw new Error('กรุณาเข้าสู่ระบบ Supabase ก่อนปรับสต็อก');
    const sid = await storeId(c);
    let query = c.from('product_variants').select('id').eq('store_id', sid).limit(1);
    query = UUID.test(key) ? query.eq('id', key) : query.eq('local_id', key);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) throw new Error(`ไม่พบรุ่นสินค้า ${key} ใน Supabase`);
    const { data: stock, error: rpcError } = await c.rpc('set_variant_stock', {
      p_variant_id: data[0].id, p_new_stock: value, p_note: String(note || '').slice(0, 500)
    });
    if (rpcError) throw rpcError;
    return { ok: true, variant_id: data[0].id, stock: Number(stock) };
  };
})();
