/* Smart POS V4 customer/supplier sync adapter — load after 04-supabase.js.
 * Upserts only fields represented in the legacy local DB. Never deletes cloud rows.
 * Customer debt is intentionally not copied into credit_limit; those are different concepts.
 */
(() => {
  'use strict';
  const values = x => Array.isArray(x) ? x : Object.values(x || {});
  const str = x => String(x ?? '').trim();
  function client() {
    if (typeof window.getSupabaseClient !== 'function') throw new Error('getSupabaseClient() ไม่พร้อม');
    const c = window.getSupabaseClient();
    if (!c) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL/anon key');
    return c;
  }
  async function context(c) {
    const { data, error } = await c.rpc('get_my_store');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.store_id) throw new Error('บัญชีนี้ยังไม่มีร้านที่เปิดใช้งาน');
    return row.store_id;
  }
  async function requireAuth(c) {
    const { data, error } = await c.auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error('กรุณาเข้าสู่ระบบ Supabase ก่อนซิงค์');
  }
  window.syncCustomersToSupabase = async function (isQuiet = false) {
    const c = client();
    try {
      await requireAuth(c);
      const storeId = await context(c), db = window.db || {};
      const rows = values(db.customers).filter(x => x && str(x.id) && str(x.name)).map(x => ({
        store_id: storeId, local_id: str(x.id), code: str(x.code || x.id) || null,
        name: str(x.name), phone: str(x.phone) || null, email: str(x.email) || null,
        tax_id: str(x.taxId || x.tax_id) || null, address: str(x.address) || null,
        active: x.active !== false
      }));
      if (rows.length) {
        const { error } = await c.from('customers').upsert(rows, { onConflict: 'store_id,local_id' });
        if (error) throw error;
      }
      if (!isQuiet && typeof window.showToast === 'function') window.showToast(`ซิงค์ลูกค้า ${rows.length} รายการสำเร็จ`);
      return { ok: true, customers: rows.length };
    } catch (e) {
      console.error('[Supabase V4 customer sync]', e);
      if (!isQuiet && typeof window.showAlert === 'function') window.showAlert('ซิงค์ลูกค้าไม่สำเร็จ', e.message, true);
      throw e;
    }
  };
  window.syncSuppliersToSupabase = async function (isQuiet = false) {
    const c = client();
    try {
      await requireAuth(c);
      const storeId = await context(c), db = window.db || {};
      const rows = values(db.suppliers).filter(x => x && str(x.id) && str(x.name)).map(x => ({
        store_id: storeId, local_id: str(x.id), code: str(x.code || x.id) || null,
        name: str(x.name), tax_id: str(x.taxId || x.tax_id) || null,
        credit_terms: Math.max(0, Number.parseInt(x.terms ?? x.credit_terms, 10) || 0),
        phone: str(x.phone) || null, email: str(x.email) || null,
        address: str(x.address) || null, active: x.active !== false
      }));
      if (rows.length) {
        const { error } = await c.from('suppliers').upsert(rows, { onConflict: 'store_id,local_id' });
        if (error) throw error;
      }
      if (!isQuiet && typeof window.showToast === 'function') window.showToast(`ซิงค์ซัพพลายเออร์ ${rows.length} รายการสำเร็จ`);
      return { ok: true, suppliers: rows.length };
    } catch (e) {
      console.error('[Supabase V4 supplier sync]', e);
      if (!isQuiet && typeof window.showAlert === 'function') window.showAlert('ซิงค์ซัพพลายเออร์ไม่สำเร็จ', e.message, true);
      throw e;
    }
  };
})();
