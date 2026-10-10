/* Smart POS V4 — guard for the deprecated pos_state full-state sync.
 * Load AFTER 04-supabase.js and all current V4 adapters.
 *
 * The V4 relational schema deliberately does not create public.pos_state.
 * This guard prevents the legacy full-state push/merge loop from repeatedly
 * requesting a table that is absent and, more importantly, avoids presenting
 * the legacy JSON blob as if it were synchronized with the relational tables.
 * It does NOT implement full application-data sync. That requires explicit
 * per-entity adapters and must be completed/tested before multi-device use.
 */
(() => {
  'use strict';
  const KEY = '__SMARTPOS_V4_LEGACY_STATE_SYNC_DISABLED__';
  if (window[KEY]) return;
  window[KEY] = true;

  const message = 'Smart POS V4: pos_state full-state sync ถูกปิดไว้ เพราะ schema ใหม่ใช้ตาราง relational; ต้องย้ายข้อมูลแต่ละโมดูลก่อนเปิดซิงค์หลายเครื่อง';
  let warned = false;
  const showStatus = () => {
    const el = document.getElementById('supabase-sync-badge');
    if (el) {
      el.innerText = '🟠 ซิงค์ข้อมูลเต็มระบบปิดอยู่';
      el.title = 'ตาราง pos_state ไม่ใช่แหล่งข้อมูลหลักใน Schema V4; การซิงค์สินค้า/ยอดขายต้องใช้ adapter ของแต่ละตาราง';
    }
  };
  window.pushFullStateToSupabaseSafe = async function () {
    showStatus();
    if (!warned) {
      warned = true;
      console.warn(message);
      if (typeof window.logSystemError === 'function') {
        try { window.logSystemError('LEGACY_POS_STATE_SYNC_DISABLED', message); } catch (_) {}
      }
    }
    return false;
  };

  // Prevent generic badge updates from incorrectly showing a successful full-state sync.
  if (typeof window.updateSyncStatusBadge === 'function') {
    window.updateSyncStatusBadge = function () { showStatus(); };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showStatus, { once: true });
  } else {
    showStatus();
  }
})();
