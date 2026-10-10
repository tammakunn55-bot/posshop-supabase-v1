// ==========================================
// SMART POS PRO — PART 4 of 4 (plain <script>, no build step)
// Enterprise Upgrade Suite:
// 1. Atomic Transaction Engine with Auto-Rollback & External Callbacks
// 2. Lock & Conflict Resolution (Moved to supabase-integration.js)
// 3. Emergency Auto Recovery & Cart Draft Persistence
// 4. In-Browser Automated System Testing Suite (Unit/Integration)
// 5. Global Error Logging, Monitoring & Remote Telemetry
// ==========================================

(function () {
  'use strict';

  // ==========================================
  // 1. ATOMIC TRANSACTION ENGINE WITH AUTO-ROLLBACK & SIDE-EFFECT COMPENSATIONS
  // ==========================================
  // Guarantees that multi-step operations (e.g., checkout = stock reduction +
  // bill creation + cash ledger update) either succeed entirely or roll back cleanly.
  window.runAtomicTransaction = async function (transactionName, operationFn) {
    if (typeof window.guardOnce === 'function' && !window.guardOnce('tx_' + transactionName, 500)) {
      return false;
    }

    // 1. Create a deep state snapshot prior to state mutation
    const stateSnapshot = JSON.stringify(window.db);
    const cartSnapshot = JSON.stringify(window.cart || []);
    const compensations = []; // Queue for external side-effect rollbacks (e.g., API calls)

    // Hook passed into the operationFn so business logic can register an "undo" 
    // function for any external side-effects if the transaction fails later on.
    const registerCompensation = (undoFn) => {
        if (typeof undoFn === 'function') {
            compensations.push(undoFn);
        }
    };

    try {
      // 2. Execute business logic operation (pass compensation hook)
      const result = await operationFn(registerCompensation);

      // 3. On success: persist to local storage (use Decoupled Persist if available)
      if (typeof window.decoupledPersist === 'function') {
          // If transaction name gives a hint, we could pass domains. Default empty arrays syncs all registered.
          window.decoupledPersist();
      } else if (typeof window.persist === 'function') {
          window.persist();
      }

      if (typeof window.logTransaction === 'function') {
        window.logTransaction('ATOMIC_TX_SUCCESS', { name: transactionName });
      }

      return result !== undefined ? result : true;
    } catch (error) {
      console.error(`[Atomic System] Transaction "${transactionName}" failed. Commencing Rollback...`, error);

      // 4. On failure: Execute Compensation Callbacks (Rollback External APIs first)
      for (let i = compensations.length - 1; i >= 0; i--) {
          try {
              await compensations[i]();
          } catch (compErr) {
              console.error(`[Atomic System] Compensation failed during rollback of ${transactionName}:`, compErr);
          }
      }

      // 5. Restore Local Snapshot completely & sync UI
      try {
        const restoredDb = JSON.parse(stateSnapshot);
        const restoredCart = JSON.parse(cartSnapshot);
        
        // Re-assign explicitly to global scope
        window.db = restoredDb;
        window.cart = restoredCart;
        if (typeof db !== 'undefined') db = window.db;
        if (typeof cart !== 'undefined') cart = window.cart;

        if (typeof window.renderAll === 'function') window.renderAll();
        if (typeof window.updateShiftUI === 'function') window.updateShiftUI();
        if (typeof window.updateCartUI === 'function') window.updateCartUI();
      } catch (rollbackErr) {
        console.error("Critical: Local State Rollback failed!", rollbackErr);
      }

      if (typeof window.logSystemError === 'function') {
        window.logSystemError('ATOMIC_ROLLBACK', `Transaction ${transactionName}: ${error.message}`, error.stack);
      }

      if (typeof window.showAlert === 'function') {
        window.showAlert(
          "ทำรายการไม่สำเร็จ (Rollback)",
          `ระบบได้ยกเลิกการเปลี่ยนแปลงทั้งหมดเนื่องจากพบข้อผิดพลาด: ${error.message || 'เกิดปัญหากลางทาง'}`,
          true
        );
      }

      return false;
    }
  };


  // ==========================================
  // 3. AUTO RECOVERY & CART DRAFT SYSTEM
  // ==========================================
  const CART_DRAFT_KEY = 'smart_pos_cart_draft_v1';

  window.saveCartDraft = function () {
    try {
      if (Array.isArray(window.cart) && window.cart.length > 0) {
        localStorage.setItem(CART_DRAFT_KEY, JSON.stringify({
          updatedAt: Date.now(),
          cart: window.cart
        }));
      } else {
        localStorage.removeItem(CART_DRAFT_KEY);
      }
    } catch (e) {
      console.error("Cart draft save error:", e);
    }
  };

  window.restoreCartDraft = function () {
    try {
      const raw = localStorage.getItem(CART_DRAFT_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (data && Array.isArray(data.cart) && data.cart.length > 0) {
        // Verify products still exist before restoring
        const validItems = data.cart.filter(item => {
          return window.db && window.db.products && window.db.products[item.id];
        });

        if (validItems.length > 0) {
          window.cart = validItems;
          if (typeof window.updateCartUI === 'function') {
            window.updateCartUI();
          }
          if (typeof window.showToast === 'function') {
            window.showToast("📦 กู้คืนสินค้าในตะกร้าจากครั้งก่อนสำเร็จ");
          }
        } else {
          localStorage.removeItem(CART_DRAFT_KEY);
        }
      }
    } catch (e) {
      console.error("Cart draft restore error:", e);
    }
  };

  window.clearCartDraft = function () {
    try {
      localStorage.removeItem(CART_DRAFT_KEY);
    } catch (e) {}
  };


  // ==========================================
  // 4. AUTOMATED SYSTEM TESTING SUITE (In-Browser)
  // ==========================================
  window.runAutoTests = async function () {
    console.log("%c🧪 === เริ่มต้นการรันระบบทดสอบอัตโนมัติ (System Tests) ===", "color: #6366f1; font-size: 14px; font-weight: bold;");
    let passed = 0;
    let failed = 0;
    const testLogs = [];

    const assert = (testName, condition, detail = '') => {
      if (condition) {
        console.log(`%c  ✅ PASS: ${testName}`, "color: #10b981; font-weight: bold;");
        passed++;
        testLogs.push({ name: testName, status: 'PASS', detail });
      } else {
        console.error(`  ❌ FAIL: ${testName}`, detail);
        failed++;
        testLogs.push({ name: testName, status: 'FAIL', detail });
      }
    };

    // Test 1: Precision Math & Financial Calculations
    try {
      const floatSum = window.roundAmt(0.1 + 0.2);
      assert("คำนวณทศนิยมแม่นยำ (0.1 + 0.2 = 0.3)", floatSum === 0.3, `ได้ค่า: ${floatSum}`);

      const totalAmt = window.roundAmt(100.555);
      assert("ปัดเศษการเงินสองตำแหน่ง (100.555 -> 100.56)", totalAmt === 100.56, `ได้ค่า: ${totalAmt}`);
    } catch (e) {
      assert("ทดสอบฟังก์ชันคำนวณการเงิน", false, e.message);
    }

    // Test 2: Database Schema Validator Integration
    try {
      if (typeof window.validateDatabase === 'function') {
        const res = window.validateDatabase(window.db);
        assert("ตรวจสอบความถูกต้องของฐานข้อมูล (Schema Validation)", res.valid, `Errors: ${res.errors.join(', ')}`);
      } else {
        assert("มีฟังก์ชัน validateDatabase ในระบบ", false, "ไม่พบฟังก์ชัน");
      }
    } catch (e) {
      assert("ทดสอบ Validator", false, e.message);
    }

    // Test 3: Atomic Transaction Engine & Rollback
    try {
      const originalStoreName = window.db.storeName;
      let sideEffectCalled = false;
      const txResult = await window.runAtomicTransaction('TEST_INTENTIONAL_FAIL', async (registerCompensation) => {
        window.db.storeName = "TEST_TEMP_NAME_12345";
        
        // Test Side-effect Compensation
        registerCompensation(() => {
            sideEffectCalled = true;
        });

        throw new Error("Simulated Failure for Testing Rollback");
      });

      assert("ระบบ Atomic Transaction สามารถตรวจจับ Error ได้ถูกต้อง", txResult === false);
      assert("ระบบ Rollback คืนค่าข้อมูลกลับสมบูรณ์หลังการล้มเหลว", window.db.storeName === originalStoreName, `ชื่อร้านปัจจุบัน: ${window.db.storeName}`);
      assert("ระบบ Rollback เรียกการชดเชย (Compensation) ภายนอกได้", sideEffectCalled === true);
    } catch (e) {
      assert("ทดสอบ Atomic Rollback Engine", false, e.message);
    }

    // Test 4: Cart Persistence & Local Draft
    try {
      window.cart = [{ cartKey: 'test_1', qty: 2 }];
      window.saveCartDraft();
      const rawDraft = localStorage.getItem(CART_DRAFT_KEY);
      assert("การบันทึก Draft ตะกร้าสินค้าลง LocalStorage", !!rawDraft && rawDraft.includes('test_1'));
      window.clearCartDraft();
      assert("การล้าง Draft ตะกร้าสินค้า", localStorage.getItem(CART_DRAFT_KEY) === null);
      window.cart = [];
    } catch (e) {
      assert("ทดสอบ Cart Persistence", false, e.message);
    }

    console.log(`%c📊 === สรุปผลการทดสอบ: ผ่าน ${passed} | ไม่ผ่าน ${failed} ===`, `color: ${failed === 0 ? '#10b981' : '#f43f5e'}; font-size: 14px; font-weight: bold;`);
    
    if (typeof window.showAlert === 'function') {
      window.showAlert(
        "ผลการทดสอบระบบประจำเครื่อง",
        `ผ่านการทดสอบ: ${passed} รายการ\nไม่ผ่าน: ${failed} รายการ\n\n(ดูรายละเอียดเพิ่มเติมใน F12 Console)`,
        failed > 0
      );
    }

    return { passed, failed, testLogs };
  };


  // ==========================================
  // 5. GLOBAL ERROR LOGGING & MONITORING
  // ==========================================
  const SYSTEM_ERRORS_KEY = 'smart_pos_error_logs_v1';
  const MAX_LOCAL_ERRORS = 50;

  window.getSystemErrorLogs = function () {
    try {
      return JSON.parse(localStorage.getItem(SYSTEM_ERRORS_KEY) || '[]');
    } catch (e) {
      return [];
    }
  };

  window.logSystemError = function (type, message, stackTrace = '') {
    const logs = window.getSystemErrorLogs();
    const badgeEl = document.getElementById('device-id-badge');
    const errorEntry = {
      id: 'ERR-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 5),
      type: type || 'GENERIC_ERROR',
      message: message || 'Unknown error occurred',
      stackTrace: (stackTrace || '').substring(0, 1000), // Cap length
      time: new Date().toISOString(),
      deviceId: (badgeEl?.innerText || 'UNKNOWN').replace('DEVICE: ', '').trim(),
      userAgent: navigator.userAgent
    };

    logs.unshift(errorEntry);
    if (logs.length > MAX_LOCAL_ERRORS) logs.pop();

    try {
      localStorage.setItem(SYSTEM_ERRORS_KEY, JSON.stringify(logs));
    } catch (e) {}

    // Async Telemetry push to Supabase table "error_logs" (Fire-and-Forget)
    try {
      if (typeof window.getSupabaseClient === 'function') {
        const client = window.getSupabaseClient();
        if (client) {
          client.from('error_logs').insert([{
            id: errorEntry.id,
            error_type: errorEntry.type,
            message: errorEntry.message,
            stack_trace: errorEntry.stackTrace,
            device_id: errorEntry.deviceId,
            created_at: errorEntry.time
          }]).then(({ error }) => {
            if (error) console.warn("Could not send error telemetry to Supabase:", error.message);
          }).catch(() => {});
        }
      }
    } catch (e) {}

    return errorEntry;
  };

  // Global Unhandled Exception Handler
  window.onerror = function (message, source, lineno, colno, error) {
    const detailMsg = `${message} at ${source}:${lineno}:${colno}`;
    window.logSystemError('UNHANDLED_EXCEPTION', detailMsg, error?.stack || '');
    return false; // Allow standard browser console behavior
  };

  // Global Unhandled Promise Rejection Handler
  window.onunhandledrejection = function (event) {
    const reason = event.reason;
    const msg = reason?.message || String(reason) || 'Unhandled Promise Rejection';
    window.logSystemError('UNHANDLED_REJECTION', msg, reason?.stack || '');
  };

  // UI Modal for viewing System Error Logs
  window.openErrorLogsModal = function () {
    const logs = window.getSystemErrorLogs();
    let container = document.getElementById('modal-error-logs');

    if (!container) {
      const modalHTML = `
        <div id="modal-error-logs" class="fixed inset-0 z-[170] bg-slate-900/80 flex items-center justify-center p-4 hidden">
          <div class="bg-white w-full max-w-2xl rounded-[2.5rem] p-6 shadow-2xl flex flex-col max-h-[90vh]">
            <div class="flex justify-between items-center mb-4 border-b pb-3">
              <h3 class="text-xl font-bold text-slate-800">🚨 บันทึกข้อผิดพลาดของระบบ (Error Logs)</h3>
              <button onclick="window.closeModal('modal-error-logs')" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-full font-bold w-8 h-8 flex items-center justify-center btn-touch">✕</button>
            </div>
            <div id="error-logs-content" class="overflow-y-auto space-y-2 flex-1 p-2 text-xs font-mono"></div>
            <div class="flex gap-2 mt-4 pt-3 border-t">
              <button onclick="localStorage.removeItem('${SYSTEM_ERRORS_KEY}'); window.openErrorLogsModal();" class="py-2.5 px-4 bg-rose-50 text-rose-600 rounded-xl font-bold btn-touch text-xs">ล้าง Logs ทั้งหมด</button>
              <button onclick="window.closeModal('modal-error-logs')" class="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold btn-touch text-xs">ปิด</button>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', modalHTML);
      container = document.getElementById('modal-error-logs');
    }

    const content = document.getElementById('error-logs-content');
    if (logs.length === 0) {
      content.innerHTML = `<p class="text-center text-slate-400 py-8 font-sans">✓ ไม่พบประวัติข้อผิดพลาดในระบบ</p>`;
    } else {
      content.innerHTML = logs.map(l => `
        <div class="bg-rose-50 border border-rose-200 p-3 rounded-xl text-rose-900">
          <div class="flex justify-between font-bold text-[10px] text-rose-600 mb-1">
            <span>[${window.escapeHTML(l.type)}] ${new Date(l.time).toLocaleString('th-TH')}</span>
            <span>${window.escapeHTML(l.deviceId)}</span>
          </div>
          <p class="font-bold text-xs break-all">${window.escapeHTML(l.message)}</p>
          ${l.stackTrace ? `<pre class="mt-1 text-[9px] bg-white/60 p-1.5 rounded overflow-x-auto text-slate-600 max-h-24">${window.escapeHTML(l.stackTrace)}</pre>` : ''}
        </div>
      `).join('');
    }

    container.classList.remove('hidden');
    container.classList.add('flex');
  };

  // Restore draft on startup
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      window.restoreCartDraft();
    }, 500);
  });

})();

