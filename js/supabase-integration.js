// ==========================================
// SUPABASE INTEGRATION (With Conflict Resolution, Force Sync & Granular Tables)
// ==========================================
// Requires the Supabase JS client loaded first via CDN in index.html:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

const SUPABASE_URL_DEFAULT = "https://lxtnvizytplgvmsycglt.supabase.co";
const SUPABASE_ANON_KEY_DEFAULT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dG52aXp5dHBsZ3Ztc3ljZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzAxNTEsImV4cCI6MjA5OTk0NjE1MX0.rYXlQGSF0TMHAcVbw44lalraia9fCxkXmxMnUZBb73c";

const SUPABASE_URL_STORAGE_KEY = 'pos_supabase_url';
const SUPABASE_KEY_STORAGE_KEY = 'pos_supabase_anon_key';

function getConfiguredSupabaseUrl() {
  return localStorage.getItem(SUPABASE_URL_STORAGE_KEY) || SUPABASE_URL_DEFAULT;
}
function getConfiguredSupabaseAnonKey() {
  return localStorage.getItem(SUPABASE_KEY_STORAGE_KEY) || SUPABASE_ANON_KEY_DEFAULT;
}

window.saveSupabaseConfig = function () {
  const urlEl = document.getElementById('supabase-config-url');
  const keyEl = document.getElementById('supabase-config-key');
  const url = urlEl ? urlEl.value.trim() : '';
  const key = keyEl ? keyEl.value.trim() : '';
  if (!url || !key) return showAlert("ข้อมูลไม่ครบ", "กรุณากรอกทั้ง Project URL และ anon public key", true);
  if (!/^https:\/\/.+\.supabase\.co$/.test(url)) return showAlert("URL ไม่ถูกต้อง", "รูปแบบ Project URL ควรเป็น https://xxxxx.supabase.co", true);
  localStorage.setItem(SUPABASE_URL_STORAGE_KEY, url);
  localStorage.setItem(SUPABASE_KEY_STORAGE_KEY, key);
  _supabaseClient = null;
  showAlert("บันทึกแล้ว", "ตั้งค่าฐานข้อมูล Supabase ใหม่เรียบร้อย ระบบจะเชื่อมต่อโปรเจกต์นี้ตั้งแต่การซิงค์ครั้งถัดไป", false);
};

window.loadSupabaseConfigIntoForm = function () {
  const urlEl = document.getElementById('supabase-config-url');
  const keyEl = document.getElementById('supabase-config-key');
  if (urlEl) urlEl.value = getConfiguredSupabaseUrl();
  if (keyEl) keyEl.value = getConfiguredSupabaseAnonKey();
};

let _supabaseClient = null;
function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    if (typeof window.showAlert === 'function') {
      window.showAlert("เชื่อมต่อ Supabase ไม่ได้", "ไลบรารี Supabase ยังโหลดไม่สำเร็จ", true);
    }
    throw new Error("Supabase library not loaded");
  }
  _supabaseClient = window.supabase.createClient(getConfiguredSupabaseUrl(), getConfiguredSupabaseAnonKey());
  return _supabaseClient;
}
window.getSupabaseClient = getSupabaseClient;

// ------------------------------------------
// DECOUPLED SYNC & GRANULAR RELATIONAL TABLE SUPPORT
// ------------------------------------------
// Allows syncing specific modules to their own respective database tables in Supabase 
// without needing to rewrite the entire JSON state bloat on every transaction.
window.syncGranularTablesToSupabase = async function (domain) {
    const client = getSupabaseClient();
    if (!client || !window.db) return false;

    try {
        if (domain === 'products') {
            await window.syncProductsToSupabase(true); // Call existing quiet mode sync
        } 
        else if (domain === 'bills') {
            // Find bills that haven't been successfully synced yet
            const unSyncedBills = window.db.bills.filter(b => !b.supabaseSynced);
            if (unSyncedBills.length === 0) return true;

            const payload = unSyncedBills.map(b => ({
                id: b.id,
                time: new Date(b.time).toISOString(),
                total: b.total,
                method: b.method,
                customer_id: b.customerId === 'GENERAL' ? null : b.customerId,
                payload_json: b 
            }));

            const { error } = await client.from('bills').upsert(payload, { onConflict: 'id' });
            if (error) throw error;
            unSyncedBills.forEach(b => b.supabaseSynced = true);
        }
        else if (domain === 'cash_ledger') {
            const unSyncedLedger = window.db.cashLedger.filter(tx => !tx.supabaseSynced);
            if (unSyncedLedger.length === 0) return true;

            const payload = unSyncedLedger.map(tx => ({
                id: tx.id,
                date: tx.date,
                description: tx.description,
                income: tx.income || 0,
                expense: tx.expense || 0,
                type: tx.type,
                ref_id: tx.refId || null
            }));

            const { error } = await client.from('cash_ledger').upsert(payload, { onConflict: 'id' });
            if (error) throw error;
            unSyncedLedger.forEach(tx => tx.supabaseSynced = true);
        }
        else if (domain === 'shifts') {
             const unSyncedShifts = window.db.shifts.filter(s => !s.supabaseSynced);
             if (unSyncedShifts.length === 0) return true;
             
             const payload = unSyncedShifts.map(s => ({
                 id: s.id,
                 start_time: new Date(s.startTime).toISOString(),
                 end_time: s.endTime ? new Date(s.endTime).toISOString() : null,
                 cash_on_hand: s.cashOnHand,
                 payload_json: s
             }));
             const { error } = await client.from('shifts').upsert(payload, { onConflict: 'id' });
             if (error) throw error;
             unSyncedShifts.forEach(s => s.supabaseSynced = true);
        }
        
        return true;
    } catch (err) {
        console.error(`Granular sync failed for domain [${domain}]:`, err);
        return false;
    }
};

window.decoupledPersist = function(domains = []) {
    // 1. Immediately persist local state (Storage)
    if (typeof window.persist === 'function') {
        window.persist();
    }
    
    // 2. Perform decoupled async sync for granular relational tables
    if (domains && domains.length > 0) {
        domains.forEach(domain => {
            window.syncGranularTablesToSupabase(domain);
        });
    } else {
        // Fallback: sync all known modular tables if none specified
        ['bills', 'cash_ledger', 'shifts'].forEach(d => window.syncGranularTablesToSupabase(d));
    }
};

// ------------------------------------------
// PUSH PRODUCTS TO SUPABASE (Granular)
// ------------------------------------------
window.syncProductsToSupabase = async function (isQuiet = false) {
  if (typeof window.guardOnce === 'function' && !window.guardOnce('syncProductsToSupabase')) return;

  const executeSync = async () => {
      if (!isQuiet) showToast("กำลังซิงค์ข้อมูลสินค้าไป Supabase...");
      try {
        const products = Object.values(db.products);

        const categoryRows = db.categories.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color }));
        if (categoryRows.length > 0) {
          const { error } = await getSupabaseClient().from('categories').upsert(categoryRows);
          if (error) throw new Error('categories: ' + error.message);
        }

        const productRows = products.map(p => ({
          id: p.id,
          name: p.name,
          category_id: null,
          icon: p.image || '',
          image_url: p.imageUrl || null,
          is_deleted: !!p.isDeleted
        }));
        if (productRows.length > 0) {
          const { error } = await getSupabaseClient().from('products').upsert(productRows);
          if (error) throw new Error('products: ' + error.message);
        }

        const nameToId = {};
        db.categories.forEach(c => { nameToId[c.name] = c.id; });
        const categoryLinkRows = [];
        products.forEach(p => (p.cat || []).forEach(catName => {
          if (nameToId[catName]) categoryLinkRows.push({ product_id: p.id, category_id: nameToId[catName] });
        }));

        const productIds = products.map(p => p.id);
        if (productIds.length > 0) {
          const { error: delErr } = await getSupabaseClient().from('product_categories').delete().in('product_id', productIds);
          if (delErr && delErr.code !== '42P01') throw new Error('product_categories (clear): ' + delErr.message);
        }
        if (categoryLinkRows.length > 0) {
          const { error } = await getSupabaseClient().from('product_categories').insert(categoryLinkRows);
          if (error && error.code !== '42P01') throw new Error('product_categories: ' + error.message);
        }

        const variantRows = [];
        products.forEach(p => (p.variants || []).forEach(v => {
          variantRows.push({
            id: v.id,
            product_id: p.id,
            size_name: v.sizeName,
            barcode: v.barcode || null,
            cost: roundAmt(v.cost),
            price: roundAmt(v.price),
            stock: roundStock(v.stock),
            min_stock: roundStock(v.minStock)
          });
        }));
        if (variantRows.length > 0) {
          const { error } = await getSupabaseClient().from('product_variants').upsert(variantRows);
          if (error) throw new Error('product_variants: ' + error.message);
        }

        const fractionRows = [];
        products.forEach(p => (p.variants || []).forEach(v => (v.fractions || []).forEach(f => {
          fractionRows.push({
            id: f.id,
            variant_id: v.id,
            fraction_name: f.fractionName,
            multiplier: roundStock(f.fractionMultiplier),
            fraction_price: roundAmt(f.fractionPrice)
          });
        })));
        if (fractionRows.length > 0) {
          const { error } = await getSupabaseClient().from('product_fractions').upsert(fractionRows);
          if (error) throw new Error('product_fractions: ' + error.message);
        }

        if (typeof window.logTransaction === 'function' && !isQuiet) {
          window.logTransaction('SUPABASE_SYNC', { productCount: productRows.length, variantCount: variantRows.length });
        }
        if (!isQuiet) showAlert("ซิงค์สำเร็จ", `ส่งข้อมูลสินค้า ${productRows.length} รายการ ไป Supabase เรียบร้อยแล้ว`, false);
      } catch (err) {
        console.error("Supabase sync error:", err);
        if (!isQuiet) showAlert("ซิงค์ไม่สำเร็จ", "เกิดข้อผิดพลาด: " + err.message, true);
      }
  };

  if (isQuiet) {
      await executeSync();
  } else {
      window.showCustomConfirm(
        "ซิงค์สินค้าทั้งหมดไป Supabase?",
        "ระบบจะเขียนทับข้อมูลสินค้า/ขนาด/หน่วยแบ่งขายทั้งหมดใน Supabase ให้ตรงกับข้อมูลในเครื่องนี้",
        executeSync
      );
  }
};

window.uploadProductImageToSupabase = async function (file, productId) {
  if (!file) return null;
  try {
    const ext = file.name.split('.').pop();
    const path = `${productId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await getSupabaseClient().storage
      .from('product-images')
      .upload(path, file, { upsert: true });
    if (uploadError) throw uploadError;

    const { data } = getSupabaseClient().storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.error("Image upload error:", err);
    showAlert("อัปโหลดรูปไม่สำเร็จ", "เกิดข้อผิดพลาด: " + err.message, true);
    return null;
  }
};

window.handleProductImageUpload = async function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const label = document.getElementById('p-image-upload-label');
  const originalLabel = label ? label.innerText : '';
  if (label) label.innerText = 'กำลังอัปโหลด...';

  const editIdInput = document.getElementById('edit-p-id');
  const productId = (editIdInput ? editIdInput.value : '') || 'NEW-' + Date.now();
  const url = await window.uploadProductImageToSupabase(file, productId);

  if (label) label.innerText = originalLabel;
  event.target.value = '';

  if (url) {
    const urlInput = document.getElementById('p-image-url');
    if (urlInput) urlInput.value = url;
    if (typeof window.previewProductImageUrl === 'function') window.previewProductImageUrl();
    showToast('อัปโหลดรูปสำเร็จ');
  }
};

window.pullProductsFromSupabase = async function () {
  if (typeof window.guardOnce === 'function' && !window.guardOnce('pullProductsFromSupabase')) return;

  window.showCustomConfirm(
    "ดึงข้อมูลสินค้าจาก Supabase มาใช้ในเครื่องนี้?",
    "ระบบจะเขียนทับรายการสินค้า/ขนาด/หมวดหมู่ในเครื่องนี้ให้ตรงกับข้อมูลล่าสุดใน Supabase",
    async () => {
      showToast("กำลังดึงข้อมูลสินค้าจาก Supabase...");
      try {
        const [products, { data: categories, error: cErr }] = await Promise.all([
          window.fetchProductsFromSupabase(),
          getSupabaseClient().from('categories').select('*')
        ]);
        if (cErr) throw cErr;
        if (!products) return;

        const productCount = Object.keys(products).length;
        if (productCount === 0) {
          return showAlert("ไม่มีข้อมูล", "ยังไม่มีสินค้าอยู่ใน Supabase เลย", true);
        }

        db.products = products;
        (categories || []).forEach(c => {
          if (!db.categories.some(existing => existing.id === c.id)) {
            db.categories.push({ id: c.id, name: c.name, icon: c.icon || '📦', color: c.color || '#6366f1' });
          }
        });

        persist();
        renderAll();
        if (typeof window.renderStock === 'function') window.renderStock();
        if (typeof window.logTransaction === 'function') {
          window.logTransaction('SUPABASE_PULL', { productCount });
        }
        showAlert("ดึงข้อมูลสำเร็จ", `นำสินค้า ${productCount} รายการจาก Supabase มาใช้ในเครื่องนี้เรียบร้อยแล้ว`, false);
      } catch (err) {
        console.error("Supabase pull error:", err);
        showAlert("ดึงข้อมูลไม่สำเร็จ", "เกิดข้อผิดพลาด: " + err.message, true);
      }
    }
  );
};

window.fetchProductsFromSupabase = async function () {
  try {
    const [{ data: products, error: pErr }, { data: variants, error: vErr }, { data: fractions, error: fErr }, { data: catLinks, error: clErr }, { data: categories, error: cErr }] = await Promise.all([
      getSupabaseClient().from('products').select('*'),
      getSupabaseClient().from('product_variants').select('*'),
      getSupabaseClient().from('product_fractions').select('*'),
      getSupabaseClient().from('product_categories').select('*'),
      getSupabaseClient().from('categories').select('*')
    ]);
    if (pErr) throw pErr;
    if (vErr) throw vErr;
    if (fErr) throw fErr;
    // We tolerate missing link tables gracefully assuming the structure may evolve
    
    const catIdToName = {};
    if (categories) {
        categories.forEach(c => { catIdToName[c.id] = c.name; });
    }

    const result = {};
    products.forEach(p => {
      result[p.id] = {
        id: p.id, name: p.name, cat: [], image: p.icon || '', imageUrl: p.image_url || '',
        isDeleted: p.is_deleted, variants: []
      };
    });
    
    if (catLinks) {
        catLinks.forEach(link => {
          if (result[link.product_id] && catIdToName[link.category_id]) {
            result[link.product_id].cat.push(catIdToName[link.category_id]);
          }
        });
    }
    
    variants.forEach(v => {
      if (!result[v.product_id]) return;
      result[v.product_id].variants.push({
        id: v.id, sizeName: v.size_name, barcode: v.barcode || '',
        cost: roundAmt(parseFloat(v.cost)), price: roundAmt(parseFloat(v.price)),
        stock: roundStock(parseFloat(v.stock)), minStock: roundStock(parseFloat(v.min_stock)), fractions: []
      });
    });
    
    if (fractions) {
        fractions.forEach(f => {
          for (const pid in result) {
            const v = result[pid].variants.find(x => x.id === f.variant_id);
            if (v) {
              v.fractions.push({ id: f.id, fractionName: f.fraction_name, fractionMultiplier: roundStock(parseFloat(f.multiplier)), fractionPrice: roundAmt(parseFloat(f.fraction_price)) });
              break;
            }
          }
        });
    }
    return result;
  } catch (err) {
    console.error("Supabase fetch error:", err);
    showAlert("ดึงข้อมูลไม่สำเร็จ", "เกิดข้อผิดพลาด: " + err.message, true);
    return null;
  }
};

// ==========================================
// AUTOMATIC FULL-STATE SYNC (With OCC Conflict Check)
// ==========================================
const POS_STATE_ROW_ID = 'main';
const LAST_SYNCED_KEY = 'pos_last_synced_at';

// Debounce Global state sync
let _pushDebounceTimer = null;
const _originalPersistForSync = window.persist;
window.persist = function (...args) {
  const result = _originalPersistForSync ? _originalPersistForSync.apply(this, args) : undefined;
  clearTimeout(_pushDebounceTimer);
  _pushDebounceTimer = setTimeout(() => {
    if (typeof window.pushFullStateToSupabaseSafe === 'function') {
      window.pushFullStateToSupabaseSafe();
    }
  }, 2500);
  return result;
};

// Safe Push Function with Optimistic Concurrency Control (OCC)
window.pushFullStateToSupabaseSafe = async function (force = false) {
  try {
    const client = getSupabaseClient();
    if (!client) return false;

    const lastKnownSync = localStorage.getItem(LAST_SYNCED_KEY);
    const nowIso = new Date().toISOString();

    if (!force) {
      const { data: remoteData, error: fetchErr } = await client
        .from('pos_state')
        .select('updated_at')
        .eq('id', POS_STATE_ROW_ID)
        .maybeSingle();

      if (!fetchErr && remoteData && remoteData.updated_at) {
        const remoteTime = new Date(remoteData.updated_at).getTime();
        const localKnownTime = lastKnownSync ? new Date(lastKnownSync).getTime() : 0;

        if (remoteTime > localKnownTime + 1000) {
          console.warn("[Conflict Engine] Supabase has newer state. Aborting push to prevent data overwrite.");
          
          if (typeof window.logSystemError === 'function') {
            window.logSystemError('SYNC_CONFLICT', `Remote updated at ${remoteData.updated_at}, local known was ${lastKnownSync}`);
          }

          updateSyncStatusBadge('offline', null);
          
          if (typeof window.showCustomConfirm === 'function') {
            window.showCustomConfirm(
              "⚠️ ตรวจพบข้อมูลขัดแย้ง (Data Conflict)",
              "พบว่ามีเครื่องอื่นอัปเดตข้อมูลขึ้นระบบขณะที่คุณกำลังใช้งาน คุณต้องการบังคับซิงค์ (Force Sync) ข้อมูลในเครื่องนี้ขึ้นไปทับหรือไม่?",
              async () => {
                await window.forceSyncNow();
              }
            );
          } else if (typeof window.showAlert === 'function') {
            window.showAlert(
              "⚠️ ตรวจพบข้อมูลขัดแย้ง",
              "มีเครื่องอื่นอัปเดตข้อมูลขึ้นระบบก่อนหน้า กรุณากดปุ่ม 'บังคับซิงค์' หากต้องการเขียนทับ",
              true
            );
          }
          return false;
        }
      }
    }

    const { error: upsertErr } = await client
      .from('pos_state')
      .upsert({ id: POS_STATE_ROW_ID, data: db, updated_at: nowIso });

    if (upsertErr) throw upsertErr;

    localStorage.setItem(LAST_SYNCED_KEY, nowIso);
    updateSyncStatusBadge('synced', nowIso);
    return true;
  } catch (err) {
    console.error("[Conflict Engine] Push failed:", err);
    updateSyncStatusBadge('offline', null);
    if (typeof window.logSystemError === 'function') {
      window.logSystemError('PUSH_FAILED', err.message, err.stack);
    }
    return false;
  }
};

async function checkAndPullNewerStateOnStartup() {
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), ms))
  ]);

  try {
    const client = getSupabaseClient();
    if (!client) {
      updateSyncStatusBadge('offline', null);
      return;
    }

    const result = await withTimeout(
      client.from('pos_state').select('data, updated_at').eq('id', POS_STATE_ROW_ID).maybeSingle(),
      6000
    );

    if (result.timedOut) {
      updateSyncStatusBadge('offline', null);
      return;
    }

    const { data, error } = result;
    if (error || !data) {
      updateSyncStatusBadge(data ? 'synced' : 'never', null);
      return;
    }

    const lastKnownSync = localStorage.getItem(LAST_SYNCED_KEY);
    if (lastKnownSync && new Date(data.updated_at) <= new Date(lastKnownSync)) {
      updateSyncStatusBadge('synced', data.updated_at);
      return;
    }

    if (typeof window.runMigrations === 'function') await window.runMigrations(data.data);
    if (typeof window.autoRepairIfNeeded === 'function') await window.autoRepairIfNeeded(data.data);
    
    // Explicit global reassignment
    window.db = data.data;
    if (typeof db !== 'undefined') { db = window.db; }
    
    localStorage.setItem(LAST_SYNCED_KEY, data.updated_at);
    updateSyncStatusBadge('synced', data.updated_at);

    if (typeof renderAll === 'function') renderAll();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();
    if (typeof updateSheetsPendingCount === 'function') updateSheetsPendingCount();
    if (typeof checkStorageQuota === 'function') checkStorageQuota();

    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen) {
      if (!window.db.pinHash) {
        lockScreen.style.display = 'none';
      } else {
        lockScreen.style.display = 'flex';
        if (window.db.security && window.db.security.lockUntil && window.db.security.lockUntil > Date.now() && typeof startMainLockCountdown === 'function') {
          startMainLockCountdown();
        }
      }
    }
  } catch (err) {
    console.error("Startup sync check failed:", err);
    updateSyncStatusBadge('offline', null);
  }
}

function updateSyncStatusBadge(state, timestamp) {
  const el = document.getElementById('supabase-sync-badge');
  if (!el) return;
  if (state === 'synced') {
    el.innerText = '🟢 ซิงค์แล้ว';
    el.title = timestamp ? `อัปเดตล่าสุด: ${new Date(timestamp).toLocaleString('th-TH')}` : '';
  } else if (state === 'offline') {
    el.innerText = '🔴 ออฟไลน์/ขัดแย้ง';
    el.title = 'เชื่อมต่อ Supabase ไม่ได้ หรือพบการชนกันของข้อมูล';
  } else if (state === 'never') {
    el.innerText = '⚪ ยังไม่เคยซิงค์';
  }
}
window.updateSyncStatusBadge = updateSyncStatusBadge;

window.forceSyncNow = async function () {
  if (typeof window.showToast === 'function') {
    window.showToast("กำลังบังคับซิงค์ข้อมูลทั้งหมดตอนนี้...");
  }
  const success = await pushFullStateToSupabaseSafe(true);
  if (success) {
    if (typeof window.showToast === 'function') {
      window.showToast("ซิงค์ข้อมูลทั้งหมดเรียบร้อยแล้ว");
    }
  } else {
    if (typeof window.showAlert === 'function') {
      window.showAlert("ซิงค์ไม่สำเร็จ", "ไม่สามารถส่งข้อมูลไปยัง Supabase ได้ โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต", true);
    }
  }
};

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await checkAndPullNewerStateOnStartup();
  } finally {
    const splash = document.getElementById('sync-splash-screen');
    if (splash) splash.remove();
  }
});

// ==========================================
// AUDIT LOG → SUPABASE (APPEND-ONLY SECURITY CHECK)
// ==========================================
const _originalLogTransactionForSync = window.logTransaction;
window.logTransaction = async function (action, details = {}, opts = {}) {
  const entry = _originalLogTransactionForSync ? await _originalLogTransactionForSync(action, details, opts) : null;
  if (!entry) return null;
  
  try {
    const deviceBadge = document.getElementById('device-id-badge');
    const deviceId = (deviceBadge?.innerText || '').replace('DEVICE: ', '').trim() || window.__deviceId || null;
    
    // Strict Append-Only Insert (Prevents modifications assuming backend RLS)
    getSupabaseClient().from('audit_log').insert([{
      id: entry.id,
      ts: entry.ts,
      action: entry.action,
      actor: entry.actor,
      details: entry.details,
      device_id: deviceId
    }]).then(({ error }) => {
      if (error) {
         console.warn("Audit log append-only push failed (Check network/RLS policies):", error);
      }
    }).catch(err => console.error("Audit log network err:", err));
  } catch (e) {}
  
  return entry;
};

