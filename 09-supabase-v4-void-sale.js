/* Smart POS V4 sale-void adapter. Load after 04-supabase.js and the SQL migrations. */
(() => {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const client = () => {
    if (typeof window.getSupabaseClient !== 'function') throw new Error('getSupabaseClient() ไม่พร้อม');
    const c = window.getSupabaseClient();
    if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL/anon key');
    return c;
  };
  async function authAndStore() {
    const c = client();
    const { data, error } = await c.auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error('กรุณาเข้าสู่ระบบ Supabase ก่อนยกเลิกบิล');
    const result = await c.rpc('get_my_store');
    if (result.error) throw result.error;
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row?.store_id) throw new Error('บัญชีนี้ยังไม่มีร้านที่เปิดใช้งาน');
    return { c, storeId: row.store_id };
  }
  window.voidSupabaseSale = async function(input) {
    if (!input || typeof input !== 'object') throw new Error('ข้อมูลยกเลิกบิลไม่ถูกต้อง');
    const { c, storeId } = await authAndStore();
    const voidNo = String(input.void_no ?? input.voidNo ?? input.id ?? '').trim();
    const rawSale = String(input.sale_id ?? input.saleId ?? input.invoice_no ?? input.invoiceNo ?? '').trim();
    if (!voidNo) throw new Error('กรุณาระบุเลขที่เอกสารยกเลิกบิล');
    if (!rawSale) throw new Error('กรุณาระบุ sale_id หรือ invoice_no');
    let saleId = rawSale;
    if (!UUID.test(rawSale)) {
      const { data, error } = await c.from('sales').select('id').eq('store_id', storeId).eq('invoice_no', rawSale).limit(1);
      if (error) throw error;
      if (!data?.length) throw new Error(`ไม่พบเลขที่บิล ${rawSale} ในร้านปัจจุบัน`);
      saleId = data[0].id;
    }
    const { data, error } = await c.rpc('void_sale_atomic', {
      p_void_no: voidNo,
      p_sale_id: saleId,
      p_reason: input.reason ?? input.note ?? null
    });
    if (error) throw error;
    if (!data) throw new Error('Supabase ไม่คืนรหัสเอกสารยกเลิกบิล');
    return { ok: true, void_id: data, void_no: voidNo, sale_id: saleId };
  };
})();
