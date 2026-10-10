
/* START part1.js */
// ==========================================
// SMART POS PRO — PART 1 of 4 (plain <script>, no build step)
// Utilities, DB schema/init, alerts, PIN auth, sale/cart, sync, expenses, shifts, product CRUD
// Loaded in order via <script> tags in index.html — this file shares the
// same global scope as the other parts, so functions/variables defined in
// any part are usable from any other part. Load order in index.html matters
// (Part 1 must load before Part 2, etc.) but call order does not — a
// function only needs to EXIST by the time it's actually invoked (e.g. a
// button click), not by the time the file that calls it was parsed.
// ==========================================

      // ==========================================
      // UTILITIES & CONSTANTS
      // ==========================================
      const roundAmt = (num) => Math.round((parseFloat(num) || 0) * 100) / 100;
      const roundStock = (num) => Math.round((parseFloat(num) || 0) * 10000) / 10000;
      const formatMoney = (val) => "฿" + roundAmt(val).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
      const generateID = () => Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();

      // ==========================================
      // GLOBAL DOUBLE-SUBMIT GUARD
      // ==========================================
      // Shared re-entrancy lock for any action that touches money/stock/data (saving a
      // product, paying a debt, confirming a refund, etc). Call guardOnce('someKey') as
      // the very first line of the function; it returns false (and the caller should
      // immediately return) if that same action was already triggered within the
      // cooldown window — e.g. from a rapid accidental double-tap on a touchscreen POS.
      // The lock self-clears after cooldownMs so it can never get stuck disabling a
      // button permanently, even if the wrapped function throws.
      window.__busyLocks = {};
      function guardOnce(key, cooldownMs) {
        const now = Date.now();
        if (window.__busyLocks[key] && now < window.__busyLocks[key]) return false;
        window.__busyLocks[key] = now + (cooldownMs || 800);
        return true;
      }
      
      // XSS Protection Helper
      function escapeHTML(str) {
        if (!str) return '';
        return str.toString()
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      // Secure cryptographic SHA-256 Hashing for PINs.
      // `salt`, when provided, is mixed into the hashed string so that two stores using the
      // same PIN don't produce the same hash, and a leaked/exported database can't be
      // attacked with a single precomputed 0000-9999 rainbow table.
      // Backward compatible: if salt is falsy (older records created before this fix),
      // it hashes the PIN alone, matching how the hash was originally computed.
      async function hashPIN(pin, salt) {
        const encoder = new TextEncoder();
        const raw = salt ? `${salt}:${pin.toString()}` : pin.toString();
        const data = encoder.encode(raw);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }

      function generatePinSalt() {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      }

      // Exponential Backoff Retry Fetch Implementation
      async function fetchWithRetry(url, options, retries = 5, delay = 1000) {
        try {
          const response = await fetch(url, options);
          // Opaque response from mode 'no-cors' returns status 0. We allow 0 or ok responses
          if (options.mode === 'no-cors') {
            return response;
          }
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response;
        } catch (error) {
          if (retries === 1) throw error;
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchWithRetry(url, options, retries - 1, delay * 2);
        }
      }

      window.repairThaiText = function(str) {
        if (!str) return str;
        try {
          if (str.includes('à¸') || str.includes('à¹') || /[\u00e0-\u00ef]/.test(str)) {
            const bytes = new Uint8Array(str.split('').map(c => c.charCodeAt(0) & 0xff));
            const decoded = new TextDecoder('utf-8').decode(bytes);
            if (decoded && decoded !== str && /[ก-์]/.test(decoded)) {
              return decoded;
            }
          }
        } catch (e) {
          console.error("Error repairing text:", e);
        }
        return str;
      };

      window.repairAllDatabaseThaiText = function() {
        window.openManagerPinModal(() => {
          window.showCustomConfirm(
            "ซ่อมแซมข้อความภาษาไทยทั้งระบบ?",
            "ระบบจะสแกนและแก้ไขชื่อสินค้า หมวดหมู่ และลูกค้าที่มีปัญหาการเข้ารหัสภาษาไทยทั้งหมดทันที",
            () => {
              let fixedProducts = 0;
              let fixedCats = 0;
              let fixedCustomers = 0;

              Object.values(db.products).forEach(p => {
                const oldName = p.name;
                p.name = window.repairThaiText(p.name);
                if (oldName !== p.name) fixedProducts++;

                if (p.variants) {
                  p.variants.forEach(v => {
                    v.sizeName = window.repairThaiText(v.sizeName);
                    if (v.fractions) {
                      v.fractions.forEach(f => {
                        f.fractionName = window.repairThaiText(f.fractionName);
                      });
                    }
                  });
                }
              });

              db.categories.forEach(c => {
                const oldCatName = c.name;
                c.name = window.repairThaiText(c.name);
                if (oldCatName !== c.name) fixedCats++;
              });

              Object.values(db.customers).forEach(c => {
                const oldCustName = c.name;
                c.name = window.repairThaiText(c.name);
                if (oldCustName !== c.name) fixedCustomers++;
              });

              persist();
              renderAll();
              showAlert("🪄 ซ่อมแซมระบบสำเร็จ!", `ระบบ POS คืนค่าชื่อภาษาไทยเรียบร้อยแล้ว:\n- สินค้า: ${fixedProducts} รายการ\n- หมวดหมู่: ${fixedCats} รายการ\n- ลูกค้า: ${fixedCustomers} รายการ`, false);
            }
          );
        });
      };

      window.playSound = function(type) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          if (type === 'success') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.1);
          } else if (type === 'error') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, ctx.currentTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.3);
          }
        } catch(e) {}
      };

      function getDailyBillId() {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (!db.counters.lastBillDate || db.counters.lastBillDate !== today) {
          db.counters.lastBillDate = today;
          db.counters.dailyBillNum = 1;
        } else {
          db.counters.dailyBillNum++;
        }
        return `POS-${today}-${db.counters.dailyBillNum.toString().padStart(3, '0')}`;
      }

      // ==========================================
      // DATABASE SCHEMAS
      // ==========================================
      const SCHEMA_VERSION = 1;

      const DB_DEFAULT = {
        schemaVersion: SCHEMA_VERSION,
        pinHash: "", // Empty by default: no manager PIN is required until the user sets one in ตั้งค่า (Settings)
        pinSalt: "", // Random per-store salt mixed into the PIN hash (set whenever the PIN is changed)
        security: {
          // Lockout state persists in the saved database (not just in memory) so that
          // simply reloading the page can't be used to reset a brute-force lockout.
          lockFailCount: 0, lockUntil: 0,       // main lock screen
          mgrFailCount: 0, mgrLockUntil: 0      // manager-PIN modal
        },
        storeName: "ช.เจริญกิจการก่อสร้าง",
        storeAddress: "123/45 ถนนนวมินทร์ แขวงคลองกุ่ม เขตบึงกุ่ม กรุงเทพมหานคร 10240",
        promptPayId: "0642749810",
        settings: { displayDays: 30, taxPayerName: "หจก. ช.เจริญกิจการก่อสร้าง", taxPayerId: "0105563000123", googleSheetsUrl: "", mgrSessionMinutes: 0 },
        categories: [
          { id: 'CAT-01', name: 'งานทั่วไป', icon: '📦', color: '#6366f1' },
          { id: 'CAT-02', name: 'ท่อ & ข้อต่อ', icon: '🚰', color: '#10b981' },
          { id: 'CAT-03', name: 'ไฟฟ้า & แสงสว่าง', icon: '🔌', color: '#f59e0b' }
        ],
        products: {
          'P001': { id: 'P001', name: 'ท่อ PVC สีฟ้า ตราช้าง 8.5', cat: ['ท่อ & ข้อต่อ'], image: '🚰', imageUrl: '', variants: [
            { id: 'V1', sizeName: '1/2 นิ้ว (4 หุน)', barcode: '8850001', cost: 35, price: 55, stock: 120, minStock: 25, fractions: [
              { id: 'F1', fractionName: 'แบ่งขาย 1 เมตร', fractionMultiplier: 0.25, fractionPrice: 18 }
            ] },
            { id: 'V2', sizeName: '3/4 นิ้ว (6 หุน)', barcode: '8850002', cost: 45, price: 70, stock: 8, minStock: 15, fractions: [] }
          ] },
          'P002': { id: 'P002', name: 'สายไฟ VAF 2x1.5 SQ.MM.', cat: ['ไฟฟ้า & แสงสว่าง'], image: '🔌', imageUrl: '', variants: [
            { id: 'V3', sizeName: 'ม้วน 100 เมตร', barcode: '8850003', cost: 850, price: 1250, stock: 15, minStock: 5, fractions: [
              { id: 'F2', fractionName: 'ตัดขายเมตรละ', fractionMultiplier: 0.01, fractionPrice: 18 }
            ] }
          ] }
        },
        customers: {
          'C001': { id: 'C001', name: 'ช่างสมชาย รับเหมาทั่วไป', phone: '0812345678', debt: 3500 },
          'C002': { id: 'C002', name: 'บจก. นวมินทร์ คอนสตรัคชั่น', phone: '029876543', debt: 0 }
        },
        suppliers: {
          'S001': { id: 'S001', name: 'ร้านค้าวัสดุไทย จำกัด (สำนักงานใหญ่)', taxId: '0105559000111', terms: 30 },
          'S002': { id: 'S002', name: 'หจก. ฮาร์ดแวร์ค้าส่ง', taxId: '0105559000222', terms: 15 }
        },
        bills: [], shifts: [], pos: [], currentShift: null,
        cashLedger: [],
        counters: { product: 3, customer: 3, category: 4, po: 1, barcode: 1000004, variant: 4, dailyBillNum: 0, lastBillDate: "" },
        pendingSyncs: [],
        users: [] // {id, name, pinHash, pinSalt, role: 'owner'|'staff', createdAt} — see suppliers.js-style user management
      };

      // Keys that MUST exist on the top-level db object and their expected JS type
      // (used by the Database Validator below). "array"/"object" are checked with Array.isArray.
      const DB_TOP_LEVEL_TYPES = {
        schemaVersion: 'number', pinHash: 'string', pinSalt: 'string', security: 'object',
        storeName: 'string', storeAddress: 'string', promptPayId: 'string', settings: 'object',
        categories: 'array', products: 'object', customers: 'object', suppliers: 'object',
        bills: 'array', shifts: 'array', pos: 'array', cashLedger: 'array',
        counters: 'object', pendingSyncs: 'array', users: 'array'
      };

      let db = JSON.parse(JSON.stringify(DB_DEFAULT));
      let cart = [];
      let currentUserId = null;
      let currentUserName = '';
      let tempMgrUserPin = '';
      let dangerConfirmAction = null;
      let dangerConfirmPhrase = '';
      let poList = [];
      let activeView = "sale"; 
      let activeCategory = null; 
      let tempPin = "";
      let stockSortBy = 'id'; 
      let selectedBillForReceipt = null;
      let pendingImportData = []; 
      let uploadedHeaders = []; 
      let uploadedRows = [];
      let isSyncing = false; 
      let scanner = null; 
      let isCameraActive = false; 
      let currentFacingMode = "environment";
      let activePayMethod = "CASH"; 
      let activeReportTab = 'OVERVIEW'; 
      let activePOTab = 'CREATE_PO';
      
      window.tempCountStorage = {}; 
      const DB_KEY = "smart_pos_pro_v620_db";

      // Bind Core References & Helpers to window scope for cross-module usage
      window.db = db;
      window.cart = cart;
      window.roundAmt = roundAmt;
      window.roundStock = roundStock;
      window.formatMoney = formatMoney;
      window.generateID = generateID;
      window.escapeHTML = escapeHTML;
      window.guardOnce = guardOnce;

      // ==========================================
      // DATABASE INITIALIZATION & MIGRATION
      // ==========================================
      window.addEventListener('DOMContentLoaded', async () => {
        try {
          // HTTPS Warn Checking
          if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            const banner = document.getElementById('https-warning-banner');
            if (banner) banner.classList.remove('hidden');
          }

          let savedId = await localforage.getItem('POS_DEVICE_ID');
          if (!savedId) { savedId = 'T' + Math.floor(Math.random() * 90 + 10); await localforage.setItem('POS_DEVICE_ID', savedId); }
          const badgeEl = document.getElementById('device-id-badge');
          if (badgeEl) badgeEl.innerText = "DEVICE: " + savedId;

          const raw = await localforage.getItem(DB_KEY);
          if(raw) {
            db = { ...DB_DEFAULT, ...raw };
            db.settings = { ...DB_DEFAULT.settings, ...(raw.settings || {}) };
            db.counters = { ...DB_DEFAULT.counters, ...(raw.counters || {}) };
            window.db = db;
          }

          // Ensure secure migration to pinHash if the raw data still contains legacy "pin"
          if (!db.pinHash && db.pin) {
            db.pinSalt = generatePinSalt();
            db.pinHash = await hashPIN(db.pin, db.pinSalt);
            delete db.pin;
          }

          const BROKEN_LEGACY_PIN_HASH = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918";
          if (db.pinHash === BROKEN_LEGACY_PIN_HASH) {
            db.pinHash = "";
          }

          if (!db.bills) db.bills = [];
          if (!db.shifts) db.shifts = [];
          if (!db.pos) db.pos = [];
          if (!db.cashLedger) db.cashLedger = [];
          if (!db.suppliers) db.suppliers = DB_DEFAULT.suppliers;
          if (!db.users) db.users = [];
          if (db.pinSalt === undefined) db.pinSalt = "";
          db.security = { ...DB_DEFAULT.security, ...(db.security || {}) };

          Object.values(db.products).forEach(p => {
            if (p.variants) {
              p.variants.forEach(v => {
                if (v.minStock === undefined) v.minStock = 10;
                if (!v.fractions) v.fractions = [];
              });
            }
          });

          await runMigrations(db);
          const validation = validateDatabase(db);
          if (!validation.valid) {
            console.warn("Database validation found issues on startup, attempting auto-repair:", validation.errors);
            const repairResult = await autoRepairIfNeeded(db);
            if (repairResult.ran) {
              persist();
              if (repairResult.after.valid) {
                showToast(`ระบบซ่อมแซมฐานข้อมูลอัตโนมัติสำเร็จ (${repairResult.fixes.length} รายการ)`);
              } else {
                showAlert(
                  "พบปัญหาในฐานข้อมูลที่ซ่อมแซมอัตโนมัติไม่ได้ทั้งหมด",
                  `ระบบซ่อมแซมได้บางส่วน (${repairResult.fixes.length} รายการ) แต่ยังพบปัญหาที่ต้องตรวจสอบเอง ${repairResult.after.errors.length} รายการ กรุณาไปที่ ⚙️ ตั้งค่า > สถานะฐานข้อมูล เพื่อดูรายละเอียด`,
                  true
                );
              }
            }
          }
          window.__lastHealthReport = await checkDatabaseHealth(db).catch(() => null);

          renderAll(); updateSyncUI(); updateShiftUI(); updateLowStockBadge(); updateSheetsPendingCount();
          checkStorageQuota();
          runDailyAutoBackupIfNeeded();

          setInterval(async () => { window.__lastHealthReport = await checkDatabaseHealth(db).catch(() => null); }, 30 * 60 * 1000);

          const lockScreen = document.getElementById('lock-screen');
          if (lockScreen) {
            if (!db.pinHash) {
              lockScreen.style.display = 'none';
              showToast("ยังไม่ได้ตั้งรหัส PIN ผู้จัดการ แนะนำให้เข้าไปตั้งค่าที่ ⚙️ ตั้งค่า > เปลี่ยนรหัส PIN");
            } else {
              lockScreen.style.display = 'flex';
              if (db.security.lockUntil && db.security.lockUntil > Date.now()) {
                startMainLockCountdown();
              }
            }
          }

          setInterval(() => {
            const clock = document.getElementById('clock');
            if(clock) clock.innerText = new Date().toLocaleTimeString('th-TH');
            updateManagerSessionBadge();
          }, 1000);

          setInterval(checkStorageQuota, 60 * 60 * 1000);
        } catch (err) {
          console.error("App init failed:", err);
          document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;font-family:'Sarabun',sans-serif;background:#f8fafc;">
              <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
              <h1 style="font-size:18px;font-weight:700;color:#e11d48;margin-bottom:8px;">ระบบเปิดใช้งานไม่สำเร็จ</h1>
              <p style="font-size:14px;color:#475569;max-width:360px;margin-bottom:4px;">เกิดข้อผิดพลาดขณะโหลดข้อมูลของระบบ อาจเกิดจากพื้นที่จัดเก็บของเบราว์เซอร์ถูกปิดกั้น หรือข้อมูลในเครื่องเสียหาย</p>
              <p style="font-size:12px;color:#94a3b8;max-width:360px;margin-bottom:20px;">รายละเอียดทางเทคนิค: ${(err && err.message) ? String(err.message).replace(/</g,'&lt;') : 'Unknown error'}</p>
              <button onclick="location.reload()" style="background:#4f46e5;color:#fff;font-weight:600;padding:10px 24px;border-radius:9999px;border:none;font-size:14px;">ลองโหลดใหม่อีกครั้ง</button>
            </div>`;
        }
      });

      let persistFailureAlertActive = false;
      function persist() {
        window.db = db;
        localforage.setItem(DB_KEY, db).then(() => {
          updateSyncUI();
          updateSheetsPendingCount();
        }).catch(err => {
          console.error("Save error:", err);
          if (!persistFailureAlertActive) {
            persistFailureAlertActive = true;
            showAlert(
              "บันทึกข้อมูลไม่สำเร็จ!",
              "ระบบไม่สามารถบันทึกข้อมูลล่าสุดลงเครื่องได้ กรุณาอย่าปิดหรือรีเฟรชหน้านี้จนกว่าจะแก้ไข",
              true
            );
            setTimeout(() => { persistFailureAlertActive = false; }, 5000);
          }
        });
      }
      window.persist = persist;

      function renderAll() {
        const storeTitle = document.getElementById('store-name-title');
        if (storeTitle) storeTitle.innerText = db.storeName;
        if(activeView === 'sale') renderSaleHome();
        if(activeView === 'stock') window.renderStock();
        if(activeView === 'history') window.renderHistory();
        if(activeView === 'customers') window.renderCustomers();
        if(activeView === 'reports') window.renderReports();
        if(activeView === 'drawer') updateShiftUI();
        if(activeView === 'stock-count') window.renderStockCount();
      }

      window.showView = function(view) {
        activeView = view;
        document.querySelectorAll('.view-content').forEach(el => el.classList.add('hidden'));
        
        const targetView = document.getElementById(`view-${view}`);
        if(targetView) targetView.classList.remove('hidden');
        
        document.querySelectorAll('.nav-btn-el').forEach(btn => {
          btn.style.opacity = btn.dataset.view === view ? "1" : "0.4";
        });

        if (view === 'stock-count') {
          window.tempCountStorage = {};
          Object.values(db.products).forEach(p => {
            if (p.isDeleted) return;
            p.variants.forEach(v => {
              window.tempCountStorage[v.id] = v.stock;
            });
          });
          const scSearch = document.getElementById('stock-count-search');
          if (scSearch) scSearch.value = "";
          window.renderStockCount();
        }

        if (view === 'po') {
          window.switchPOTab('CREATE_PO');
        }

        renderAll();
      };

      // ==========================================
      // ALERT, TOAST, MODAL & CONFIRM UTILS
      // ==========================================
      window.showToast = function(msg) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        const msgEl = document.getElementById('toast-message');
        if (msgEl) msgEl.innerText = msg;
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
        setTimeout(() => {
          toast.style.transform = 'translateY(-100px)';
          toast.style.opacity = '0';
        }, 3000);
      };

      let customConfirmCallback = null;
      window.showCustomConfirm = function(title, desc, callback) {
        const tEl = document.getElementById('custom-confirm-title');
        const dEl = document.getElementById('custom-confirm-desc');
        if (tEl) tEl.innerText = title;
        if (dEl) dEl.innerText = desc;
        customConfirmCallback = callback;
        const modal = document.getElementById('custom-confirm-modal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };
      window.closeCustomConfirm = function(isConfirmed) {
        const cb = customConfirmCallback;
        customConfirmCallback = null;
        const modal = document.getElementById('custom-confirm-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
        if (isConfirmed && cb) cb();
      };

      window.showAlert = function(title, desc, isError = false) {
        const tEl = document.getElementById('custom-alert-title');
        const dEl = document.getElementById('custom-alert-desc');
        if (tEl) tEl.innerText = title;
        if (dEl) dEl.innerText = desc;
        const icon = document.getElementById('custom-alert-icon');
        if (icon) {
          if (isError) {
            icon.innerText = '❌'; icon.className = "w-14 h-14 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto text-xl";
            playSound('error');
          } else {
            icon.innerText = '⚠️'; icon.className = "w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto text-xl";
          }
        }
        const modal = document.getElementById('custom-alert-modal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };
      window.closeCustomAlert = function() {
        const modal = document.getElementById('custom-alert-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
      };

      window.closeModal = function(id) {
        const modal = document.getElementById(id);
        if(modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
      };

      function updateSyncUI() {
        const count = db.bills.filter(b => !b.sheetsSynced).length;
        const scEl = document.getElementById('sync-count');
        const lsEl = document.getElementById('last-save-text');
        if (scEl) scEl.innerText = count;
        if (lsEl) lsEl.innerText = count > 0 ? "ค้างซิงค์ลง Sheets" : "บันทึกข้อมูลเรียบร้อย";
      }

      // ==========================================
      // PIN LOCK & SECURE MANAGER AUTHENTICATION
      // ==========================================
      const PIN_MAX_ATTEMPTS = 5;
      const PIN_LOCK_MS = 30000;
      let mainLockTimerHandle = null;
      let mgrLockTimerHandle = null;

      function isMainPinLocked() {
        return !!(db.security && db.security.lockUntil && db.security.lockUntil > Date.now());
      }
      function isMgrPinLocked() {
        return !!(db.security && db.security.mgrLockUntil && db.security.mgrLockUntil > Date.now());
      }

      function startMainLockCountdown() {
        const keypad = document.getElementById('pin-keypad');
        const errText = document.getElementById('pin-error-text');
        const lockText = document.getElementById('pin-lockout-text');
        if (!keypad || !errText || !lockText) return;

        keypad.classList.add('opacity-40', 'pointer-events-none');
        errText.classList.add('hidden');
        lockText.classList.remove('hidden');
        clearInterval(mainLockTimerHandle);
        const tick = () => {
          const remain = Math.ceil((db.security.lockUntil - Date.now()) / 1000);
          if (remain <= 0) {
            clearInterval(mainLockTimerHandle);
            keypad.classList.remove('opacity-40', 'pointer-events-none');
            lockText.classList.add('hidden');
            db.security.lockUntil = 0;
            db.security.lockFailCount = 0;
            persist();
            return;
          }
          lockText.innerText = `🔒 ลองผิดเกินกำหนด กรุณารออีก ${remain} วินาที...`;
        };
        mainLockTimerHandle = setInterval(tick, 500);
        tick();
      }

      function startMgrLockCountdown() {
        const btn = document.getElementById('mgr-pin-submit-btn');
        const input = document.getElementById('mgr-pin-input');
        const errText = document.getElementById('mgr-pin-error');
        if (!btn || !input || !errText) return;

        btn.disabled = true; btn.classList.add('opacity-40', 'pointer-events-none');
        input.disabled = true;
        clearInterval(mgrLockTimerHandle);
        const tick = () => {
          const remain = Math.ceil((db.security.mgrLockUntil - Date.now()) / 1000);
          if (remain <= 0) {
            clearInterval(mgrLockTimerHandle);
            btn.disabled = false; btn.classList.remove('opacity-40', 'pointer-events-none');
            input.disabled = false;
            errText.classList.add('hidden');
            db.security.mgrLockUntil = 0;
            db.security.mgrFailCount = 0;
            persist();
            return;
          }
          errText.innerText = `🔒 ลองผิดเกินกำหนด กรุณารออีก ${remain} วินาที...`;
          errText.classList.remove('hidden');
        };
        mgrLockTimerHandle = setInterval(tick, 500);
        tick();
      }

      window.pressPin = async function(num) {
        if (isMainPinLocked()) return;
        if(tempPin.length < 4) {
          tempPin += num.toString();
          updatePinDisplay();
          if(tempPin.length === 4) await verifyPin();
        }
      };
      window.clearPin = function() {
        tempPin = "";
        updatePinDisplay();
        const errText = document.getElementById('pin-error-text');
        if (errText) errText.classList.add('hidden');
      };
      function updatePinDisplay() {
        const displayArea = document.getElementById('pin-display-area');
        if (!displayArea) return;
        const dots = displayArea.children;
        for(let i=0; i<4; i++) {
          if (dots[i]) {
            if(i < tempPin.length) dots[i].classList.add('pin-dot-active');
            else dots[i].classList.remove('pin-dot-active');
          }
        }
      }
      async function verifyPin() {
        if (!db.pinHash) {
          const lockScreen = document.getElementById('lock-screen');
          if (lockScreen) lockScreen.style.display = 'none';
          tempPin = ""; updatePinDisplay();
          return;
        }
        const currentHash = await hashPIN(tempPin, db.pinSalt);
        if(currentHash === db.pinHash) {
          db.security.lockFailCount = 0;
          db.security.lockUntil = 0;
          persist();
          const lockScreen = document.getElementById('lock-screen');
          if (lockScreen) {
            lockScreen.style.opacity = '0';
            setTimeout(() => { lockScreen.style.display = 'none'; tempPin = ""; updatePinDisplay(); }, 500);
          }
        } else {
          db.security.lockFailCount = (db.security.lockFailCount || 0) + 1;
          tempPin = ""; updatePinDisplay();
          playSound('error');
          if (db.security.lockFailCount >= PIN_MAX_ATTEMPTS) {
            db.security.lockUntil = Date.now() + PIN_LOCK_MS;
            db.security.lockFailCount = 0;
            persist();
            startMainLockCountdown();
          } else {
            persist();
            const errText = document.getElementById('pin-error-text');
            if (errText) {
              errText.classList.remove('hidden');
              setTimeout(() => { errText.classList.add('hidden'); }, 1000);
            }
          }
        }
      }
      
      let mgrActionCallback = null;
      let managerSessionExpiresAt = 0;

      function isManagerSessionActive() {
        return managerSessionExpiresAt > Date.now();
      }

      window.lockManagerSessionNow = function() {
        managerSessionExpiresAt = 0;
        updateManagerSessionBadge();
        showToast("🔒 ล็อกโหมดผู้จัดการแล้ว");
      };

      function startManagerSession() {
        const minutes = (db.settings && db.settings.mgrSessionMinutes) || 0;
        if (minutes > 0) {
          managerSessionExpiresAt = Date.now() + minutes * 60 * 1000;
        } else {
          managerSessionExpiresAt = 0;
        }
        updateManagerSessionBadge();
      }

      function updateManagerSessionBadge() {
        const badge = document.getElementById('mgr-session-badge');
        const countdownEl = document.getElementById('mgr-session-countdown');
        if (!badge || !countdownEl) return;
        if (isManagerSessionActive()) {
          const remainMs = managerSessionExpiresAt - Date.now();
          const mm = Math.floor(remainMs / 60000);
          const ss = Math.floor((remainMs % 60000) / 1000);
          countdownEl.innerText = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
          badge.classList.remove('hidden');
        } else {
          if (managerSessionExpiresAt !== 0) managerSessionExpiresAt = 0;
          badge.classList.add('hidden');
        }
      }

      window.openManagerPinModal = function(callback) {
        if (!db.pinHash) {
          if (callback) callback();
          showToast("💡 ยังไม่ได้ตั้งรหัส PIN ผู้จัดการ — แนะนำให้ตั้งค่าที่ ⚙️ ตั้งค่า > เปลี่ยนรหัส PIN");
          return;
        }
        if (isManagerSessionActive()) {
          if (callback) callback();
          return;
        }
        mgrActionCallback = callback;
        const input = document.getElementById('mgr-pin-input');
        const errText = document.getElementById('mgr-pin-error');
        if (input) input.value = "";
        if (errText) errText.classList.add('hidden');

        const userSelect = document.getElementById('mgr-user-select');
        if (userSelect) {
          if (db.users && db.users.length > 0) {
            userSelect.innerHTML = `<option value="">-- เจ้าของร้าน (PIN หลัก) --</option>` +
              db.users.map(u => `<option value="${escapeHTML(u.id)}">${escapeHTML(u.name)}</option>`).join('');
            userSelect.classList.remove('hidden');
          } else {
            userSelect.classList.add('hidden');
          }
        }

        const modal = document.getElementById('modal-manager-pin');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
        if (isMgrPinLocked()) {
          startMgrLockCountdown();
        } else {
          const btn = document.getElementById('mgr-pin-submit-btn');
          if (btn && input) {
            btn.disabled = false; btn.classList.remove('opacity-40', 'pointer-events-none');
            input.disabled = false;
          }
        }
        setTimeout(() => {
          const inp = document.getElementById('mgr-pin-input');
          if (inp) inp.focus();
        }, 100);
      };
      
      window.submitManagerPin = async function() {
        if (isMgrPinLocked()) return;
        const val = document.getElementById('mgr-pin-input').value;
        const userSelect = document.getElementById('mgr-user-select');
        const selectedUserId = userSelect ? userSelect.value : '';
        const selectedUser = selectedUserId ? db.users.find(u => u.id === selectedUserId) : null;

        const targetHash = selectedUser ? selectedUser.pinHash : db.pinHash;
        const targetSalt = selectedUser ? selectedUser.pinSalt : db.pinSalt;
        const inputHash = await hashPIN(val, targetSalt);

        if(inputHash === targetHash) {
          db.security.mgrFailCount = 0;
          db.security.mgrLockUntil = 0;
          currentUserId = selectedUser ? selectedUser.id : null;
          currentUserName = selectedUser ? selectedUser.name : 'เจ้าของร้าน';
          persist();
          startManagerSession();
          const callbackToRun = mgrActionCallback;
          window.closeManagerPinModal();
          if(callbackToRun) {
            callbackToRun();
          }
        } else {
          db.security.mgrFailCount = (db.security.mgrFailCount || 0) + 1;
          const input = document.getElementById('mgr-pin-input');
          const errText = document.getElementById('mgr-pin-error');
          if (input) input.value = "";
          if (db.security.mgrFailCount >= PIN_MAX_ATTEMPTS) {
            db.security.mgrLockUntil = Date.now() + PIN_LOCK_MS;
            db.security.mgrFailCount = 0;
            persist();
            startMgrLockCountdown();
          } else {
            persist();
            if (errText) {
              errText.innerText = "PIN ไม่ถูกต้อง!";
              errText.classList.remove('hidden');
            }
          }
        }
      };
      window.closeManagerPinModal = function() {
        const modal = document.getElementById('modal-manager-pin');
        if (modal) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
        clearInterval(mgrLockTimerHandle);
        mgrActionCallback = null;
      };

      // ==========================================
      // SALE HOME & CATEGORIES GRID
      // ==========================================
      function renderSaleHome() {
        const grid = document.getElementById('category-grid');
        if (grid) {
          grid.innerHTML = db.categories.map(c => `
            <div onclick="window.selectCategory('${escapeHTML(c.name)}')" class="p-card bg-white p-5 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center cursor-pointer">
              <div class="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-3 shadow-inner" style="background-color: ${escapeHTML(c.color)}15; color: ${escapeHTML(c.color)};">
                ${escapeHTML(c.icon || '📁')}
              </div>
              <h4 class="font-extrabold text-xs text-slate-700 truncate w-full">${escapeHTML(c.name)}</h4>
            </div>
          `).join('');
        }

        if (activeCategory) {
          selectCategory(activeCategory);
        } else {
          const ps = document.getElementById('product-selection');
          if (ps) ps.classList.add('hidden');
          if (grid) grid.classList.remove('hidden');
        }
      }

      window.selectCategory = function(catName) {
        activeCategory = catName;
        const grid = document.getElementById('category-grid');
        const catTitle = document.getElementById('current-cat-title');
        const ps = document.getElementById('product-selection');
        if (grid) grid.classList.add('hidden');
        if (catTitle) catTitle.innerText = catName;
        if (ps) ps.classList.remove('hidden');

        const filteredProducts = Object.values(db.products).filter(p => !p.isDeleted && p.cat && p.cat.includes(catName));
        renderProductGrid(filteredProducts);
      };

      window.exitCategory = function() {
        activeCategory = null;
        const searchInput = document.getElementById('search-product');
        const ps = document.getElementById('product-selection');
        const grid = document.getElementById('category-grid');
        if (searchInput) searchInput.value = "";
        if (ps) ps.classList.add('hidden');
        if (grid) grid.classList.remove('hidden');
      };

      window.onSearchInput = function(event) {
        const query = event.target.value.trim().toLowerCase();
        if(!query) {
          if (activeCategory) selectCategory(activeCategory);
          else renderSaleHome();
          return;
        }

        const matches = Object.values(db.products).filter(p => {
          if (p.isDeleted) return false;
          const matchName = p.name.toLowerCase().includes(query);
          const matchGroup = p.groupName && p.groupName.toLowerCase().includes(query);
          const matchBarcode = p.variants && p.variants.some(v => v.barcode && v.barcode.toLowerCase().includes(query));
          return matchName || matchGroup || matchBarcode;
        });

        const exactMatchBarcodeItem = [];
        matches.forEach(prod => {
          prod.variants.forEach(vrnt => {
            if (vrnt.barcode.toLowerCase() === query) {
              exactMatchBarcodeItem.push({ prod, vrnt });
            }
          });
        });

        if (exactMatchBarcodeItem.length === 1) {
          const item = exactMatchBarcodeItem[0];
          window.addUnifiedToCart(item.prod.id, item.vrnt.id, null);
          event.target.value = "";
          if (activeCategory) selectCategory(activeCategory);
          else renderSaleHome();
          return;
        }

        const grid = document.getElementById('category-grid');
        const catTitle = document.getElementById('current-cat-title');
        const ps = document.getElementById('product-selection');
        if (grid) grid.classList.add('hidden');
        if (catTitle) catTitle.innerText = `ผลการค้นหา: "${query}"`;
        if (ps) ps.classList.remove('hidden');
        renderProductGrid(matches);
      };

      window.handleProductCardImgError = function(imgEl) {
        const emoji = imgEl.dataset.fallbackEmoji || '📦';
        const fallback = document.createElement('div');
        fallback.className = 'absolute inset-0 flex items-center justify-center text-4xl bg-slate-100';
        fallback.textContent = emoji;
        imgEl.replaceWith(fallback);
      };

      // แบ่งรายการสินค้าออกเป็น "การ์ดเดี่ยว" (ไม่มีกลุ่ม) และ "การ์ดกลุ่ม" (สินค้าหลายชิ้นที่ตั้ง
      // ชื่อกลุ่มเดียวกันไว้ในหน้าแก้ไขสินค้า) โดยคงลำดับเดิมของ productsList ไว้ — การ์ดกลุ่มจะ
      // ปรากฏ ณ ตำแหน่งของสมาชิกตัวแรกที่เจอ ส่วนสมาชิกที่เหลือของกลุ่มเดียวกันจะถูกข้ามไป (ไม่ให้
      // มีการ์ดซ้ำ)
      function buildDisplayCards(productsList) {
        const cards = [];
        const seenGroups = new Set();
        productsList.forEach(p => {
          const gName = (p.groupName || '').trim();
          if (!gName) {
            cards.push({ type: 'single', product: p });
            return;
          }
          const gKey = gName.toLowerCase();
          if (seenGroups.has(gKey)) return;
          seenGroups.add(gKey);
          const members = productsList.filter(x => (x.groupName || '').trim().toLowerCase() === gKey);
          const cheapestPrice = Math.min(...members.flatMap(m => m.variants.map(v => v.price)).filter(n => !isNaN(n)));
          cards.push({ type: 'group', groupKey: gName, members, image: members[0].image, imageUrl: members.find(m => m.imageUrl)?.imageUrl || '', price: cheapestPrice });
        });
        return cards;
      }

      function renderProductGrid(productsList) {
        const grid = document.getElementById('product-grid');
        if (!grid) return;
        if(productsList.length === 0) {
          grid.innerHTML = `<p class="col-span-full py-8 text-center text-slate-400 font-bold text-sm">ไม่พบสินค้าในระบบคลัง</p>`;
          return;
        }

        const cards = buildDisplayCards(productsList);

        grid.innerHTML = cards.map(card => {
          if (card.type === 'group') {
            const g = card;
            const hasPhoto = !!g.imageUrl;
            const clickAttr = `window.onGroupClick('${escapeHTML(g.groupKey)}')`;
            if (hasPhoto) {
              return `
                <div onclick="${clickAttr}" class="p-card relative overflow-hidden h-48 shadow-xs cursor-pointer ring-2 ring-amber-300">
                  <img src="${escapeHTML(g.imageUrl)}" data-fallback-emoji="${escapeHTML(g.image || '📦')}" onerror="window.handleProductCardImgError(this)" class="absolute inset-0 w-full h-full object-cover block">
                  <span class="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow">🔗 ${g.members.length} รายการ</span>
                  <div class="absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5" style="background:linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0));">
                    <p class="font-extrabold text-[11px] text-white leading-tight line-clamp-2">${escapeHTML(g.groupKey)}</p>
                    <p class="text-[10px] text-emerald-300 font-bold mt-0.5">เริ่มต้น: ${formatMoney(g.price || 0)}</p>
                  </div>
                </div>
              `;
            }
            return `
              <div onclick="${clickAttr}" class="p-card bg-white p-4 border-2 border-amber-300 shadow-xs flex flex-col items-center justify-between text-center relative h-48 cursor-pointer">
                <span class="absolute top-2 right-2 bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow">🔗 ${g.members.length} รายการ</span>
                <div class="text-3xl mb-1">${escapeHTML(g.image || '📦')}</div>
                <div class="w-full">
                  <p class="font-extrabold text-[11px] text-slate-800 leading-tight line-clamp-2 h-8">${escapeHTML(g.groupKey)}</p>
                  <p class="text-[10px] text-indigo-600 font-bold mt-1">เริ่มต้น: ${formatMoney(g.price || 0)}</p>
                </div>
              </div>
            `;
          }

          const p = card.product;
          const hasPhoto = !!p.imageUrl;
          if (hasPhoto) {
            return `
              <div onclick="window.onProductClick('${escapeHTML(p.id)}')" class="p-card relative overflow-hidden h-48 shadow-xs cursor-pointer">
                <img src="${escapeHTML(p.imageUrl)}" data-fallback-emoji="${escapeHTML(p.image || '📦')}" onerror="window.handleProductCardImgError(this)" class="absolute inset-0 w-full h-full object-cover block">
                <div class="absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5" style="background:linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0));">
                  <p class="font-extrabold text-[11px] text-white leading-tight line-clamp-2">${escapeHTML(p.name)}</p>
                  <p class="text-[10px] text-emerald-300 font-bold mt-0.5">เริ่มต้น: ${formatMoney(p.variants[0]?.price || 0)}</p>
                </div>
              </div>
            `;
          }
          return `
            <div onclick="window.onProductClick('${escapeHTML(p.id)}')" class="p-card bg-white p-4 border border-slate-200 shadow-xs flex flex-col items-center justify-between text-center relative h-48 cursor-pointer">
              <div class="text-3xl mb-1">${escapeHTML(p.image || '📦')}</div>
              <div class="w-full">
                <p class="font-extrabold text-[11px] text-slate-800 leading-tight line-clamp-2 h-8">${escapeHTML(p.name)}</p>
                <p class="text-[10px] text-indigo-600 font-bold mt-1">เริ่มต้น: ${formatMoney(p.variants[0]?.price || 0)}</p>
              </div>
            </div>
          `;
        }).join('');
      }

      window.onProductClick = function(productId) {
        window.__enterVariantModal(productId, null);
      };

      window.onGroupClick = function(groupKey) {
        window.openGroupModal(groupKey);
      };

      // จำ groupKey ล่าสุดไว้ ใช้ตอนกดปุ่ม "ย้อนกลับ" จาก popup เลือกขนาด กลับไปยัง popup เลือก
      // สินค้าในกลุ่ม (เฉพาะกรณีเข้าถึงสินค้านั้นผ่านการ์ดกลุ่ม ไม่ใช่การ์ดเดี่ยว)
      let lastGroupKeyForBack = null;
      // จำ productId ล่าสุดที่เปิด popup เลือกหน่วย (แบ่งขาย) ไว้ ใช้ตอนกดปุ่ม "ย้อนกลับ" กลับไป
      // popup เลือกขนาด
      let lastVariantModalProductId = null;

      window.openGroupModal = function(groupKey) {
        const gKeyLower = groupKey.toLowerCase();
        const members = Object.values(db.products).filter(x => !x.isDeleted && (x.groupName || '').trim().toLowerCase() === gKeyLower);
        if (members.length === 0) return;

        const title = document.getElementById('g-select-title');
        const desc = document.getElementById('g-select-desc');
        const emoji = document.getElementById('group-modal-emoji');
        if (title) title.innerText = groupKey;
        if (desc) desc.innerText = "เลือกชนิด/ยี่ห้อในกลุ่ม " + groupKey;
        if (emoji) emoji.innerText = members[0].image || "🗂️";

        const container = document.getElementById('g-select-list');
        if (container) {
          container.innerHTML = members.map(p => {
            const sizeCount = p.variants.length;
            const startPrice = Math.min(...p.variants.map(v => v.price).filter(n => !isNaN(n)));
            return `
              <div onclick="window.onGroupMemberClick('${escapeHTML(p.id)}', '${escapeHTML(groupKey)}')" 
                   class="p-3 border-2 border-slate-100 hover:border-amber-500 rounded-2xl cursor-pointer bg-slate-50 transition active:scale-95 flex justify-between items-center mb-2">
                <div>
                  <b class="text-xs text-slate-800">${escapeHTML(p.name)}</b>
                  <p class="text-[10px] text-slate-400 mt-0.5">${sizeCount} ขนาด/ตัวเลือก</p>
                </div>
                <span class="text-xs font-bold text-amber-600">เริ่มต้น ${formatMoney(startPrice || 0)}</span>
              </div>
            `;
          }).join('');
        }

        const modal = document.getElementById('modal-select-group');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };

      window.onGroupMemberClick = function(productId, groupKey) {
        window.closeModal('modal-select-group');
        window.__enterVariantModal(productId, groupKey);
      };

      // จุดเข้าเดียวสำหรับเปิด popup เลือกขนาด ไม่ว่าจะมาจากการ์ดเดี่ยว (fromGroupKey = null) หรือ
      // มาจากการเลือกสินค้าภายในการ์ดกลุ่มก่อนแล้ว (fromGroupKey = ชื่อกลุ่ม) — ถ้ามีขนาดเดียวและ
      // ไม่มีตัวเลือกแบ่งขาย จะเพิ่มลงตะกร้าทันทีโดยไม่ต้องเปิด popup อีกชั้น
      window.__enterVariantModal = function(productId, fromGroupKey) {
        const p = db.products[productId];
        if (!p) return;

        if (p.variants.length === 1 && (!p.variants[0].fractions || p.variants[0].fractions.length === 0)) {
          window.addUnifiedToCart(p.id, p.variants[0].id, null);
          return;
        }
        window.openSelectVariantModal(productId, fromGroupKey);
      };

      window.openSelectVariantModal = function(productId, fromGroupKey) {
        const p = db.products[productId];
        if(!p) return;
        lastVariantModalProductId = productId;
        lastGroupKeyForBack = fromGroupKey || null;

        const title = document.getElementById('v-select-title');
        const desc = document.getElementById('v-select-desc');
        const emoji = document.getElementById('variant-modal-emoji');
        if (title) title.innerText = p.name;
        if (desc) desc.innerText = "เลือกขนาดสินค้าสำหรับ " + p.name;
        if (emoji) emoji.innerText = p.image || "🏷️";

        const backBtn = document.getElementById('v-modal-back-btn');
        if (backBtn) backBtn.classList.toggle('hidden', !lastGroupKeyForBack);

        const container = document.getElementById('v-select-list');
        if (!container) return;
        let html = "";

        p.variants.forEach(v => {
          const hasFractions = v.fractions && v.fractions.length > 0;
          html += `
            <div onclick="window.onVariantClick('${escapeHTML(p.id)}', '${escapeHTML(v.id)}')" 
                 class="p-3 border-2 border-slate-100 hover:border-indigo-500 rounded-2xl cursor-pointer bg-slate-50 transition active:scale-95 flex justify-between items-center mb-2">
              <div>
                <b class="text-xs text-slate-800">${escapeHTML(v.sizeName)}</b>
                <p class="text-[10px] text-slate-400 mt-0.5">คงเหลือคลัง: ${v.stock} ชิ้น${hasFractions ? ' · มีตัวเลือกแบ่งขาย' : ''}</p>
              </div>
              <span class="text-xs font-bold text-indigo-600">${hasFractions ? 'เลือกหน่วย ›' : formatMoney(v.price)}</span>
            </div>
          `;
        });

        container.innerHTML = html;
        const modal = document.getElementById('modal-select-variant');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };

      window.backToGroupModal = function() {
        window.closeModal('modal-select-variant');
        if (lastGroupKeyForBack) window.openGroupModal(lastGroupKeyForBack);
      };

      window.onVariantClick = function(productId, variantId) {
        const p = db.products[productId];
        if (!p) return;
        const v = (p.variants || []).find(x => x.id === variantId);
        if (!v) return;

        if (!v.fractions || v.fractions.length === 0) {
          // ไม่มีตัวเลือกแบ่งขาย เพิ่มลงตะกร้าทันทีแบบเต็มหน่วย
          window.addUnifiedToCart(p.id, v.id, null);
          window.closeModal('modal-select-variant');
          return;
        }

        // มีตัวเลือกแบ่งขาย เปิด popup ที่สองให้เลือกหน่วย
        window.closeModal('modal-select-variant');
        window.openSelectUnitModal(productId, variantId);
      };

      window.openSelectUnitModal = function(productId, variantId) {
        const p = db.products[productId];
        if (!p) return;
        const v = (p.variants || []).find(x => x.id === variantId);
        if (!v) return;

        const title = document.getElementById('u-select-title');
        const desc = document.getElementById('u-select-desc');
        const emoji = document.getElementById('unit-modal-emoji');
        if (title) title.innerText = p.name + ' — ' + v.sizeName;
        if (desc) desc.innerText = "เลือกว่าต้องการขายเต็มหน่วย หรือแบ่งขายย่อย";
        if (emoji) emoji.innerText = p.image || "✂️";

        const container = document.getElementById('u-select-list');
        if (!container) return;
        let html = `
          <div onclick="window.addUnifiedToCart('${escapeHTML(p.id)}', '${escapeHTML(v.id)}', null); window.closeModal('modal-select-unit');" 
               class="p-3 border-2 border-slate-100 hover:border-indigo-500 rounded-2xl cursor-pointer bg-slate-50 transition active:scale-95 flex justify-between items-center mb-2">
            <div>
              <b class="text-xs text-slate-800">เต็มหน่วย (${escapeHTML(v.sizeName)})</b>
              <p class="text-[10px] text-slate-400 mt-0.5">คงเหลือคลัง: ${v.stock} ชิ้น</p>
            </div>
            <span class="text-xs font-bold text-indigo-600">${formatMoney(v.price)}</span>
          </div>
        `;

        v.fractions.forEach(f => {
          html += `
            <div onclick="window.addUnifiedToCart('${escapeHTML(p.id)}', '${escapeHTML(v.id)}', '${escapeHTML(f.id)}'); window.closeModal('modal-select-unit');" 
                 class="p-3 border-2 border-slate-100 hover:border-emerald-500 rounded-2xl cursor-pointer bg-white transition active:scale-95 flex justify-between items-center mb-2">
              <div>
                <b class="text-xs text-slate-600">✂️ ${escapeHTML(f.fractionName)}</b>
                <p class="text-[10px] text-slate-400 mt-0.5">ใช้อัตราส่วน: 1 ${escapeHTML(v.sizeName)} ตัดได้ ${f.fractionMultiplier} ${escapeHTML(f.fractionName)}</p>
              </div>
              <span class="text-xs font-bold text-emerald-600">${formatMoney(f.fractionPrice)}</span>
            </div>
          `;
        });

        container.innerHTML = html;
        const modal = document.getElementById('modal-select-unit');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };

      window.backToVariantModal = function() {
        window.closeModal('modal-select-unit');
        if (lastVariantModalProductId) {
          window.openSelectVariantModal(lastVariantModalProductId, lastGroupKeyForBack);
        }
      };

      // ==========================================
      // ADD TO CART ENGINE (ข้อ 4: คำนวณเศษส่วนและคุมทศนิยม)
      // ==========================================
      window.addUnifiedToCart = function(productId, variantId, fractionId) {
        if (!db.currentShift) return showAlert("ยังไม่เปิดกะ", "กรุณาเปิดกะก่อนขายสินค้า", true);
        
        const p = db.products[productId];
        if(!p) return;
        const v = p.variants.find(x => x.id === variantId);
        if(!v) return;

        let name = p.name;
        let price = roundAmt(v.price);
        let cost = roundAmt(v.cost);
        let multiplier = 1;

        if (fractionId) {
          const f = v.fractions.find(x => x.id === fractionId);
          if(!f) return;
          name = `${p.name} (${v.sizeName} - ${f.fractionName})`;
          price = roundAmt(f.fractionPrice);
          cost = roundAmt((parseFloat(v.cost) || 0) * (parseFloat(f.fractionMultiplier) || 0)); 
          multiplier = roundStock(f.fractionMultiplier);
        } else {
          name = `${p.name} (${v.sizeName})`;
        }

        const cartKey = `${productId}_${variantId}_${fractionId || 'main'}`;
        const existing = cart.find(x => x.cartKey === cartKey);

        let currentAllocatedStock = 0;
        cart.forEach(item => {
          if (item.variantId === variantId) {
            currentAllocatedStock = roundStock(currentAllocatedStock + (item.qty * item.multiplier));
          }
        });

        const additionalStock = multiplier;
        const totalRequiredStock = roundStock(currentAllocatedStock + additionalStock);

        if (roundStock(v.stock) < roundStock(totalRequiredStock)) {
          return showAlert("สต็อกสินค้าไม่พอ", `สต็อกคงเหลือในระบบเพียง ${v.stock} หน่วย ไม่สามารถจัดสรรเพิ่มได้`, true);
        }

        if(existing) {
          existing.qty += 1;
        } else {
          cart.push({
            cartKey, id: productId, variantId, fractionId, name, price, cost, qty: 1, multiplier
          });
        }

        updateCartUI();
        showToast("เพิ่มแล้ว: " + name);
        playSound('success');
      };

      // ==========================================
      // CART INTERACTIONS & DRAFT PERSISTENCE (ข้อ 1)
      // ==========================================
      window.updateCartUI = function() {
        const count = cart.reduce((sum, item) => sum + item.qty, 0);
        const countEl = document.getElementById('cart-count');
        if (countEl) countEl.innerText = count;
        
        const cartFab = document.getElementById('cart-fab');
        if (cartFab) {
          if (count > 0) cartFab.classList.remove('hidden');
          else cartFab.classList.add('hidden');
        }

        const list = document.getElementById('cart-items-list');
        let total = 0;
        if (list) {
          list.innerHTML = cart.map(item => {
            const lineTotal = roundAmt(item.qty * item.price);
            total = roundAmt(total + lineTotal);
            return `
              <div class="flex justify-between items-center bg-slate-50 p-3 rounded-2xl border text-slate-800 mb-2">
                <div class="flex-1 min-w-0 pr-2">
                  <span class="text-xs font-bold block truncate">${escapeHTML(item.name)}</span>
                  <span class="text-[10px] text-slate-400">@${formatMoney(item.price)}</span>
                </div>
                <div class="flex items-center gap-3">
                  <button onclick="window.updateCartQty('${escapeHTML(item.cartKey)}', -1)" class="w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold btn-touch">-</button>
                  <span class="font-black text-sm w-4 text-center">${item.qty}</span>
                  <button onclick="window.updateCartQty('${escapeHTML(item.cartKey)}', 1)" class="w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold btn-touch">+</button>
                  <span class="w-16 text-right font-bold text-indigo-600 text-xs">${formatMoney(lineTotal)}</span>
                </div>
              </div>
            `;
          }).join('');
        }
        
        const grandTotalEl = document.getElementById('cart-grand-total');
        if (grandTotalEl) grandTotalEl.innerText = formatMoney(total);

        // ข้อ 1: เรียกบันทึกหรือล้าง Cart Draft ทันทีตามจำนวนสินค้าคงเหลือ
        if (cart.length === 0 && typeof window.clearCartDraft === 'function') {
          window.clearCartDraft();
        } else if (typeof window.saveCartDraft === 'function') {
          window.saveCartDraft();
        }
      };

      window.updateCartQty = function(key, change) {
        const item = cart.find(x => x.cartKey === key);
        if(!item) return;
        const newQty = item.qty + change;
        
        if (newQty <= 0) { 
          cart = cart.filter(x => x.cartKey !== key); 
          window.cart = cart;
          // ข้อ 1: เรียกบันทึก/ล้าง Draft ทันทีเมื่อสินค้าลดจนเหลือ 0
          if (cart.length === 0 && typeof window.clearCartDraft === 'function') {
            window.clearCartDraft();
          } else if (typeof window.saveCartDraft === 'function') {
            window.saveCartDraft();
          }
        } else {
          const v = db.products[item.id]?.variants.find(x => x.id === item.variantId);
          if (v) {
            let allocatedStockWithoutThis = 0;
            cart.forEach(cItem => {
              if (cItem.variantId === item.variantId && cItem.cartKey !== key) {
                allocatedStockWithoutThis = roundStock(allocatedStockWithoutThis + (cItem.qty * cItem.multiplier));
              }
            });
            const newRequiredTotal = roundStock(allocatedStockWithoutThis + (newQty * item.multiplier));
            if (roundStock(v.stock) < roundStock(newRequiredTotal)) {
              return showAlert("คลังไม่เพียงพอ", `ไม่สามารถปรับเปลี่ยนได้เนื่องจากสินค้าคงคลังมีจำกัด`, true);
            }
          }
          item.qty = newQty;
        }
        updateCartUI();
        openCartModal();
      };

      window.openCartModal = function() {
        const modal = document.getElementById('modal-cart');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
        updateCartUI();
      };

      window.openPaymentModal = function() {
        if(cart.length === 0) return;
        closeModal('modal-cart');
        
        const total = cart.reduce((sum, item) => roundAmt(sum + (item.qty * item.price)), 0);
        const grandTotalEl = document.getElementById('pay-grand-total');
        const cashInput = document.getElementById('pay-cash-received');
        const changeEl = document.getElementById('pay-cash-change');
        if (grandTotalEl) grandTotalEl.innerText = formatMoney(total);
        if (cashInput) cashInput.value = "";
        if (changeEl) changeEl.innerText = "฿0.00";
        
        const custSelect = document.getElementById('pay-customer-select');
        if (custSelect) {
          custSelect.innerHTML = `<option value="GENERAL">ลูกค้าทั่วไป (ไม่ระบุชื่อ)</option>` + 
            Object.values(db.customers).map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');
        }

        window.switchPayTab('CASH');
        const modal = document.getElementById('modal-payment');
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };

      window.switchPayTab = function(tab) {
        activePayMethod = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById(`tab-${tab}`);
        if (activeBtn) activeBtn.classList.add('active');
        document.querySelectorAll('.pay-view').forEach(v => v.classList.add('hidden'));
        const activeViewEl = document.getElementById(`pay-view-${tab}`);
        if (activeViewEl) activeViewEl.classList.remove('hidden');
        
        if(tab === 'TRANSFER') window.onPayPromptPayIdChange();
      };

      window.selectQuickBanknote = function(val) {
        const total = cart.reduce((sum, item) => roundAmt(sum + (item.qty * item.price)), 0);
        const input = document.getElementById('pay-cash-received');
        if (!input) return;
        if (val === 'MATCH') {
          input.value = total;
        } else {
          let current = parseFloat(input.value) || 0;
          input.value = roundAmt(current + val);
        }
        window.calcChange();
      };

      window.calcChange = function() {
        const total = cart.reduce((sum, item) => roundAmt(sum + (item.qty * item.price)), 0);
        const input = document.getElementById('pay-cash-received');
        const received = input ? parseFloat(input.value) || 0 : 0;
        const change = roundAmt(received - total);
        const changeEl = document.getElementById('pay-cash-change');
        if (changeEl) changeEl.innerText = formatMoney(change > 0 ? change : 0);
      };

      window.onPayPromptPayIdChange = function() {
        const total = cart.reduce((sum, item) => roundAmt(sum + (item.qty * item.price)), 0);
        const ppInput = document.getElementById('pay-promptpay-input');
        const pp = (ppInput ? ppInput.value : '') || db.promptPayId || "0000000000";
        const url = `https://promptpay.io/${encodeURIComponent(pp)}/${total}.png`;
        const qrImg = document.getElementById('pay-promptpay-qr-img');
        if (qrImg) {
          qrImg.src = url;
          qrImg.onerror = function() {
            this.src = "https://placehold.co/200x200?text=QR+Error";
          };
        }
      };

      // บันทึกขาย (พร้อมระบบ Atomic Transaction)
      window.processPaymentRequest = async function() {
        if (!guardOnce('processPaymentRequest')) return;
        if (cart.length === 0) return;

        const success = await window.runAtomicTransaction('PROCESS_SALE', async () => {
          const total = cart.reduce((sum, item) => roundAmt(sum + (item.qty * item.price)), 0);
          const totalCost = roundAmt(cart.reduce((sum, item) => roundAmt(sum + (item.qty * (parseFloat(item.cost) || 0))), 0));
          const custSelect = document.getElementById('pay-customer-select');
          const cid = custSelect ? custSelect.value : 'GENERAL';
          let received = total;
          
          if (activePayMethod === 'CASH') {
            const input = document.getElementById('pay-cash-received');
            received = input ? parseFloat(input.value) || 0 : 0;
            if (received < total) throw new Error("ยอดเงินสดที่รับมาน้อยกว่ายอดชำระ");
          }

          if (activePayMethod === 'CREDIT' && cid === 'GENERAL') {
            throw new Error("กรุณาระบุชื่อลูกค้าเพื่อทำการบันทึกหนี้ค้างชำระ");
          }

          const requiredByVariant = {};
          cart.forEach(item => {
            requiredByVariant[item.variantId] = roundStock((requiredByVariant[item.variantId] || 0) + (item.qty * item.multiplier));
          });
          for (const vId in requiredByVariant) {
            const refItem = cart.find(i => i.variantId === vId);
            const refVariant = db.products[refItem.id] && db.products[refItem.id].variants.find(x => x.id === vId);
            if (!refVariant || roundStock(refVariant.stock) < roundStock(requiredByVariant[vId])) {
              throw new Error(`สต็อกสินค้า "${refItem.name}" มีการเปลี่ยนแปลงและไม่เพียงพอแล้ว`);
            }
          }

          const billId = getDailyBillId();
          const bill = {
            id: billId,
            time: Date.now(),
            items: cart.map(i => ({ ...i, refundedQty: 0 })),
            total: total,
            totalCost: totalCost,
            method: activePayMethod,
            customerId: cid,
            received,
            change: activePayMethod === 'CASH' ? roundAmt(received - total) : 0,
            isRefunded: false,
            sheetsSynced: false,
            refundAmount: 0,
            refundCost: 0
          };

          db.bills.push(bill);
          
          cart.forEach(item => {
            const v = db.products[item.id].variants.find(x => x.id === item.variantId);
            v.stock = roundStock(v.stock - (item.qty * item.multiplier));
          });

          if (activePayMethod === 'CASH' && db.currentShift) db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand + total);
          if (activePayMethod === 'TRANSFER' && db.currentShift) db.currentShift.transferSales = roundAmt(db.currentShift.transferSales + total);

          if (activePayMethod === 'CREDIT' && db.customers[cid]) {
            db.customers[cid].debt = roundAmt(db.customers[cid].debt + total);
          }

          if (activePayMethod !== 'CREDIT') {
            db.cashLedger.push({
              id: 'TX-' + generateID(),
              date: new Date().toISOString().slice(0, 10),
              description: `รับเงินขายหน้าร้าน บิลเลขที่ ${billId}`,
              income: total,
              expense: 0,
              type: 'income-sales',
              refId: billId
            });
          }

          logTransaction('SALE', { billId, total, method: activePayMethod, customerId: cid, itemCount: bill.items.length });

          if (db.settings.googleSheetsUrl && typeof window.sendToGoogleSheets === 'function') {
            window.sendToGoogleSheets(bill);
          }

          cart = [];
          window.cart = cart;
          if (typeof window.clearCartDraft === 'function') window.clearCartDraft();
          updateCartUI();
          closeModal('modal-payment');
          
          selectedBillForReceipt = bill;
          renderReceiptContent(bill);
          const modalReceipt = document.getElementById('modal-receipt');
          if (modalReceipt) {
            modalReceipt.classList.remove('hidden');
            modalReceipt.classList.add('flex');
          }
          showToast("บันทึกการขายสำเร็จ!");
        });

        return success;
      };

      function renderReceiptContent(bill) {
        const cName = bill.customerId !== 'GENERAL' && db.customers[bill.customerId] ? db.customers[bill.customerId].name : 'ลูกค้าทั่วไป';
        let itemsHtml = bill.items.map(i => `
          <div class="flex justify-between border-b border-dashed border-slate-200 py-1">
            <span class="flex-1">${escapeHTML(i.name)}</span>
            <span class="w-8 text-center">${i.qty}</span>
            <span class="w-16 text-right">${formatMoney(roundAmt(i.qty * i.price))}</span>
          </div>
        `).join('');

        const html = `
          <div class="space-y-3 p-4 border rounded-xl bg-white max-w-sm mx-auto text-slate-800">
            <div class="text-center">
              <h2 class="text-xl font-bold">${escapeHTML(db.storeName)}</h2>
              <p class="text-xs text-slate-500">${escapeHTML(db.storeAddress)}</p>
              <p class="text-[10px] text-slate-400 mt-1">ผู้เสียภาษี: ${escapeHTML(db.settings.taxPayerName || '-')} | เลขประจำตัว: ${escapeHTML(db.settings.taxPayerId || '-')}</p>
              <div class="border-b-2 my-2 border-slate-300"></div>
            </div>
            <div class="text-[10px] space-y-0.5">
              <p><b>เลขที่บิล:</b> ${escapeHTML(bill.id)}</p>
              <p><b>วันที่เวลา:</b> ${new Date(bill.time).toLocaleString('th-TH')}</p>
              <p><b>ลูกค้า:</b> ${escapeHTML(cName)}</p>
              <p><b>ชำระโดย:</b> ${bill.method === 'CASH' ? 'เงินสด' : bill.method === 'TRANSFER' ? 'เงินโอน' : 'ค้างชำระ (วางบิล)'}</p>
            </div>
            <div class="font-bold border-b pb-1 mb-1 flex text-[10px]">
              <span class="flex-1">รายการ</span><span class="w-8 text-center">จำนวน</span><span class="w-16 text-right">รวม</span>
            </div>
            <div class="text-[10px] space-y-1">
              ${itemsHtml}
            </div>
            <div class="mt-3 text-right text-xs">
              <div class="flex justify-between font-bold text-sm"><span>ยอดสุทธิ:</span><span>${formatMoney(bill.total)}</span></div>
              ${bill.method === 'CASH' ? `
                <div class="flex justify-between text-[10px] mt-1"><span>รับเงินสด:</span><span>${formatMoney(bill.received)}</span></div>
                <div class="flex justify-between text-[10px] font-bold text-emerald-600"><span>เงินทอน:</span><span>${formatMoney(bill.change)}</span></div>
              ` : ''}
            </div>
            <div class="text-center mt-6 text-[10px] text-slate-400 font-bold border-t pt-3">*** ขอบคุณที่ใช้บริการ ***</div>
          </div>
        `;
        const contentEl = document.getElementById('receipt-preview-content');
        if (contentEl) contentEl.innerHTML = html;
      }

      window.printReceiptDirectly = function() {
        const area = document.getElementById('print-document-area');
        const contentEl = document.getElementById('receipt-preview-content');
        const titleEl = document.getElementById('doc-viewer-title');
        const modal = document.getElementById('modal-document-viewer');
        if (area && contentEl) {
          area.innerHTML = `<div class="max-w-[80mm] mx-auto text-black bg-white">${contentEl.innerHTML}</div>`;
        }
        if (titleEl) titleEl.innerText = "📄 พิมพ์ใบเสร็จ";
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      };

      // ==========================================
      // GOOGLE SHEETS SYNCHRONIZER
      // ==========================================
      function buildBillRow(bill) {
        const cName = bill.customerId && bill.customerId !== 'GENERAL' && db.customers[bill.customerId] ? db.customers[bill.customerId].name : 'ลูกค้าทั่วไป';
        const methodLabel = bill.method === 'CASH' ? 'เงินสด' : bill.method === 'TRANSFER' ? 'เงินโอน (QR)' : 'ค้างชำระ (วางบิล)';
        return [
          bill.id, new Date(bill.time).toLocaleString('th-TH'), bill.customerId || '', cName, methodLabel,
          bill.total, bill.totalCost, roundAmt(bill.total - bill.totalCost), (bill.items || []).length,
          bill.isRefunded ? 'คืนเต็มจำนวน' : ((bill.refundAmount || 0) > 0 ? 'คืนบางส่วน' : 'ปกติ'),
          bill.refundAmount || 0,
          new Date().toISOString()
        ];
      }

      function buildBillItemRows(bill) {
        return (bill.items || []).map(i => [
          bill.id, i.id || '', i.variantId || '', i.name, i.sizeName || '',
          i.qty, i.multiplier || 1, i.price, i.cost,
          roundAmt(i.qty * i.price), i.refundedQty || 0
        ]);
      }

      async function pushBillToSheets(url, bill) {
        if (typeof SHEETS === 'undefined') return;
        await fetchWithRetry(url, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: 'appendRows', sheetName: SHEETS.sales.sheetName, headers: SHEETS.sales.headers, rows: [buildBillRow(bill)] })
        });
        const itemRows = buildBillItemRows(bill);
        if (itemRows.length > 0) {
          await fetchWithRetry(url, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: 'appendRows', sheetName: SHEETS.saleItems.sheetName, headers: SHEETS.saleItems.headers, rows: itemRows })
          });
        }
      }

      window.sendToGoogleSheets = async function(bill) {
        const url = db.settings.googleSheetsUrl;
        if (!url) return;

        try {
          await pushBillToSheets(url, bill);
          bill.sheetsSynced = true;
          persist();
        } catch (err) {
          console.error("Sheets sync error after retries:", err);
          bill.sheetsSynced = false;
          persist();
        }
      };

      window.testSheetsIntegration = async function() {
        const urlInput = document.getElementById('setting-sheets-url');
        const url = urlInput ? urlInput.value.trim() : '';
        if(!url) return showAlert("ไม่พบ URL", "กรุณาระบุ URL ของ Google Apps Script ก่อนทำการทดสอบ", true);

        showToast("กำลังส่งข้อมูลทดสอบ...");
        try {
          await fetchWithRetry(url, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: 'ping' })
          });
          showAlert("ส่งข้อมูลเชื่อมต่อสำเร็จ!", "ระบบส่งข้อมูลทดสอบสำเร็จแล้ว", false);
        } catch (err) {
          showAlert("เชื่อมต่อล้มเหลว", "เกิดข้อผิดพลาด: " + err.message, true);
        }
      };

      window.manualSheetsSyncAll = async function() {
        const url = db.settings.googleSheetsUrl;
        if(!url) return showAlert("ไม่พบการตั้งค่า", "กรุณากรอก Google Sheets Web App URL ในช่องตั้งค่าก่อน", true);

        const pendingBills = db.bills.filter(b => !b.sheetsSynced);
        if (pendingBills.length === 0) {
          return showAlert("ไม่มีข้อมูลค้างส่ง", "บิลขายทั้งหมดในระบบได้รับการซิงค์เรียบร้อยแล้ว", false);
        }

        showToast(`กำลังส่งข้อมูล ${pendingBills.length} บิลเข้าระบบ...`);
        let successCount = 0;

        for (let bill of pendingBills) {
          try {
            await pushBillToSheets(url, bill);
            bill.sheetsSynced = true;
            successCount++;
          } catch(e) {
            console.error("Single sync fail:", e);
          }
        }

        persist();
        updateSheetsPendingCount();
        showAlert("สิ้นสุดการซิงค์ข้อมูล", `ประมวลผลสำเร็จ ${successCount} บิล จากยอดค้างส่งทั้งหมด ${pendingBills.length} บิล`, false);
      };

      function updateSheetsPendingCount() {
        const count = db.bills.filter(b => !b.sheetsSynced).length;
        const el = document.getElementById('sheets-pending-count');
        if (el) el.innerText = count;
      }

      // ==========================================
      // OPERATIONAL EXPENSES RECORDING
      // ==========================================
      window.addOperationalExpense = function() {
        const catSelect = document.getElementById('expense-cat-select');
        const noteInput = document.getElementById('expense-note-input');
        const amtInput = document.getElementById('expense-amt-input');
        const type = catSelect ? catSelect.value : 'other';
        const note = noteInput ? noteInput.value.trim() : '';
        const amt = amtInput ? parseFloat(amtInput.value) : 0;

        if(!amt || amt <= 0) return showAlert("กรอกข้อมูลไม่ครบ", "กรุณาระบุจำนวนรายจ่ายที่ถูกต้อง", true);
        if(!db.currentShift) return showAlert("ยังไม่เปิดกะ", "ต้องเปิดกะการขายเพื่อลงยอดหักจากลิ้นชัก", true);

        if(amt > db.currentShift.cashOnHand) {
          return showAlert("เงินสดไม่พอจ่าย", "จำนวนเงินสดในลิ้นชักเหลือน้อยกว่ายอดรายจ่ายที่จะตัดจ่ายจริง", true);
        }

        const typeTh = type === 'water' ? 'ค่าน้ำประปาร้าน' : type === 'electricity' ? 'ค่าไฟฟ้าของร้าน' : type === 'salary' ? 'ค่าแรงพนักงาน' : type === 'rent' ? 'ค่าเช่าที่/อาคาร' : 'รายจ่ายดำเนินงานอื่นๆ';

        window.openManagerPinModal(() => {
          window.showCustomConfirm(
            "ยืนยันบันทึกรายจ่าย?",
            `${typeTh} จำนวน ${formatMoney(amt)} จะถูกหักออกจากเงินสดในลิ้นชักทันที`,
            () => {
              db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand - amt);
              db.currentShift.transactions.push({
                time: Date.now(),
                type: 'OUT',
                cat: `รายจ่าย-${type}`,
                note: note || 'รายจ่ายดำเนินงานร้านค้า',
                amt: amt
              });

              db.cashLedger.push({
                id: 'TX-' + generateID(),
                date: new Date().toISOString().slice(0, 10),
                description: `จ่ายค่าใช้จ่ายร้าน: ${typeTh} (${note || 'ไม่มีระบุ'})`,
                income: 0,
                expense: amt,
                type: `expense-${type}`,
                refId: 'OP-' + generateID()
              });

              if (noteInput) noteInput.value = "";
              if (amtInput) amtInput.value = "";

              persist();
              updateShiftUI();
              showToast(`บันทึกจ่าย ${typeTh} ลงระบบเรียบร้อย`);
            }
          );
        });
      };

      // ==========================================
      // SHIFT & CASH DRAWER PROCESS
      // ==========================================
      function updateShiftUI() {
        const closedUi = document.getElementById('shift-closed-ui');
        const openUi = document.getElementById('shift-open-ui');
        const cashDisp = document.getElementById('drawer-cash-display');
        const transDisp = document.getElementById('drawer-transfer-display');
        const pill = document.getElementById('shift-status-pill');

        if(db.currentShift) {
          if (closedUi) closedUi.classList.add('hidden');
          if (openUi) openUi.classList.remove('hidden');
          if (cashDisp) cashDisp.innerText = formatMoney(db.currentShift.cashOnHand);
          if (transDisp) transDisp.innerText = formatMoney(db.currentShift.transferSales);
          if (pill) {
            pill.innerText = "OPEN";
            pill.className = "text-[8px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 font-black mt-1 inline-block";
          }
        } else {
          if (closedUi) closedUi.classList.remove('hidden');
          if (openUi) openUi.classList.add('hidden');
          if (pill) {
            pill.innerText = "CLOSED";
            pill.className = "text-[8px] px-2 py-1 rounded-full bg-rose-50 text-rose-500 font-black mt-1 inline-block";
          }
        }
      }
      window.updateShiftUI = updateShiftUI;

      window.startShift = function() {
        const input = document.getElementById('opening-cash-input');
        const initial = input ? parseFloat(input.value) || 0 : 0;
        db.currentShift = {
          id: 'SH-' + generateID(),
          startTime: Date.now(),
          openingCash: initial,
          cashOnHand: initial,
          transferSales: 0,
          transactions: []
        };
        persist(); updateShiftUI();
        showToast("เปิดกะการขายสำเร็จ");
      };

      window.addShiftTx = function(type) {
        const catSelect = document.getElementById('shift-trans-cat');
        const noteInput = document.getElementById('shift-trans-note');
        const amtInput = document.getElementById('shift-trans-amt');
        const cat = catSelect ? catSelect.value : '';
        const note = noteInput ? noteInput.value.trim() : '';
        const amt = amtInput ? parseFloat(amtInput.value) : 0;

        if(!amt || amt <= 0) return showAlert("กรอกข้อมูลไม่ครบ", "กรุณาระบุจำนวนเงินที่ถูกต้อง", true);
        
        if(type === 'OUT' && db.currentShift && amt > db.currentShift.cashOnHand) {
          return showAlert("เงินในลิ้นชักไม่พอ", "ไม่สามารถดึงเงินออกเกินกว่าที่มีในลิ้นชักได้", true);
        }

        window.openManagerPinModal(() => {
          window.showCustomConfirm(
            type === 'IN' ? "ยืนยันนำเงินเข้าลิ้นชัก?" : "ยืนยันดึงเงินออกจากลิ้นชัก?",
            `จำนวน ${formatMoney(amt)}${note ? ' — ' + note : ''}`,
            () => {
              if (db.currentShift) {
                db.currentShift.transactions.push({ time: Date.now(), type, cat, note, amt });
                if(type === 'IN') db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand + amt);
                else db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand - amt);
              }
              
              if (noteInput) noteInput.value = "";
              if (amtInput) amtInput.value = "";
              persist(); updateShiftUI();
              showToast(`บันทึก${type === 'IN' ? 'นำเงินเข้า' : 'ดึงเงินออก'}สำเร็จ`);
            }
          );
        });
      };

      window.closeShiftProcess = function() {
        if (!guardOnce('closeShiftProcess')) return;
        window.showCustomConfirm("ต้องการปิดกะใช่หรือไม่?", "ยอดทั้งหมดจะถูกสรุปเป็น Z-Report และลิ้นชักจะถูกล็อค ระบบจะสำรองข้อมูลทั้งหมดเป็นไฟล์ดาวน์โหลดให้อัตโนมัติด้วย", () => {
          if (db.currentShift) {
            db.currentShift.endTime = Date.now();
            const s = {...db.currentShift};
            db.shifts.push(s);
            db.currentShift = null;
            persist(); updateShiftUI();
            printZReport(s);
            if (typeof runAutoBackupNow === 'function') {
              runAutoBackupNow("AutoBackup_ShiftClose");
            }
            window.lockManagerSessionNow();
          }
        });
      };

      function printZReport(shift) {
        const area = document.getElementById('print-document-area');
        const titleEl = document.getElementById('doc-viewer-title');
        const modal = document.getElementById('modal-document-viewer');

        let txRows = (shift.transactions || []).map(tx => `
          <tr class="border-b text-[10px] text-slate-600">
            <td class="p-2">${new Date(tx.time).toLocaleTimeString('th-TH')}</td>
            <td class="p-2">${tx.type === 'IN' ? 'เงินเข้า' : 'เงินออก'}</td>
            <td class="p-2"><b>${escapeHTML(tx.cat)}</b><br>${escapeHTML(tx.note)}</td>
            <td class="p-2 text-right ${tx.type === 'IN' ? 'text-emerald-600' : 'text-rose-500'}">${tx.type === 'IN' ? '+' : '-'}${formatMoney(tx.amt)}</td>
          </tr>
        `).join('');

        if(!txRows) txRows = `<tr><td colspan="4" class="p-4 text-center text-slate-400">ไม่มีรายการปรับปรุงเงินสด</td></tr>`;

        if (area) {
          area.innerHTML = `
            <div class="space-y-4 max-w-lg mx-auto p-4 border rounded-xl">
              <div class="text-center">
                <h2 class="text-xl font-bold">${escapeHTML(db.storeName)}</h2>
                <p class="text-xs text-slate-500">รายงานสรุปกะแคชเชียร์ (Z-Report)</p>
                <div class="border-b-2 my-2 border-slate-300"></div>
              </div>
              <div class="text-xs space-y-1">
                <p><b>กะเลขที่:</b> ${escapeHTML(shift.id)}</p>
                <p><b>เวลาเริ่มต้น:</b> ${new Date(shift.startTime).toLocaleString('th-TH')}</p>
                <p><b>เวลาปิดกะ:</b> ${new Date(shift.endTime).toLocaleString('th-TH')}</p>
              </div>
              
              <div class="bg-slate-50 p-3 rounded-lg border text-xs space-y-1">
                <div class="flex justify-between"><span>เงินเริ่มต้นกะ:</span><b class="text-slate-700">${formatMoney(shift.openingCash)}</b></div>
                <div class="flex justify-between"><span>ยอดขายเงินโอน (Transfer):</span><b class="text-emerald-600">${formatMoney(shift.transferSales)}</b></div>
                <div class="flex justify-between text-base border-t pt-1 mt-1 font-bold">
                  <span>ยอดเงินสดคงเหลือรวม:</span><span class="text-indigo-600">${formatMoney(shift.cashOnHand)}</span>
                </div>
              </div>

              <h4 class="text-xs font-bold border-b pb-1">บันทึกการปรับปรุงเงินสด เข้า-ออก</h4>
              <table class="w-full text-left text-xs border">
                <thead class="bg-slate-50">
                  <tr><th class="p-2">เวลา</th><th class="p-2">แบบ</th><th class="p-2">รายการ</th><th class="p-2 text-right">จำนวน</th></tr>
                </thead>
                <tbody>${txRows}</tbody>
              </table>
            </div>
          `;
        }
        if (titleEl) titleEl.innerText = "📄 พิมพ์ใบรายงานปิดกะ (Z-Report)";
        if (modal) {
          modal.classList.remove('hidden');
          modal.classList.add('flex');
        }
      }


/* END */

/* START part2.js */
// ==========================================
// SMART POS PRO — PART 2 of 3 (plain <script>, no build step)
// Stock table, categories, customers, history/refund, reports, stock count, purchase orders, scanner
// Loaded in order via <script> tags in index.html — this file shares the
// same global scope as the other parts, so functions/variables defined in
// any part are usable from any other part. Load order in index.html matters
// (Part 1 must load before Part 2, etc.) but call order does not — a
// function only needs to EXIST by the time it's actually invoked (e.g. a
// button click), not by the time the file that calls it was parsed.
// ==========================================

      // PRODUCT CRUD & MANAGEMENT (SUB-UNITS FRACTIONS)
      // ==========================================
      // Shared fallback for any <img> showing a product's real photo: if the
      // link is broken/unreachable, replace the <img> element itself with the
      // emoji icon span — built via real DOM APIs (not string concatenation),
      // so there's never a moment where both the broken image AND the emoji
      // exist in the DOM at once, and no HTML-escaping edge cases to get wrong.
      window.handleProductImgError = function(imgEl) {
        const emoji = imgEl.dataset.fallbackEmoji || '📦';
        const pid = imgEl.dataset.pid || '';
        const span = document.createElement('span');
        span.className = 'inline-edit-cell';
        span.textContent = emoji;
        if (pid) {
          span.onclick = () => window.inlineEditField('product', pid, null, null, 'image', span, 'text');
        }
        imgEl.replaceWith(span);
      };

      window.previewProductImageUrl = function() {
        const url = document.getElementById('p-image-url').value.trim();
        const preview = document.getElementById('p-image-url-preview');
        if (url) {
          preview.src = url;
          preview.classList.remove('hidden');
          preview.onerror = () => { preview.classList.add('hidden'); };
        } else {
          preview.classList.add('hidden');
          preview.src = '';
        }
      };

      window.openProductModal = function(id = null) {
        window.openManagerPinModal(() => {
          const checkboxes = db.categories.map(c => `
            <label class="flex items-center space-x-2"><input type="checkbox" name="p-cat-chk" value="${escapeHTML(c.name)}"><span>${escapeHTML(c.name)}</span></label>
          `).join('');
          document.getElementById('p-cat-checkboxes').innerHTML = checkboxes;

          if (id && db.products[id]) {
            const p = db.products[id];
            document.getElementById('prod-modal-title').innerText = "แก้ไขสินค้า";
            document.getElementById('edit-p-id').value = p.id;
            document.getElementById('p-name').value = p.name;
            document.getElementById('p-image').value = p.image || '';
            document.getElementById('p-image-url').value = p.imageUrl || '';
            window.previewProductImageUrl();
            document.getElementById('btn-delete-p').classList.remove('hidden');

            document.getElementById('p-group-enabled').checked = !!p.groupName;
            document.getElementById('p-group-name').value = p.groupName || '';
            window.toggleGroupNameField();
            
            if(p.cat) {
              document.querySelectorAll('input[name="p-cat-chk"]').forEach(el => {
                if(p.cat.includes(el.value)) el.checked = true;
              });
            }

            const vContainer = document.getElementById('variant-list-container');
            vContainer.innerHTML = '';
            p.variants.forEach(v => appendVariantHTML(v));
          } else {
            document.getElementById('prod-modal-title').innerText = "เพิ่มสินค้าใหม่";
            document.getElementById('edit-p-id').value = "";
            document.getElementById('p-name').value = "";
            document.getElementById('p-image').value = "";
            document.getElementById('p-image-url').value = "";
            window.previewProductImageUrl();
            document.getElementById('btn-delete-p').classList.add('hidden');
            document.getElementById('variant-list-container').innerHTML = '';

            document.getElementById('p-group-enabled').checked = false;
            document.getElementById('p-group-name').value = '';
            window.toggleGroupNameField();

            appendVariantHTML();
          }
          document.getElementById('modal-product').classList.remove('hidden');
          document.getElementById('modal-product').classList.add('flex');
        });
      };

      window.toggleGroupNameField = function() {
        const enabled = document.getElementById('p-group-enabled').checked;
        const field = document.getElementById('p-group-name');
        field.disabled = !enabled;
        if (!enabled) field.value = '';
      };

      window.addVariantRow = function() {
        appendVariantHTML();
      };

      window.addFractionRow = function(variantId) {
        appendFractionHTML(variantId);
      };

      function appendVariantHTML(v = null) {
        const id = v ? v.id : 'V-' + generateID();
        const sizeName = v ? v.sizeName : 'ขนาดปกติ';
        const barcode = v ? v.barcode : 'AUTO-' + db.counters.barcode++;
        const cost = v ? roundAmt(v.cost) : 0;
        const price = v ? roundAmt(v.price) : 0;
        const stock = v ? roundStock(v.stock) : 0;
        const minStock = v ? roundStock(v.minStock) : 10;

        const html = `
          <div class="variant-row bg-slate-50 p-4 rounded-2xl border border-slate-200/80 mb-4" data-vid="${escapeHTML(id)}">
            <div class="flex justify-between items-center mb-2">
              <span class="text-xs font-bold text-indigo-600">รหัสย่อย: ${escapeHTML(id)}</span>
              <button type="button" onclick="this.closest('.variant-row').remove()" class="text-[10px] text-rose-500 font-bold bg-rose-50 px-2.5 py-1 rounded">ลบตัวเลือกนี้</button>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs text-slate-800">
              <div class="col-span-2 sm:col-span-1"><label class="block text-slate-500 mb-1">ชื่อตัวเลือก</label><input type="text" class="v-size w-full border p-2 rounded" value="${escapeHTML(sizeName)}"></div>
              <div class="col-span-2 sm:col-span-1"><label class="block text-slate-500 mb-1">บาร์โค้ด</label><input type="text" class="v-barcode w-full border p-2 rounded font-mono" value="${escapeHTML(barcode)}"></div>
              <div><label class="block text-slate-500 mb-1">ทุน</label><input type="number" class="v-cost w-full border p-2 rounded" value="${cost}"></div>
              <div><label class="block text-slate-500 mb-1">ราคาขาย</label><input type="number" class="v-price w-full border p-2 rounded font-bold text-indigo-600" value="${price}"></div>
              <div><label class="block text-slate-500 mb-1">สต็อก</label><input type="number" class="v-stock w-full border p-2 rounded" value="${stock}"></div>
              <div><label class="block text-slate-500 mb-1">เตือนเมื่อต่ำกว่า</label><input type="number" class="v-min w-full border p-2 rounded" value="${minStock}"></div>
            </div>
            
            <div class="mt-3 border-t border-dashed border-slate-200 pt-3">
              <div class="flex justify-between items-center">
                <span class="text-[11px] font-bold text-slate-500 flex items-center gap-1">✂️ การแบ่งขาย/หน่วยย่อย (เช่น ซื้อกล่องตัดขายตัว, สายไฟตัดเมตร)</span>
                <button type="button" onclick="window.addFractionRow('${escapeHTML(id)}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold shadow-sm btn-touch">
                  + เพิ่มหน่วยแบ่งขาย
                </button>
              </div>
              <div class="fraction-container space-y-2 mt-2" id="fraction-container-${escapeHTML(id)}"></div>
            </div>
          </div>
        `;
        document.getElementById('variant-list-container').insertAdjacentHTML('beforeend', html);

        if (v && v.fractions) {
          v.fractions.forEach(f => appendFractionHTML(id, f));
        }
      }

      function appendFractionHTML(variantId, f = null) {
        const fid = f ? f.id : 'F-' + generateID();
        const fractionName = f ? f.fractionName : '';
        const fractionMultiplier = f ? roundStock(f.fractionMultiplier) : 1;
        const fractionPrice = f ? roundAmt(f.fractionPrice) : 0;

        const html = `
          <div class="fraction-row bg-white border border-dashed border-emerald-300 p-2.5 rounded-xl flex flex-wrap sm:flex-nowrap items-center gap-2" data-fid="${escapeHTML(fid)}">
            <div class="flex-1 min-w-[120px]">
              <label class="block text-[9px] text-slate-400 font-bold mb-0.5">ชื่อหน่วยย่อย (เช่น เมตรละ, ตัวย่อย)</label>
              <input type="text" class="f-name w-full border p-1 rounded text-xs font-bold text-slate-700" value="${escapeHTML(fractionName)}" placeholder="เมตรละ, ถุงย่อย">
            </div>
            <div class="w-24">
              <label class="block text-[9px] text-slate-400 font-bold mb-0.5">ตัวคูณ (เช่น 0.01)</label>
              <input type="number" step="any" class="f-multiplier w-full border p-1 rounded text-xs font-bold text-center text-slate-700" value="${fractionMultiplier}" placeholder="0.25">
            </div>
            <div class="w-24">
              <label class="block text-[9px] text-slate-400 font-bold mb-0.5">ราคาขายย่อย</label>
              <input type="number" step="any" class="f-price w-full border p-1 rounded text-xs font-bold text-center text-emerald-600" value="${fractionPrice}" placeholder="15">
            </div>
            <div class="pt-3">
              <button type="button" onclick="this.closest('.fraction-row').remove()" class="text-xs text-rose-500 font-bold px-2.5 py-1 bg-rose-50 hover:bg-rose-100 rounded">ลบ</button>
            </div>
          </div>
        `;
        document.getElementById(`fraction-container-${variantId}`).insertAdjacentHTML('beforeend', html);
      }

      window.saveProduct = function() {
        if (!guardOnce('saveProduct')) return;
        const id = document.getElementById('edit-p-id').value || 'P-' + generateID();
        const name = document.getElementById('p-name').value.trim();
        const image = document.getElementById('p-image').value.trim();
        const imageUrl = document.getElementById('p-image-url').value.trim();
        if(!name) return showAlert("ข้อมูลไม่ครบ", "กรุณาระบุชื่อสินค้าหลัก", true);

        const groupEnabled = document.getElementById('p-group-enabled').checked;
        const groupName = window.repairThaiText(document.getElementById('p-group-name').value.trim());
        if (groupEnabled && !groupName) {
          return showAlert("ข้อมูลไม่ครบ", "เปิดใช้ \"การ์ดร่วมกับสินค้าอื่น\" แล้ว กรุณาระบุชื่อกลุ่มสินค้าด้วย", true);
        }

        const cats = [];
        document.querySelectorAll('input[name="p-cat-chk"]:checked').forEach(el => cats.push(el.value));

        const variants = [];
        let validationError = false;

        document.querySelectorAll('.variant-row').forEach(row => {
          const vid = row.dataset.vid;
          const fractions = [];
          
          row.querySelectorAll('.fraction-row').forEach(fRow => {
            const fid = fRow.dataset.fid;
            const fName = fRow.querySelector('.f-name').value.trim();
            const fMultiplier = roundStock(parseFloat(fRow.querySelector('.f-multiplier').value) || 0);
            const fPrice = roundAmt(parseFloat(fRow.querySelector('.f-price').value) || 0);

            if (fName) {
              fractions.push({
                id: fid,
                fractionName: fName,
                fractionMultiplier: fMultiplier,
                fractionPrice: fPrice
              });
            } else {
              validationError = true;
            }
          });

          const vSize = row.querySelector('.v-size').value.trim();
          if (vSize) {
            const vCost = roundAmt(parseFloat(row.querySelector('.v-cost').value) || 0);
            const vPrice = roundAmt(parseFloat(row.querySelector('.v-price').value) || 0);
            const vStock = roundStock(parseFloat(row.querySelector('.v-stock').value) || 0);
            const vMin = roundStock(parseFloat(row.querySelector('.v-min').value) || 0);
            const vBarcode = row.querySelector('.v-barcode').value.trim() || ('AUTO-' + db.counters.barcode++);
            if (vCost < 0 || vPrice < 0 || vStock < 0 || vMin < 0) validationError = 'negative';
            variants.push({
              id: vid,
              sizeName: vSize,
              barcode: vBarcode,
              cost: vCost,
              price: vPrice,
              stock: vStock,
              minStock: vMin,
              fractions: fractions
            });
          }
        });

        if(variants.length === 0) return showAlert("ข้อมูลไม่ครบ", "ต้องมีอย่างน้อย 1 ขนาด/ตัวเลือก", true);
        if(validationError === 'negative') return showAlert("ข้อมูลไม่ถูกต้อง", "ราคาทุน ราคาขาย สต็อก และสต็อกขั้นต่ำ ต้องไม่ติดลบ", true);
        if(validationError) return showAlert("ข้อมูลไม่ครบ", "กรุณากรอกชื่อหน่วยย่อยของการแบ่งขายให้สมบูรณ์ หรือลบส่วนที่ไม่ได้ใช้ออก", true);

        // Reject barcodes already used by a DIFFERENT product's variant — importing/typing
        // a duplicate barcode would make barcode-scan checkout add the wrong item to cart.
        const dupBarcode = variants.find(v => v.barcode && Object.values(db.products).some(p =>
          p.id !== id && !p.isDeleted && p.variants.some(ov => ov.barcode === v.barcode)
        ));
        if (dupBarcode) return showAlert("บาร์โค้ดซ้ำ", `บาร์โค้ด "${dupBarcode.barcode}" ถูกใช้กับสินค้าอื่นอยู่แล้ว กรุณาใช้บาร์โค้ดอื่น`, true);

        // ป้องกันข้อผิดพลาดขายต่ำกว่าทุน: ตรวจทุกขนาดและทุกตัวเลือกแบ่งขาย ถ้าราคาขาย < ทุน
        // (ทุนของหน่วยแบ่งขายคำนวณจากทุนของขนาดหลัก × อัตราส่วน เหมือนตอนคิดต้นทุนขายจริง)
        // ให้เตือนและต้องกดยืนยันซ้ำก่อนบันทึก ไม่บล็อกเด็ดขาดเพราะบางร้านตั้งใจขายขาดทุนเพื่อระบาย
        // สินค้าเป็นครั้งคราว แต่ต้องรู้ตัวก่อนกดบันทึกเสมอ
        const underCostIssues = [];
        variants.forEach(v => {
          if (v.price > 0 && v.cost > 0 && v.price < v.cost) {
            underCostIssues.push(`ขนาด "${v.sizeName}": ขาย ${formatMoney(v.price)} ต่ำกว่าทุน ${formatMoney(v.cost)}`);
          }
          (v.fractions || []).forEach(f => {
            const impliedCost = roundAmt(v.cost * f.fractionMultiplier);
            if (f.fractionPrice > 0 && impliedCost > 0 && f.fractionPrice < impliedCost) {
              underCostIssues.push(`แบ่งขาย "${v.sizeName} - ${f.fractionName}": ขาย ${formatMoney(f.fractionPrice)} ต่ำกว่าทุนโดยประมาณ ${formatMoney(impliedCost)}`);
            }
          });
        });

        const doCommit = () => window.__commitSaveProduct(id, name, image, imageUrl, cats, variants, groupName);

        if (underCostIssues.length > 0) {
          window.showCustomConfirm(
            "⚠️ พบราคาขายต่ำกว่าทุน",
            `รายการต่อไปนี้จะขาดทุนถ้าขาย: ${underCostIssues.join(' / ')} — ยืนยันบันทึกต่อหรือไม่?`,
            doCommit
          );
        } else {
          doCommit();
        }
      };

      window.__commitSaveProduct = function(id, name, image, imageUrl, cats, variants, groupName) {
        const isNew = !db.products[id];
        db.products[id] = { id, name, image, imageUrl, cat: cats, variants, isDeleted: false, groupName: groupName || '' };
        
        // Trigger optimized persistence if available
        if (typeof window.decoupledPersist === 'function') {
          window.decoupledPersist(['products']);
        } else {
          persist();
        }
        
        closeModal('modal-product'); showToast("บันทึกสินค้าสำเร็จ");
        logTransaction(isNew ? 'PRODUCT_CREATE' : 'PRODUCT_EDIT', { productId: id, name, variantCount: variants.length });
        if(activeView === 'stock') window.renderStock();
      };

      window.deleteProductAction = function() {
        if (!guardOnce('deleteProductAction')) return;
        const id = document.getElementById('edit-p-id').value;
        if (!id || !db.products[id]) return;
        
        window.showCustomConfirm("ต้องการระงับการขายสินค้านี้?", "สินค้านี้จะไม่แสดงในหน้าหลักและหน้าระงับขายอีกต่อไป", () => {
          db.products[id].isDeleted = true;
          
          if (typeof window.decoupledPersist === 'function') {
            window.decoupledPersist(['products']);
          } else {
            persist();
          }

          logTransaction('PRODUCT_SUSPEND', { productId: id, name: db.products[id].name });
          closeModal('modal-product');
          window.renderStock();
          showToast("ระงับการขายเรียบร้อย");
        });
      };

      // ==========================================
      // STOCKS TABLE (PAGINATED & GOOGLE-SHEET STYLE)
      // ==========================================

      // Column definitions for the spreadsheet-style product table.
      const STOCK_COLUMNS = [
        { key: 'cat',      label: '📁 หมวดหมู่',        filter: 'select' },
        { key: 'addVar',   label: '➕ ไซส์/สี',          filter: null },
        { key: 'image',    label: '🖼️ รูป',             filter: null },
        { key: 'code',     label: '🔢 รหัสสินค้า',       filter: 'text' },
        { key: 'barcode',  label: '📊 บาร์โค้ด',         filter: 'text' },
        { key: 'name',     label: '🏷️ ชื่อสินค้า',       filter: 'text' },
        { key: 'size',     label: '📐 ขนาด/สี/ยี่ห้อ',   filter: 'text' },
        { key: 'cost',     label: '💰 ทุน',              filter: null },
        { key: 'price',    label: '🏷️ ราคาขาย',         filter: null },
        { key: 'stock',    label: '📦 จำนวน/หน่วยนับ',   filter: null },
        { key: 'addFrac',  label: '➕ แบ่งขาย',          filter: null },
        { key: 'fractions',label: '✂️ หน่วยย่อย/ตัวคูณ/ราคาย่อย', filter: null },
        { key: 'actions',  label: '⚙️ จัดการ',           filter: null }
      ];
      const STOCK_COUNT_COLUMNS = [
        { key: 'countedQty',  label: '📋 จำนวนที่นับได้', filter: null },
        { key: 'countedNote', label: '📝 หมายเหตุ',       filter: null }
      ];

      let columnVisibility = {};
      try { columnVisibility = JSON.parse(localStorage.getItem('posStockColumnVisibility') || '{}'); } catch(e) { columnVisibility = {}; }
      STOCK_COLUMNS.forEach(c => { if (columnVisibility[c.key] === undefined) columnVisibility[c.key] = true; });

      let stockFilters = { code: '', barcode: '', name: '', size: '' };
      window.stockCountMode = false;
      window.stockCountDraft = {}; // variantId -> {qty, note}

      // Pagination Variables
      window.stockCurrentPage = 1;
      window.stockItemsPerPage = 50;

      window.changeStockPage = function(page) {
        window.stockCurrentPage = page;
        window.renderStock();
      };

      window.changeStockItemsPerPage = function(val) {
        window.stockItemsPerPage = parseInt(val);
        window.stockCurrentPage = 1;
        window.renderStock();
      };

      function saveColumnVisibility() {
        localStorage.setItem('posStockColumnVisibility', JSON.stringify(columnVisibility));
      }

      window.toggleColumnPanel = function() {
        const panel = document.getElementById('column-panel');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
          const list = document.getElementById('column-panel-list');
          list.innerHTML = STOCK_COLUMNS.map(c => `
            <label class="flex items-center gap-1.5 bg-slate-50 border rounded-xl px-2 py-1.5 cursor-pointer font-bold text-slate-700">
              <input type="checkbox" class="w-3.5 h-3.5" ${columnVisibility[c.key] ? 'checked' : ''} onchange="window.toggleColumn('${c.key}', this.checked)">
              <span>${c.label}</span>
            </label>`).join('');
        }
      };

      window.toggleColumn = function(key, checked) {
        columnVisibility[key] = checked;
        saveColumnVisibility();
        window.renderStock();
      };

      window.toggleStockCountMode = function() {
        window.stockCountMode = !window.stockCountMode;
        window.stockCountDraft = {};
        document.getElementById('stock-count-mode-bar').classList.toggle('hidden', !window.stockCountMode);
        const btn = document.getElementById('btn-toggle-count-mode');
        btn.classList.toggle('ring-4', window.stockCountMode);
        btn.classList.toggle('ring-emerald-300', window.stockCountMode);
        window.stockCurrentPage = 1; // Reset page to 1
        window.renderStock();
      };

      window.addNewProductRow = function() {
        window.openManagerPinModal(() => {
          const id = 'P-' + generateID();
          const vId = 'V-' + generateID();
          db.products[id] = {
            id, name: 'สินค้าใหม่ (แตะเพื่อแก้ไขชื่อ)', code: id, image: '📦',
            cat: db.categories.length ? [db.categories[0].name] : [],
            isDeleted: false,
            variants: [{ id: vId, sizeName: 'ปกติ', barcode: 'AUTO-' + db.counters.barcode++, cost: 0, price: 0, stock: 0, minStock: 10, unit: 'ชิ้น', fractions: [] }]
          };
          persist();
          window.renderStock();
          showToast("เพิ่มสินค้าใหม่แล้ว กรอกข้อมูลในตารางได้เลย");
        });
      };

      window.addInlineVariant = function(productId) {
        const p = db.products[productId];
        if (!p) return;
        p.variants.push({ id: 'V-' + generateID(), sizeName: 'ระบุขนาด/สี', barcode: 'AUTO-' + db.counters.barcode++, cost: 0, price: 0, stock: 0, minStock: 10, unit: (p.variants[0] && p.variants[0].unit) || 'ชิ้น', fractions: [] });
        persist();
        window.renderStock();
      };

      window.removeVariantRow = function(productId, variantId) {
        window.openManagerPinModal(() => {
          window.showCustomConfirm("ลบขนาด/สีนี้?", "รายการนี้จะถูกลบออกจากสินค้าถาวร", () => {
            const p = db.products[productId];
            if (!p) return;
            p.variants = p.variants.filter(v => v.id !== variantId);
            if (p.variants.length === 0) p.isDeleted = true;
            persist();
            window.renderStock();
            showToast("ลบรายการเรียบร้อย");
          });
        });
      };

      window.addInlineFraction = function(productId, variantId) {
        const p = db.products[productId];
        if (!p) return;
        const v = p.variants.find(x => x.id === variantId);
        if (!v) return;
        if (!v.fractions) v.fractions = [];
        v.fractions.push({ id: 'F-' + generateID(), fractionName: 'หน่วยย่อยใหม่', fractionMultiplier: 0.1, fractionPrice: 0 });
        persist();
        window.renderStock();
      };

      window.removeFraction = function(productId, variantId, fractionId) {
        window.openManagerPinModal(() => {
          window.showCustomConfirm("ลบหน่วยย่อยแบ่งขายนี้?", "รายการนี้จะถูกลบออกถาวร", () => {
            const p = db.products[productId];
            if (!p) return;
            const v = p.variants.find(x => x.id === variantId);
            if (!v) return;
            v.fractions = (v.fractions || []).filter(f => f.id !== fractionId);
            persist();
            window.renderStock();
            showToast("ลบรายการเรียบร้อย");
          });
        });
      };

      // Generic inline editor for any text/number field on a product, variant, or fraction.
      const PIN_GATED_STOCK_FIELDS = ['cost', 'price', 'stock', 'fractionMultiplier', 'fractionPrice'];

      window.inlineEditField = function(type, productId, variantId, fractionId, field, element, inputType) {
        if (PIN_GATED_STOCK_FIELDS.includes(field)) {
          window.openManagerPinModal(() => {
            window.__inlineEditFieldStart(type, productId, variantId, fractionId, field, element, inputType);
          });
        } else {
          window.__inlineEditFieldStart(type, productId, variantId, fractionId, field, element, inputType);
        }
      };

      window.__inlineEditFieldStart = function(type, productId, variantId, fractionId, field, element, inputType) {
        if (element.querySelector('input, select')) return;
        const p = db.products[productId];
        if (!p) return;
        let obj = p;
        if (type === 'variant') obj = p.variants.find(x => x.id === variantId);
        if (type === 'fraction') {
          const v = p.variants.find(x => x.id === variantId);
          obj = v ? (v.fractions || []).find(f => f.id === fractionId) : null;
        }
        if (!obj) return;

        const currentValue = obj[field] !== undefined ? obj[field] : '';
        const input = document.createElement('input');
        input.type = inputType || 'text';
        if (inputType === 'number') input.step = 'any';
        input.className = 'inline-input';
        input.value = currentValue;

        element.innerHTML = '';
        element.appendChild(input);
        input.focus();
        input.select();

        const saveEdit = () => {
          let newVal = input.value;
          if (inputType === 'number') {
            let num = parseFloat(newVal);
            if (isNaN(num) || num < 0) num = parseFloat(currentValue) || 0;
            newVal = (field === 'stock' || field === 'fractionMultiplier') ? roundStock(num) : roundAmt(num);
          } else {
            newVal = (newVal || '').trim() || currentValue;
          }
          obj[field] = newVal;

          if (typeof window.decoupledPersist === 'function') {
            window.decoupledPersist(['products']);
          } else {
            persist();
          }

          // ป้องกันข้อผิดพลาดขายต่ำกว่าทุน: เตือนทันทีถ้าแก้ราคาขาย (ขนาดหลักหรือแบ่งขาย)
          // แล้วต่ำกว่าทุน — ไม่บล็อกการบันทึก (ค่าที่แก้บันทึกไปแล้ว) แต่แจ้งให้รู้ตัวทันที
          // เพื่อกลับมาแก้ไขได้ทันหากพิมพ์ผิด
          if (field === 'price' && type === 'variant') {
            if (obj.price > 0 && obj.cost > 0 && obj.price < obj.cost) {
              showToast(`⚠️ ราคาขาย ${formatMoney(obj.price)} ต่ำกว่าทุน ${formatMoney(obj.cost)} — ขาดทุน!`);
            }
          } else if (field === 'fractionPrice' && type === 'fraction') {
            const v = p.variants.find(x => x.id === variantId);
            const impliedCost = v ? roundAmt(v.cost * (obj.fractionMultiplier || 0)) : 0;
            if (obj.fractionPrice > 0 && impliedCost > 0 && obj.fractionPrice < impliedCost) {
              showToast(`⚠️ ราคาแบ่งขาย ${formatMoney(obj.fractionPrice)} ต่ำกว่าทุนโดยประมาณ ${formatMoney(impliedCost)} — ขาดทุน!`);
            }
          }

          window.renderStock();
        };

        input.addEventListener('blur', saveEdit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { saveEdit(); }
          else if (e.key === 'Escape') { input.value = currentValue; saveEdit(); }
        });
      };

      window.inlineEditCategory = function(productId, selectEl) {
        const val = selectEl.value;
        if (val === '__NEW__') {
          selectEl.value = (db.products[productId].cat && db.products[productId].cat[0]) || '';
          window.openManageCategoryModal();
          return;
        }
        const p = db.products[productId];
        if (!p) return;
        p.cat = [val];
        
        if (typeof window.decoupledPersist === 'function') {
          window.decoupledPersist(['products']);
        } else {
          persist();
        }
        
        window.renderStock();
      };

      // Legacy alias kept for backward-compatibility with any external callers.
      window.inlineEditStock = function(productId, variantId, field, element) {
        window.inlineEditField('variant', productId, variantId, null, field, element, 'number');
      };

      window.saveAllStockCounts = function() {
        if (!guardOnce('saveAllStockCounts')) return;
        const entries = Object.entries(window.stockCountDraft || {});
        if (entries.length === 0) return showAlert("ยังไม่ได้กรอกข้อมูล", "กรุณากรอกจำนวนที่นับได้อย่างน้อย 1 รายการก่อนบันทึก", true);
        window.openManagerPinModal(() => {
          window.showCustomConfirm("ปรับปรุงยอดสต็อกจริงที่ตรวจนับได้?", "ระบบจะเขียนยอดสต็อกในฐานข้อมูลทับตามจำนวนที่กรอกไว้ในตารางนี้", () => {
            entries.forEach(([variantId, draft]) => {
              for (const p of Object.values(db.products)) {
                const v = p.variants.find(x => x.id === variantId);
                if (v) {
                  if (draft.qty !== '' && draft.qty !== undefined && !isNaN(parseFloat(draft.qty))) {
                    v.stock = roundStock(parseFloat(draft.qty));
                  }
                  if (draft.note) v.lastCountNote = draft.note;
                  break;
                }
              }
            });
            persist();
            window.stockCountDraft = {};
            window.renderStock();
            showToast("บันทึกยอดนับสต็อกเรียบร้อย");
          });
        });
      };

      window.setStockCountDraft = function(variantId, key, value) {
        if (!window.stockCountDraft[variantId]) window.stockCountDraft[variantId] = { qty: '', note: '' };
        window.stockCountDraft[variantId][key] = value;
      };

      window.renderStock = function() {
        const search = document.getElementById('stock-search-input').value.toLowerCase();
        const catFilter = document.getElementById('stock-category-filter').value;
        const onlyLowStock = document.getElementById('stock-low-filter').checked;
        const tbody = document.getElementById('stock-table-body');
        const head = document.getElementById('stock-table-head');

        let catOptions = `<option value="ALL">ทั้งหมด</option>`;
        db.categories.forEach(c => {
          catOptions += `<option value="${escapeHTML(c.name)}" ${catFilter === c.name ? 'selected' : ''}>${escapeHTML(c.name)}</option>`;
        });
        document.getElementById('stock-category-filter').innerHTML = catOptions;

        const visibleCols = STOCK_COLUMNS.filter(c => columnVisibility[c.key]);
        const allCols = window.stockCountMode ? visibleCols.concat(STOCK_COUNT_COLUMNS) : visibleCols;

        // Header row (titles)
        let titleRow = '<tr>' + allCols.map(c => `<th class="p-2.5 align-bottom">${c.label}</th>`).join('') + '</tr>';

        // Filter row (per-column quick filters, google-sheet style)
        let filterRow = '<tr class="bg-white border-t normal-case font-normal">' + allCols.map(c => {
          if (c.filter === 'text') {
            return `<th class="p-1.5"><input type="text" data-filter-key="${c.key}" value="${escapeHTML(stockFilters[c.key] || '')}" onkeyup="window.__setStockFilter('${c.key}', this.value)" placeholder="กรอง..." class="w-full text-[10px] font-normal border rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"></th>`;
          }
          return '<th class="p-1.5"></th>';
        }).join('') + '</tr>';

        const activeFilterKey = (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.filterKey) ? document.activeElement.dataset.filterKey : null;
        const activeFilterCursor = activeFilterKey ? document.activeElement.selectionStart : null;

        head.innerHTML = titleRow + filterRow;

        if (activeFilterKey) {
          const restored = head.querySelector(`input[data-filter-key="${activeFilterKey}"]`);
          if (restored) {
            restored.focus();
            try { restored.setSelectionRange(activeFilterCursor, activeFilterCursor); } catch(e) {}
          }
        }

        let flt = [];
        Object.values(db.products).forEach(p => {
          if (p.isDeleted) return;
          p.variants.forEach((v, idx) => {
            const isMatchSearch = p.name.toLowerCase().includes(search) || (v.barcode || '').toLowerCase().includes(search);
            const isMatchCat = catFilter === 'ALL' || (p.cat && p.cat.includes(catFilter));
            const limit = v.minStock !== undefined ? v.minStock : 10;
            const isBelowMin = roundStock(v.stock) <= roundStock(limit);
            const isMatchLowStock = !onlyLowStock || isBelowMin;

            const isMatchCode = !stockFilters.code || ((p.code || p.id).toLowerCase().includes(stockFilters.code.toLowerCase()));
            const isMatchBarcode = !stockFilters.barcode || (v.barcode || '').toLowerCase().includes(stockFilters.barcode.toLowerCase());
            const isMatchName = !stockFilters.name || p.name.toLowerCase().includes(stockFilters.name.toLowerCase());
            const isMatchSize = !stockFilters.size || (v.sizeName || '').toLowerCase().includes(stockFilters.size.toLowerCase());

            if (isMatchSearch && isMatchCat && isMatchLowStock && isMatchCode && isMatchBarcode && isMatchName && isMatchSize) {
              flt.push({ p, v, isBelowMin, limit, isFirstVariant: idx === 0 });
            }
          });
        });

        document.getElementById('stock-total-count').innerText = flt.length;

        if (stockSortBy === 'name') {
          flt.sort((a, b) => a.p.name.localeCompare(b.p.name, 'th'));
        } else if (stockSortBy === 'price') {
          flt.sort((a, b) => b.v.price - a.v.price);
        } else if (stockSortBy === 'stock') {
          flt.sort((a, b) => a.v.stock - b.v.stock);
        } else {
          flt.sort((a, b) => b.p.id.localeCompare(a.p.id));
        }

        // Pagination Logic
        const totalItems = flt.length;
        const totalPages = Math.ceil(totalItems / window.stockItemsPerPage) || 1;
        if (window.stockCurrentPage > totalPages) window.stockCurrentPage = totalPages;

        const startIndex = (window.stockCurrentPage - 1) * window.stockItemsPerPage;
        const endIndex = startIndex + window.stockItemsPerPage;
        const paginatedFlt = flt.slice(startIndex, endIndex);

        if (totalItems === 0) {
          tbody.innerHTML = `<tr><td colspan="${allCols.length}" class="p-8 text-center text-slate-400 font-bold">ไม่พบรายการสินค้าที่ตรงเงื่อนไข</td></tr>`;
          updateLowStockBadge();
          return;
        }

        let catOptionsForRow = (selected) => db.categories.map(c => `<option value="${escapeHTML(c.name)}" ${selected === c.name ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('') + `<option value="__NEW__">+ เพิ่มหมวดหมู่ใหม่...</option>`;

        let rowsHtml = paginatedFlt.map(item => {
          const p = item.p, v = item.v, isBelowMin = item.isBelowMin, limit = item.limit;
          const pid = escapeHTML(p.id), vid = escapeHTML(v.id);

          let stockClass = "text-emerald-600 font-extrabold";
          if (isBelowMin) stockClass = "text-rose-600 font-black";
          else if (roundStock(v.stock) <= roundStock(limit + 5)) stockClass = "text-amber-500 font-bold";

          const fractionsHtml = (v.fractions || []).map(f => `
            <span class="inline-flex items-center gap-1 bg-slate-100 border rounded-lg px-1.5 py-0.5 mr-1 mb-1 text-[10px] font-bold text-slate-600">
              <span class="inline-edit-cell" onclick="window.inlineEditField('fraction','${pid}','${vid}','${escapeHTML(f.id)}','fractionName',this,'text')">${escapeHTML(f.fractionName)}</span>
              ×<span class="inline-edit-cell" onclick="window.inlineEditField('fraction','${pid}','${vid}','${escapeHTML(f.id)}','fractionMultiplier',this,'number')">${f.fractionMultiplier}</span>
              =฿<span class="inline-edit-cell" onclick="window.inlineEditField('fraction','${pid}','${vid}','${escapeHTML(f.id)}','fractionPrice',this,'number')">${f.fractionPrice}</span>
              <button onclick="window.removeFraction('${pid}','${vid}','${escapeHTML(f.id)}')" class="text-rose-500 font-black ml-0.5">✕</button>
            </span>`).join('');

          const cellMap = {
            cat: `<td class="p-2.5">
                <select class="text-[10px] font-bold border rounded-lg px-1 py-1 outline-none max-w-[110px]" onchange="window.inlineEditCategory('${pid}', this)">
                  ${catOptionsForRow(p.cat && p.cat[0])}
                </select>
              </td>`,
            addVar: `<td class="p-2.5 text-center">${item.isFirstVariant ? `<button onclick="window.addInlineVariant('${pid}')" title="เพิ่มขนาด/สีใหม่" class="bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg px-2 py-1 text-xs font-black btn-touch">➕</button>` : ''}</td>`,
            image: `<td class="p-2.5 text-center text-lg">
                ${p.imageUrl
                  ? `<img src="${escapeHTML(p.imageUrl)}" data-fallback-emoji="${escapeHTML(p.image || '📦')}" data-pid="${escapeHTML(pid)}" onerror="window.handleProductImgError(this)" class="w-10 h-10 object-cover rounded-lg inline-block align-middle">`
                  : `<span class="inline-edit-cell" onclick="window.inlineEditField('product','${pid}',null,null,'image',this,'text')">${escapeHTML(p.image || '📦')}</span>`}
              </td>`,
            code: `<td class="p-2.5 font-mono text-[11px] text-slate-600">
                <span class="inline-edit-cell" onclick="window.inlineEditField('product','${pid}',null,null,'code',this,'text')">${escapeHTML(p.code || p.id)}</span>
              </td>`,
            barcode: `<td class="p-2.5 font-mono text-[11px] text-slate-600">
                <span class="inline-edit-cell" onclick="window.inlineEditField('variant','${pid}','${vid}',null,'barcode',this,'text')">${escapeHTML(v.barcode)}</span>
              </td>`,
            name: `<td class="p-2.5 font-bold text-slate-800 text-xs max-w-[180px]">
                <span class="inline-edit-cell" onclick="window.inlineEditField('product','${pid}',null,null,'name',this,'text')">${escapeHTML(p.name)}</span>
              </td>`,
            size: `<td class="p-2.5 font-bold text-slate-500 text-xs">
                <span class="inline-edit-cell" onclick="window.inlineEditField('variant','${pid}','${vid}',null,'sizeName',this,'text')">${escapeHTML(v.sizeName)}</span>
              </td>`,
            cost: `<td class="p-2.5 text-right font-semibold text-xs tabular-nums text-slate-700">
                <span class="inline-edit-cell" onclick="window.inlineEditField('variant','${pid}','${vid}',null,'cost',this,'number')">${roundAmt(v.cost||0).toFixed(2)}</span>
              </td>`,
            price: `<td class="p-2.5 text-right font-semibold text-indigo-600 text-xs tabular-nums">
                <span class="inline-edit-cell" onclick="window.inlineEditField('variant','${pid}','${vid}',null,'price',this,'number')">${roundAmt(v.price||0).toFixed(2)}</span>
              </td>`,
            stock: `<td class="p-2.5 text-center tabular-nums text-xs font-bold ${stockClass}">
                <span class="inline-edit-cell" onclick="window.inlineEditField('variant','${pid}','${vid}',null,'stock',this,'number')">${v.stock}</span>
                <span class="inline-edit-cell text-slate-400 font-normal" onclick="window.inlineEditField('variant','${pid}','${vid}',null,'unit',this,'text')">${escapeHTML(v.unit || 'ชิ้น')}</span>
                ${isBelowMin ? `<span class="badge-error ml-1 text-[8px] animate-pulse block">⚠️ ต่ำกว่าเกณฑ์ (${limit})</span>` : ''}
              </td>`,
            addFrac: `<td class="p-2.5 text-center"><button onclick="window.addInlineFraction('${pid}','${vid}')" title="เพิ่มหน่วยย่อยแบ่งขาย" class="bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg px-2 py-1 text-xs font-black btn-touch">➕</button></td>`,
            fractions: `<td class="p-2.5 max-w-[220px] whitespace-normal">${fractionsHtml || '<span class="text-slate-300 text-[10px]">-</span>'}</td>`,
            actions: `<td class="p-2.5 text-center text-xs whitespace-nowrap">
                <button onclick="window.removeVariantRow('${pid}','${vid}')" class="px-2 py-1 bg-rose-50 border border-rose-200 rounded-lg text-rose-600 font-bold hover:bg-rose-100 transition active:scale-95 btn-touch mr-1">🗑️ ลบ</button>
                <button onclick="window.openProductModal('${pid}')" title="ตัวเลือกแก้ไขแบบรายละเอียด" class="px-2 py-1 bg-white border rounded-lg text-slate-500 font-bold hover:bg-slate-100 transition active:scale-95 btn-touch">⋯</button>
              </td>`,
            countedQty: `<td class="p-2.5 text-center"><input type="number" step="any" placeholder="นับได้..." class="w-20 text-xs border rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-400" onchange="window.setStockCountDraft('${vid}','qty', this.value)"></td>`,
            countedNote: `<td class="p-2.5 text-center"><input type="text" placeholder="หมายเหตุ..." class="w-28 text-xs border rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-400" onchange="window.setStockCountDraft('${vid}','note', this.value)"></td>`
          };

          return `<tr class="hover:bg-slate-50 border-b">${allCols.map(c => cellMap[c.key] || '<td></td>').join('')}</tr>`;
        }).join('');

        // Pagination row UI
        const paginationRow = `
          <tr class="bg-white border-t">
            <td colspan="${allCols.length}" class="p-3">
              <div class="flex flex-col sm:flex-row justify-between items-center w-full gap-2">
                <div class="text-xs text-slate-500 font-bold">
                   แสดง ${startIndex + 1} - ${Math.min(endIndex, totalItems)} จากทั้งหมด ${totalItems} รายการ
                </div>
                <div class="flex items-center gap-2">
                   <select onchange="window.changeStockItemsPerPage(this.value)" class="text-xs border rounded-lg p-1.5 outline-none font-bold text-slate-700 bg-slate-50">
                     <option value="30" ${window.stockItemsPerPage === 30 ? 'selected' : ''}>30 / หน้า</option>
                     <option value="50" ${window.stockItemsPerPage === 50 ? 'selected' : ''}>50 / หน้า</option>
                     <option value="100" ${window.stockItemsPerPage === 100 ? 'selected' : ''}>100 / หน้า</option>
                   </select>
                   <button onclick="window.changeStockPage(${window.stockCurrentPage - 1})" ${window.stockCurrentPage === 1 ? 'disabled class="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg font-bold cursor-not-allowed"' : 'class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold cursor-pointer btn-touch hover:bg-indigo-100"'}>ก่อนหน้า</button>
                   <span class="text-xs font-black px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg">${window.stockCurrentPage} / ${totalPages}</span>
                   <button onclick="window.changeStockPage(${window.stockCurrentPage + 1})" ${window.stockCurrentPage === totalPages ? 'disabled class="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg font-bold cursor-not-allowed"' : 'class="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold cursor-pointer btn-touch hover:bg-indigo-100"'}>ถัดไป</button>
                </div>
              </div>
            </td>
          </tr>
        `;

        tbody.innerHTML = rowsHtml + paginationRow;
        updateLowStockBadge();
      };

      window.__setStockFilter = function(key, value) {
        stockFilters[key] = value;
        window.stockCurrentPage = 1; // Reset to page 1 on search
        window.renderStock();
      };

      function updateLowStockBadge() {
        let lowStockCount = 0;
        Object.values(db.products).forEach(p => {
          if (p.isDeleted) return;
          p.variants.forEach(v => {
            const limit = v.minStock !== undefined ? v.minStock : 10;
            if (roundStock(v.stock) <= roundStock(limit)) {
              lowStockCount++;
            }
          });
        });

        const globalBadge = document.getElementById('low-stock-global-badge');
        if (globalBadge) {
          if (lowStockCount > 0) {
            globalBadge.innerText = lowStockCount;
            globalBadge.classList.remove('hidden');
          } else {
            globalBadge.classList.add('hidden');
          }
        }

        const banner = document.getElementById('low-stock-alert-banner');
        const bannerCount = document.getElementById('low-stock-alert-count');
        if (banner && bannerCount) {
          if (lowStockCount > 0) {
            bannerCount.innerText = lowStockCount;
            banner.classList.remove('hidden');
          } else {
            banner.classList.add('hidden');
          }
        }
      }

      // ==========================================
      // CATEGORY MANAGEMENT
      // ==========================================
      window.openManageCategoryModal = function() {
        window.openManagerPinModal(() => {
          document.getElementById('edit-cat-id').value = "";
          document.getElementById('cat-name').value = "";
          document.getElementById('cat-icon').value = "";
          document.getElementById('btn-cancel-edit-cat').classList.add('hidden');
          renderCatListUI();
          document.getElementById('modal-category').classList.remove('hidden');
          document.getElementById('modal-category').classList.add('flex');
        });
      };

      function renderCatListUI() {
        const list = document.getElementById('cat-list-ui');
        list.innerHTML = db.categories.map(c => `
          <div class="flex justify-between items-center p-2 bg-slate-50 border rounded-xl text-slate-800">
            <span class="text-xs font-bold"><span style="color:${escapeHTML(c.color)}">${escapeHTML(c.icon)}</span> ${escapeHTML(c.name)}</span>
            <div class="flex gap-2">
              <button onclick="window.editCategory('${escapeHTML(c.id)}')" class="text-indigo-500 font-bold text-xs">✏️</button>
              <button onclick="window.deleteCategory('${escapeHTML(c.id)}')" class="text-rose-500 font-bold text-xs">🗑️</button>
            </div>
          </div>
        `).join('');
      }

      window.editCategory = function(id) {
        const c = db.categories.find(x => x.id === id);
        if(!c) return;
        document.getElementById('edit-cat-id').value = c.id;
        document.getElementById('cat-name').value = c.name;
        document.getElementById('cat-icon').value = c.icon;
        document.getElementById('cat-color').value = c.color;
        document.getElementById('btn-cancel-edit-cat').classList.remove('hidden');
      };

      window.cancelCategoryEdit = function() {
        document.getElementById('edit-cat-id').value = "";
        document.getElementById('cat-name').value = "";
        document.getElementById('cat-icon').value = "";
        document.getElementById('btn-cancel-edit-cat').classList.add('hidden');
      };

      window.saveCategory = function() {
        if (!guardOnce('saveCategory')) return;
        const id = document.getElementById('edit-cat-id').value || 'CAT-' + generateID();
        const name = document.getElementById('cat-name').value.trim();
        const icon = document.getElementById('cat-icon').value.trim();
        const color = document.getElementById('cat-color').value;
        if(!name) return showAlert("ข้อมูลไม่ครบ", "กรุณาระบุชื่อหมวดหมู่", true);

        const oldCat = db.categories.find(x => x.id === id);
        const oldName = oldCat ? oldCat.name : null;

        const existingIdx = db.categories.findIndex(x => x.id === id);
        if(existingIdx >= 0) db.categories[existingIdx] = {id, name, icon, color};
        else db.categories.push({id, name, icon, color});
        
        if (oldName && oldName !== name) {
          Object.values(db.products).forEach(p => {
            if (p.cat) {
              p.cat = p.cat.map(cName => cName === oldName ? name : cName);
            }
          });
        }

        persist(); cancelCategoryEdit(); renderCatListUI();
        if(activeView === 'sale') renderSaleHome();
      };

      window.deleteCategory = function(id) {
        if (!guardOnce('deleteCategory')) return;
        window.showCustomConfirm("ลบหมวดหมู่?", "คุณต้องการลบหมวดหมู่นี้ใช่หรือไม่? (สินค้าที่ผูกอยู่จะถูกแยกออกจากหมวดหมู่นี้)", () => {
          const catToDelete = db.categories.find(x => x.id === id);
          if (catToDelete) {
            const catName = catToDelete.name;
            Object.values(db.products).forEach(p => {
              if (p.cat) {
                p.cat = p.cat.filter(cName => cName !== catName);
              }
            });
            db.categories = db.categories.filter(x => x.id !== id);
            persist(); renderCatListUI();
            if(activeView === 'sale') renderSaleHome();
          }
        });
      };

      // ==========================================
      // CUSTOMER MANAGEMENT & DEBT PAYMENTS
      // ==========================================
      window.renderCustomers = function() {
        const query = document.getElementById('search-customer-input').value.toLowerCase();
        const list = document.getElementById('customers-list');
        const filtered = Object.values(db.customers).filter(c => c.name.toLowerCase().includes(query) || c.phone.includes(query));
        
        list.innerHTML = filtered.map(c => `
          <div class="bg-white p-4 rounded-2xl border flex justify-between items-center shadow-sm">
            <div>
              <b class="text-sm text-slate-800">${escapeHTML(c.name)}</b>
              <p class="text-xs text-slate-500">📞 ${escapeHTML(c.phone || '-')}</p>
            </div>
            <div class="text-right flex items-center gap-4">
              <div class="text-right">
                <span class="text-[10px] text-slate-400 block font-bold">หนี้ค้างชำระ (ลูกหนี้เอาก่อสร้างไปเครดิต)</span>
                <b class="${c.debt > 0 ? 'text-rose-600 font-black' : 'text-emerald-600'} text-sm">${formatMoney(c.debt)}</b>
              </div>
              <div class="flex flex-col gap-1">
                ${c.debt > 0 ? `<button onclick="window.openPayDebtModal('${escapeHTML(c.id)}')" class="px-3 py-1 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold border border-rose-100 btn-touch">รับชำระหนี้</button>` : ''}
                <button onclick="window.openCustomerModal('${escapeHTML(c.id)}')" class="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold border btn-touch">แก้ไข</button>
              </div>
            </div>
          </div>
        `).join('');
      };

      window.openCustomerModal = function(id = null) {
        if(id && db.customers[id]) {
          const c = db.customers[id];
          document.getElementById('edit-c-id').value = c.id;
          document.getElementById('c-name').value = c.name;
          document.getElementById('c-phone').value = c.phone;
        } else {
          document.getElementById('edit-c-id').value = "";
          document.getElementById('c-name').value = "";
          document.getElementById('c-phone').value = "";
        }
        document.getElementById('modal-customer').classList.remove('hidden');
        document.getElementById('modal-customer').classList.add('flex');
      };

      window.saveCustomer = function() {
        if (!guardOnce('saveCustomer')) return;
        const id = document.getElementById('edit-c-id').value || 'C' + generateID();
        const name = document.getElementById('c-name').value.trim();
        const phone = document.getElementById('c-phone').value.trim();
        if(!name) return showAlert("ข้อมูลไม่ครบ", "ชื่อลูกค้าต้องไม่เป็นค่าว่าง", true);

        if(db.customers[id]) {
          db.customers[id].name = name;
          db.customers[id].phone = phone;
        } else {
          db.customers[id] = { id, name, phone, debt: 0 };
        }
        persist(); window.renderCustomers(); closeModal('modal-customer');
      };

      window.openPayDebtModal = function(cid) {
        const c = db.customers[cid];
        document.getElementById('pd-cid').value = cid;
        document.getElementById('pd-customer-name').innerText = c.name;
        document.getElementById('pd-total-debt').innerText = formatMoney(c.debt);
        document.getElementById('pd-amount').value = c.debt;
        document.getElementById('modal-pay-debt').classList.remove('hidden');
        document.getElementById('modal-pay-debt').classList.add('flex');
      };

      window.confirmPayDebt = function() {
        if (!guardOnce('confirmPayDebt')) return;
        const cid = document.getElementById('pd-cid').value;
        const amt = roundAmt(parseFloat(document.getElementById('pd-amount').value));
        if(!amt || amt <= 0) return;

        window.openManagerPinModal(() => {
          if (!db.currentShift) {
             window.closeModal('modal-pay-debt');
             return showAlert("ยังไม่เปิดกะ", "รับชำระหนี้ต้องทำขณะเปิดกะเท่านั้นเพื่อให้เงินเข้าลิ้นชัก", true);
          }

          db.customers[cid].debt = roundAmt(Math.max(0, db.customers[cid].debt - amt));
          
          const method = document.getElementById('pd-method').value;
          db.currentShift.transactions.push({ time: Date.now(), type: 'IN', cat: 'รายรับ-รับชำระหนี้', note: `รับชำระจาก ${db.customers[cid].name}`, amt });
          
          if (method === 'CASH') db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand + amt);
          if (method === 'TRANSFER') db.currentShift.transferSales = roundAmt(db.currentShift.transferSales + amt);

          db.cashLedger.push({
            id: 'TX-' + generateID(),
            date: new Date().toISOString().slice(0, 10),
            description: `รับชำระหนี้เครดิตจากลูกค้า: ${db.customers[cid].name}`,
            income: amt,
            expense: 0,
            type: 'income-debt-paid',
            refId: cid
          });

          persist();
          logTransaction('DEBT_PAYMENT', { customerId: cid, amount: amt, method });
          window.renderCustomers(); closeModal('modal-pay-debt');
          showToast("รับชำระหนี้เรียบร้อย");
        });
      };

      // ==========================================
      // HISTORY & CUMULATIVE PARTIAL REFUND (ข้อ 3 & ข้อ 4)
      // ==========================================
      let historyDisplayCount = 50;
      window.renderHistory = function(resetPage) {
        if (resetPage !== false) historyDisplayCount = 50;
        const search = document.getElementById('search-history-input').value.toLowerCase();
        const dateFilter = document.getElementById('filter-history-date').value;
        const list = document.getElementById('history-container');
        
        let filtered = db.bills.filter(b => {
          const cName = b.customerId !== 'GENERAL' && db.customers[b.customerId] ? db.customers[b.customerId].name.toLowerCase() : '';
          const matchSearch = b.id.toLowerCase().includes(search) || cName.includes(search);
          const matchDate = !dateFilter || new Date(b.time).toISOString().slice(0, 10) === dateFilter;
          return matchSearch && matchDate;
        });

        filtered.sort((a, b) => b.time - a.time);

        if(filtered.length === 0) {
          list.innerHTML = `<p class="text-center text-slate-400 font-bold p-8">ไม่พบประวัติบิล</p>`;
          return;
        }

        const pageItems = filtered.slice(0, historyDisplayCount);
        const remaining = filtered.length - pageItems.length;

        list.innerHTML = pageItems.map(b => {
          const cName = b.customerId !== 'GENERAL' && db.customers[b.customerId] ? db.customers[b.customerId].name : 'ลูกค้าทั่วไป';
          
          const isReturnable = b.items.some(i => i.qty > (i.refundedQty || 0));

          return `
            <div class="bg-white p-4 rounded-2xl border shadow-sm ${b.isRefunded ? 'opacity-50' : ''} text-slate-800">
              <div class="flex justify-between items-start mb-2">
                <div>
                  <b class="text-sm text-indigo-700">${escapeHTML(b.id)}</b>
                  <p class="text-[10px] text-slate-400">${new Date(b.time).toLocaleString('th-TH')}</p>
                </div>
                <div class="text-right">
                  <b class="text-lg text-slate-800">${formatMoney(b.total)}</b>
                  ${b.refundAmount > 0 ? `<p class="text-[10px] text-rose-500 font-bold">คืนเงินแล้วสะสม: ${formatMoney(b.refundAmount)}</p>` : ''}
                </div>
              </div>
              <div class="text-[10px] text-slate-500 mb-3 flex justify-between">
                <span>👤 ${escapeHTML(cName)} | 💳 ${escapeHTML(b.method)}</span>
                ${b.isRefunded ? `<span class="text-rose-500 font-bold bg-rose-50 px-2 rounded">คืนสินค้าครบแล้ว</span>` : ''}
              </div>
              <div class="flex gap-2">
                <button onclick="window.viewBillReceipt('${escapeHTML(b.id)}')" class="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl text-xs font-bold border btn-touch">ดูใบเสร็จ</button>
                ${isReturnable ? `<button onclick="window.openRefundModal('${escapeHTML(b.id)}')" class="flex-1 bg-rose-50 text-rose-600 py-2 rounded-xl text-xs font-bold border border-rose-100 btn-touch">คืนสินค้า</button>` : ''}
              </div>
            </div>
          `;
        }).join('') + (remaining > 0 ? `
            <button onclick="window.loadMoreHistory()" class="w-full bg-slate-100 text-slate-600 py-3 rounded-2xl text-xs font-bold border btn-touch">
              โหลดเพิ่มเติม (เหลืออีก ${remaining} รายการ)
            </button>` : '');
      };

      window.loadMoreHistory = function() {
        historyDisplayCount += 50;
        window.renderHistory(false);
      };

      window.viewBillReceipt = function(billId) {
        const b = db.bills.find(x => x.id === billId);
        if(!b) return;
        renderReceiptContent(b);
        document.getElementById('modal-receipt').classList.remove('hidden');
        document.getElementById('modal-receipt').classList.add('flex');
      };

      window.openRefundModal = function(billId) {
        window.openManagerPinModal(() => {
          const b = db.bills.find(x => x.id === billId);
          if(!b) return;
          document.getElementById('refund-target-bill').value = billId;
          document.getElementById('refund-bill-id').innerText = `เลขที่: ${b.id}`;
          document.getElementById('refund-reason').value = "";
          
          const container = document.getElementById('refund-items-container');
          container.innerHTML = b.items.map(i => {
            const alreadyRefunded = i.refundedQty || 0;
            const maxReturnable = i.qty - alreadyRefunded;
            
            if (maxReturnable <= 0) {
              return `
                <div class="flex justify-between items-center bg-slate-100 p-3 rounded-xl border text-slate-400 opacity-60">
                  <div class="flex-1">
                    <span class="text-xs font-bold block">${escapeHTML(i.name)}</span>
                    <span class="text-[10px]">คืนครบโควตาแล้ว (${alreadyRefunded}/${i.qty} ชิ้น)</span>
                  </div>
                  <span class="text-xs font-bold">คืนครบแล้ว</span>
                </div>
              `;
            }

            return `
              <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border text-slate-800">
                <div class="flex-1">
                  <span class="text-xs font-bold block">${escapeHTML(i.name)}</span>
                  <span class="text-[10px] text-slate-400">@${formatMoney(i.price)} (ซื้อไป ${i.qty} | คืนแล้ว ${alreadyRefunded})</span>
                </div>
                <div class="flex flex-col items-end">
                  <label class="text-[9px] font-bold text-rose-500 mb-0.5">ระบุคืน (สูงสุด ${maxReturnable}):</label>
                  <input type="number" class="refund-qty-input w-24 p-2 border rounded-xl text-center text-rose-600 font-bold" 
                         data-cartkey="${escapeHTML(i.cartKey)}" 
                         data-max="${maxReturnable}" 
                         data-price="${i.price}" 
                         value="0" 
                         oninput="window.calcRefundTotal()">
                </div>
              </div>
            `;
          }).join('');
          
          window.calcRefundTotal();
          document.getElementById('modal-refund').classList.remove('hidden');
          document.getElementById('modal-refund').classList.add('flex');
        });
      };

      window.calcRefundTotal = function() {
        let total = 0;
        document.querySelectorAll('.refund-qty-input').forEach(input => {
          let val = parseFloat(input.value) || 0;
          const max = parseFloat(input.dataset.max);
          if(val > max) { val = max; input.value = max; }
          if(val < 0) { val = 0; input.value = 0; }
          total = roundAmt(total + (val * parseFloat(input.dataset.price)));
        });
        document.getElementById('refund-total-amount').innerText = formatMoney(total);
      };

      // บันทึกคืนสินค้าและคำนวณเงินคืนสมบูรณ์แบบ (ข้อ 3 & ข้อ 4)
      window.confirmPartialRefund = function() {
        if (!guardOnce('confirmPartialRefund')) return;
        const billId = document.getElementById('refund-target-bill').value;
        const reason = document.getElementById('refund-reason').value.trim();
        if(!reason) return showAlert("ข้อมูลไม่ครบ", "กรุณาระบุเหตุผลการคืนสินค้า", true);

        const b = db.bills.find(x => x.id === billId);
        if(!b) return;

        let refundTotal = 0;
        let refundCost = 0;
        const refundActions = [];

        let validationPassed = true;
        document.querySelectorAll('.refund-qty-input').forEach(input => {
          const qtyToRefund = parseFloat(input.value) || 0;
          if (qtyToRefund > 0) {
            const key = input.dataset.cartkey;
            const max = parseFloat(input.dataset.max);
            if (qtyToRefund > max) {
              validationPassed = false;
            }
            const item = b.items.find(x => x.cartKey === key);
            if (item) {
              refundTotal = roundAmt(refundTotal + (qtyToRefund * roundAmt(item.price)));
              refundCost = roundAmt(refundCost + (qtyToRefund * (roundAmt(item.cost) || 0)));
              refundActions.push({ item, qtyToRefund });
            }
          }
        });

        if (!validationPassed) {
          return showAlert("จำนวนไม่ถูกต้อง", "ไม่สามารถคืนสินค้าเกินจำนวนที่คงเหลือในบิลจริงได้", true);
        }
        if (refundTotal === 0) {
          return showAlert("จำนวนไม่ถูกต้อง", "กรุณาระบุจำนวนสินค้าที่จะคืนอย่างน้อย 1 ชิ้น", true);
        }
        if (b.method === 'CASH' && (!db.currentShift || db.currentShift.cashOnHand < refundTotal)) {
          return showAlert(
            "เงินในลิ้นชักไม่พอ",
            !db.currentShift ? "บิลขายเงินสดจำเป็นต้องเปิดกะก่อนทำการหักเงินคืนลิ้นชัก" : `เงินสดในลิ้นชักมีเพียง ${formatMoney(db.currentShift.cashOnHand)} ไม่พอคืนยอดจำนวน ${formatMoney(refundTotal)}`,
            true
          );
        }

        let confirmTitle, confirmDesc;
        if (b.method === 'CASH') {
          confirmTitle = `ต้องคืนเงินสด ${formatMoney(refundTotal)} ให้ลูกค้า`;
          confirmDesc = `สำหรับบิลเลขที่ ${b.id} — ระบบจะหักเงินสด ${formatMoney(refundTotal)} ออกจากลิ้นชักทันทีที่กดยืนยัน กรุณาคืนเงินสดให้ลูกค้าให้ครบก่อนกดยืนยัน`;
        } else if (b.method === 'TRANSFER') {
          confirmTitle = `ต้องโอนเงินคืน ${formatMoney(refundTotal)} ให้ลูกค้า`;
          confirmDesc = `สำหรับบิลเลขที่ ${b.id} — บิลนี้ชำระด้วยการโอน กรุณาโอนเงินคืนลูกค้าให้ครบ ${formatMoney(refundTotal)} ก่อนกดยืนยัน (ระบบจะปรับปรุงยอดขายโอนในกะปัจจุบัน)`;
        } else {
          confirmTitle = `ไม่ต้องคืนเงินสด — หักยอดค้างชำระแทน`;
          confirmDesc = `สำหรับบิลเลขที่ ${b.id} — บิลนี้เป็นบิลค้างชำระ (เครดิต) ระบบจะนำยอด ${formatMoney(refundTotal)} ไปหักยอดหนี้ค้างชำระของลูกค้าแทนการคืนเงินสด`;
        }

        window.showCustomConfirm(confirmTitle, confirmDesc, () => {
          window.executePartialRefund(b, reason, refundTotal, refundCost, refundActions);
        });
      };

      window.executePartialRefund = function(b, reason, refundTotal, refundCost, refundActions) {
        // ข้อ 3: หักเงินกะหรือหนี้สิน พร้อมคุม bounds ไม่ให้ติดลบ Math.max(0, ...)
        if (b.method === 'CASH' && db.currentShift) {
          db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand - refundTotal);
          db.currentShift.transactions.push({
            time: Date.now(),
            type: 'OUT',
            cat: 'รายจ่าย-คืนสินค้า',
            note: `บิล ${b.id}: ${reason}`,
            amt: refundTotal
          });
        } else if (b.method === 'TRANSFER') {
          if (db.currentShift) {
            db.currentShift.transferSales = roundAmt(Math.max(0, db.currentShift.transferSales - refundTotal));
          }
        } else if (b.method === 'CREDIT') {
          if (db.customers[b.customerId]) {
            db.customers[b.customerId].debt = roundAmt(Math.max(0, db.customers[b.customerId].debt - refundTotal));
          }
        }

        // คืนสินค้ากลับเข้าสต็อก (ข้อ 4: ใช้ roundStock)
        refundActions.forEach(({ item, qtyToRefund }) => {
          item.refundedQty = roundStock((item.refundedQty || 0) + qtyToRefund);
          
          const p = db.products[item.id];
          if (p) {
            const v = p.variants.find(x => x.id === item.variantId);
            if (v) {
              v.stock = roundStock(v.stock + (qtyToRefund * (parseFloat(item.multiplier) || 1)));
            }
          }
        });

        // อัปเดตรายรับ-รายจ่ายสะสมในตัวบิล
        b.refundAmount = roundAmt((b.refundAmount || 0) + refundTotal);
        b.refundCost = roundAmt((b.refundCost || 0) + refundCost);

        const fullyRefunded = b.items.every(i => i.qty === (i.refundedQty || 0));
        if (fullyRefunded) {
          b.isRefunded = true;
        }

        if (b.method !== 'CREDIT') {
          db.cashLedger.push({
            id: 'TX-' + generateID(),
            date: new Date().toISOString().slice(0, 10),
            description: `คืนเงินลูกค้า บิลเลขที่ ${b.id} เหตุผล: ${reason}`,
            income: 0,
            expense: refundTotal,
            type: 'expense-refund',
            refId: b.id
          });
        }

        persist();
        logTransaction('REFUND', { billId: b.id, refundTotal, refundCost, reason, fullyRefunded, cashRefunded: b.method !== 'CREDIT' });
        window.renderHistory();
        if (typeof window.updateShiftUI === 'function') window.updateShiftUI();
        closeModal('modal-refund');
        showToast(
          b.method === 'CREDIT'
            ? `บันทึกแล้ว: หักยอดค้างชำระ ${formatMoney(refundTotal)} ของบิล ${b.id} เรียบร้อย`
            : `บันทึกแล้ว: คืนเงิน ${formatMoney(refundTotal)} ให้บิล ${b.id} เรียบร้อย`
        );
      };

      // ==========================================
      // REPORT SYSTEM & TAX BASIS
      // ==========================================
      window.switchReportTab = function(tab) {
        activeReportTab = tab;
        document.getElementById('rep-tab-OVERVIEW').className = "flex-1 p-3 rounded-xl font-bold text-sm transition-colors border btn-touch bg-slate-100 text-slate-500";
        document.getElementById('rep-tab-LEDGER').className = "flex-1 p-3 rounded-xl font-bold text-sm transition-colors border btn-touch bg-slate-100 text-slate-500";
        document.getElementById(`rep-tab-${tab}`).className = "flex-1 bg-indigo-600 text-white p-3 rounded-xl font-bold text-sm transition-colors shadow-md btn-touch";
        
        document.getElementById('report-view-OVERVIEW').classList.add('hidden');
        document.getElementById('report-view-LEDGER').classList.add('hidden');
        document.getElementById(`report-view-${tab}`).classList.remove('hidden');
        
        if(tab === 'LEDGER') renderLedgerReport();
      };

      window.renderReports = function() {
        document.getElementById('tax-payer-info').innerText = `ผู้เสียภาษี: ${escapeHTML(db.settings.taxPayerName || '-')} | เลขประจำตัว: ${escapeHTML(db.settings.taxPayerId || '-')}`;
        document.getElementById('store-address-info').innerText = `ที่อยู่: ${escapeHTML(db.storeAddress || '-')}`;

        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const yearStr = todayStr.slice(0, 4);

        let dRev = 0, yRev = 0;
        let dCount = 0, yCount = 0;
        const dailyMap = {};

        db.bills.forEach(b => {
          const bDate = new Date(b.time).toISOString().slice(0, 10);
          const bYear = bDate.slice(0, 4);
          
          let validTotal = roundAmt(b.total - (b.refundAmount || 0));
          if (validTotal < 0) validTotal = 0;
          let refAmount = b.refundAmount || 0;

          if (bDate === todayStr) { dRev = roundAmt(dRev + validTotal); dCount++; }
          if (bYear === yearStr) { yRev = roundAmt(yRev + validTotal); yCount++; }

          if (!dailyMap[bDate]) dailyMap[bDate] = { rev: 0, orders: 0, ref: 0 };
          dailyMap[bDate].rev = roundAmt(dailyMap[bDate].rev + validTotal);
          dailyMap[bDate].ref = roundAmt(dailyMap[bDate].ref + refAmount);
          dailyMap[bDate].orders += 1;
        });

        let totalRev = 0;
        let totalOperationalExpense = 0;
        db.cashLedger.forEach(tx => {
          totalRev = roundAmt(totalRev + tx.income);
          totalOperationalExpense = roundAmt(totalOperationalExpense + tx.expense);
        });

        document.getElementById('report-daily-revenue').innerText = formatMoney(dRev);
        document.getElementById('report-daily-count').innerText = `${dCount} บิล`;
        document.getElementById('report-yearly-revenue').innerText = formatMoney(totalRev); 
        document.getElementById('report-yearly-count').innerText = `${db.bills.length} บิล`;

        document.getElementById('report-estimated-expense').innerText = formatMoney(totalOperationalExpense);

        const netProfit = roundAmt(totalRev - totalOperationalExpense);
        const margin = totalRev > 0 ? (netProfit / totalRev) * 100 : 0;
        document.getElementById('report-estimated-profit').innerText = formatMoney(netProfit);
        document.getElementById('report-profit-margin').innerText = `Margin กำไรสุทธิ: ${margin.toFixed(1)}%`;

        const deductเหมา = roundAmt(totalRev * 0.60);
        const deductจริง = totalOperationalExpense;
        document.getElementById('tax-deduct-เหมา').innerText = formatMoney(deductเหมา);
        document.getElementById('tax-deduct-จริง').innerText = formatMoney(deductจริง);

        const tbody = document.getElementById('report-daily-table-body');
        const sortedDays = Object.keys(dailyMap).sort((a, b) => b.localeCompare(a)).slice(0, 30);
        tbody.innerHTML = sortedDays.map(date => `
          <tr class="border-b text-slate-800">
            <td class="p-3 font-bold">${escapeHTML(date)}</td>
            <td class="p-3 text-center">${dailyMap[date].orders}</td>
            <td class="p-3 text-right text-indigo-600 font-bold">${formatMoney(dailyMap[date].rev)}</td>
            <td class="p-3 text-right text-rose-500 font-bold">${formatMoney(dailyMap[date].ref)}</td>
          </tr>
        `).join('');
      };

      function renderLedgerReport() {
        const tbody = document.getElementById('report-ledger-list');
        let html = '';
        db.cashLedger.slice().reverse().forEach(tx => {
          html += `
            <tr class="hover:bg-slate-50 border-b">
              <td class="p-3 border font-mono text-[10px]">${escapeHTML(tx.date)}</td>
              <td class="p-3 border font-bold text-slate-700">${escapeHTML(tx.description)}</td>
              <td class="p-3 border text-right text-emerald-600 font-extrabold tabular-nums">${tx.income > 0 ? formatMoney(tx.income) : '-'}</td>
              <td class="p-3 border text-right text-rose-500 font-extrabold tabular-nums">${tx.expense > 0 ? formatMoney(tx.expense) : '-'}</td>
            </tr>
          `;
        });
        if (!html) html = '<tr><td colspan="4" class="p-4 text-center text-slate-400 font-bold">ยังไม่มีข้อมูลบันทึกในสมุดรายรับ-รายจ่าย</td></tr>';
        tbody.innerHTML = html;
      }

      window.clearLedgerAction = function() {
        window.showCustomConfirm("ต้องการล้างประวัติสมุดรายรับ-รายจ่าย?", "ข้อมูลบัญชีภาษีรายรับรายจ่ายจะถูกล้างใหม่ทั้งหมดเพื่อเริ่มรอบบัญชีใหม่ (ข้อมูลสินค้าและคลังจะไม่หาย)", () => {
          db.cashLedger = [];
          persist();
          renderLedgerReport();
          showToast("ล้างสมุดบัญชีเรียบร้อย");
        });
      };

      window.printOperationalTaxReport = function() {
        const area = document.getElementById('print-document-area');
        let rowsHtml = db.cashLedger.map((tx, index) => `
          <tr class="border-b text-slate-800 text-[10px]">
            <td class="p-2 border text-center">${index + 1}</td>
            <td class="p-2 border font-mono text-center">${escapeHTML(tx.date)}</td>
            <td class="p-2 border font-bold">${escapeHTML(tx.description)}</td>
            <td class="p-2 border text-right text-emerald-600 font-bold">${tx.income > 0 ? formatMoney(tx.income) : '0.00'}</td>
            <td class="p-2 border text-right text-rose-500 font-bold">${tx.expense > 0 ? formatMoney(tx.expense) : '0.00'}</td>
          </tr>
        `).join('');

        if(!rowsHtml) rowsHtml = `<tr><td colspan="5" class="p-4 text-center text-slate-400">ยังไม่มีข้อมูลเดินบัญชีเงินสดรับ-จ่าย</td></tr>`;

        const totalIncome = db.cashLedger.reduce((sum, tx) => roundAmt(sum + tx.income), 0);
        const totalExpense = db.cashLedger.reduce((sum, tx) => roundAmt(sum + tx.expense), 0);

        area.innerHTML = `
          <div class="space-y-4 p-4 text-black bg-white font-sans">
            <div class="text-center">
              <h2 class="text-lg font-black">รายงานเงินสดรับ - จ่าย</h2>
              <p class="text-xs">สำหรับบุคคลธรรมดาเพื่อประกอบการยื่นแบบแสดงรายการภาษีเงินได้บุคคลธรรมดา</p>
              <p class="text-[10px] text-slate-500 mt-1">อ้างอิง: พระราชบัญญัติประมวลรัษฎากร (มาตรา 40(8))</p>
            </div>
            
            <div class="grid grid-cols-2 gap-4 text-[10px] bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div>
                <p><b>ชื่อผู้เสียภาษี (เจ้าของร้าน):</b> ${escapeHTML(db.settings.taxPayerName || db.storeName)}</p>
                <p><b>เลขประจำตัวผู้เสียภาษีอากร 13 หลัก:</b> ${escapeHTML(db.settings.taxPayerId || '-')}</p>
              </div>
              <div class="text-right">
                <p><b>ชื่อสถานประกอบการ:</b> ${escapeHTML(db.storeName)}</p>
                <p><b>ที่ตั้งร้านค้า:</b> ${escapeHTML(db.storeAddress)}</p>
              </div>
            </div>

            <table class="w-full text-left border border-slate-300 text-xs">
              <thead class="bg-slate-100 text-slate-700">
                <tr>
                  <th class="p-2 border text-center w-12">ที่</th>
                  <th class="p-2 border text-center w-24">วัน เดือน ปี</th>
                  <th class="p-2 border">รายการรายรับ - รายจ่าย</th>
                  <th class="p-2 border text-right text-emerald-700 w-28">รายรับ (บาท)</th>
                  <th class="p-2 border text-right text-rose-700 w-28">รายจ่าย (บาท)</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                <tr class="bg-slate-50 font-black text-xs border-t-2 border-slate-400">
                  <td colspan="3" class="p-2 border text-right">ยอดรวมสะสมทั้งสิ้น:</td>
                  <td class="p-2 border text-right text-emerald-600">${formatMoney(totalIncome)}</td>
                  <td class="p-2 border text-right text-rose-500">${formatMoney(totalExpense)}</td>
                </tr>
                <tr class="bg-indigo-50 font-black text-xs">
                  <td colspan="3" class="p-2 border text-right">ยอดเงินได้สุทธิทางบัญชีภาษี:</td>
                  <td colspan="2" class="p-2 border text-center text-indigo-700 text-sm">${formatMoney(roundAmt(totalIncome - totalExpense))}</td>
                </tr>
              </tbody>
            </table>

            <div class="mt-8 grid grid-cols-2 text-xs pt-10">
              <div class="text-center">
                <p>ลงชื่อ.............................................................. ผู้ทำบัญชี</p>
                <p class="mt-1">( ${escapeHTML(db.settings.taxPayerName || db.storeName)} )</p>
              </div>
              <div class="text-center">
                <p>วันที่พิมพ์รายงาน: ${new Date().toLocaleDateString('th-TH')}</p>
              </div>
            </div>
          </div>
        `;

        document.getElementById('doc-viewer-title').innerText = "📄 รายงานบัญชีเงินสดรับ-จ่าย สำหรับยื่นภาษี";
        document.getElementById('modal-document-viewer').classList.remove('hidden');
        document.getElementById('modal-document-viewer').classList.add('flex');
      };

      // ==========================================
      // INVENTORY STOCK ADJUSTMENT PANEL
      // ==========================================
      window.renderStockCount = function() {
        const container = document.getElementById('stock-count-list');
        const searchVal = document.getElementById('stock-count-search').value.trim().toLowerCase();
        let html = "";
        
        Object.values(db.products).forEach(p => {
          if (p.isDeleted) return;
          p.variants.forEach(v => {
            const isMatchSearch = p.name.toLowerCase().includes(searchVal) || 
                                 v.barcode.toLowerCase().includes(searchVal) || 
                                 v.sizeName.toLowerCase().includes(searchVal);
            if (searchVal && !isMatchSearch) return;

            if (window.tempCountStorage[v.id] === undefined) {
              window.tempCountStorage[v.id] = v.stock;
            }
            const currentCountVal = window.tempCountStorage[v.id];
            const currentDiff = roundStock(currentCountVal - v.stock);
            
            let diffHtml = "";
            if (currentDiff > 0) {
              diffHtml = `<span class="text-emerald-600 font-extrabold" id="diff-text-v-${escapeHTML(v.id)}">+${currentDiff} (สต็อกเกิน)</span>`;
            } else if (currentDiff < 0) {
              diffHtml = `<span class="text-rose-600 font-extrabold" id="diff-text-v-${escapeHTML(v.id)}">${currentDiff} (สต็อกขาด)</span>`;
            } else {
              diffHtml = `<span class="text-slate-400" id="diff-text-v-${escapeHTML(v.id)}">ตรงกัน</span>`;
            }

            html += `
              <div class="bg-white border p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center shadow-xs gap-3">
                <div class="flex-1 min-w-0">
                  <b class="text-slate-800 text-sm leading-tight block">${escapeHTML(p.name)}</b>
                  <span class="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-bold inline-block mt-1">ขนาด: ${escapeHTML(v.sizeName)}</span>
                  <p class="text-[10px] text-slate-400 mt-1">สต็อกในระบบ: <b class="text-slate-700">${v.stock} ชิ้น</b></p>
                </div>
                <div class="flex flex-col items-end gap-1.5 w-full sm:w-auto">
                  <div class="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                    <span class="font-bold text-slate-500 text-xs">ตรวจพบจริง:</span>
                    <input type="number" id="count-v-${escapeHTML(v.id)}" data-vstock="${v.stock}" oninput="window.updateTempCount('${escapeHTML(v.id)}', this.value)" class="w-24 p-2 border-2 border-emerald-100 focus:border-emerald-500 outline-none rounded-xl text-center font-black text-emerald-600 text-sm" value="${currentCountVal}">
                  </div>
                  <div class="text-[10px] font-bold text-right w-full sm:w-auto">
                    ส่วนต่าง: ${diffHtml}
                  </div>
                </div>
              </div>
            `;
          });
        });

        if(!html) html = `<p class="p-8 text-center text-slate-400 font-bold text-xs bg-white rounded-2xl border">ไม่มีรายการในคำค้นหาที่ต้องการนับ</p>`;
        container.innerHTML = html;
      };

      window.updateTempCount = function(vid, val) {
        let actual = parseFloat(val);
        if (isNaN(actual)) {
          actual = 0;
        }
        window.tempCountStorage[vid] = roundStock(actual);
        window.calcSingleVariance(vid);
      };

      window.calcSingleVariance = function(vid) {
        const input = document.getElementById(`count-v-${vid}`);
        if(!input) return;
        const systemStock = parseFloat(input.dataset.vstock) || 0;
        let actualValue = parseFloat(input.value);
        if (isNaN(actualValue)) {
          actualValue = 0;
        }
        const diffText = document.getElementById(`diff-text-v-${vid}`);
        if (!diffText) return;

        const diff = roundStock(actualValue - systemStock);
        if (diff > 0) {
          diffText.className = "text-emerald-600 font-extrabold";
          diffText.innerText = `+${diff} (สต็อกเกิน)`;
        } else if (diff < 0) {
          diffText.className = "text-rose-600 font-extrabold";
          diffText.innerText = `${diff} (สต็อกขาด)`;
        } else {
          diffText.className = "text-slate-400";
          diffText.innerText = "ตรงกัน";
        }
      };

      window.applyStockCount = function() {
        if (!guardOnce('applyStockCount')) return;
        window.showCustomConfirm("ปรับปรุงยอดสต็อกจริงที่ตรวจนับได้?", "ระบบจะเขียนยอดสต็อกในฐานข้อมูลทั้งหมดทับตามที่กรอกสำเร็จ", () => {
          let adjustCount = 0;
          Object.values(db.products).forEach(p => {
            if (p.isDeleted) return;
            p.variants.forEach(v => {
              const actual = window.tempCountStorage[v.id];
              if (actual !== undefined && roundStock(actual) !== roundStock(v.stock)) {
                v.stock = roundStock(actual);
                adjustCount++;
              }
            });
          });
          
          if (typeof window.decoupledPersist === 'function') {
            window.decoupledPersist(['products']);
          } else {
            persist();
          }

          logTransaction('STOCK_ADJUST', { adjustCount });
          window.renderStock(); showView('stock');
          showToast(`ปรับปรุงยอดสต็อกของร้านค้าสำเร็จ ${adjustCount} รายการ`);
        });
      };

      // ==========================================
      // PURCHASE ORDERS (PO) & RECEIVING GOODS
      // ==========================================
      window.switchPOTab = function(tab) {
        activePOTab = tab;
        document.getElementById('po-tab-CREATE_PO').className = tab === 'CREATE_PO' ? 'flex-1 py-2 px-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-xs btn-touch' : 'flex-1 py-2 px-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs border btn-touch';
        document.getElementById('po-tab-PENDING_PO').className = tab === 'PENDING_PO' ? 'flex-1 py-2 px-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-xs btn-touch' : 'flex-1 py-2 px-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs border btn-touch';

        if (tab === 'CREATE_PO') {
          document.getElementById('po-panel-CREATE_PO').classList.remove('hidden');
          document.getElementById('po-panel-PENDING_PO').classList.add('hidden');

          const poSelect = document.getElementById('po-select-product');
          poSelect.innerHTML = `<option value="">-- กรุณาเลือกสินค้า --</option>` +
            Object.values(db.products).filter(p => !p.isDeleted).map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');
          document.getElementById('po-variant-select-box').classList.add('hidden');
          window.refreshSupplierDropdown();
        } else {
          document.getElementById('po-panel-CREATE_PO').classList.add('hidden');
          document.getElementById('po-panel-PENDING_PO').classList.remove('hidden');
          renderPendingPOs();
        }
      };

      window.onPOProductSelect = function() {
        const pid = document.getElementById('po-select-product').value;
        const p = db.products[pid];
        if (p && p.variants.length > 0) {
          let opts = p.variants.map(v => `<option value="${escapeHTML(v.id)}">${escapeHTML(v.sizeName)} (คลังปัจจุบัน: ${v.stock})</option>`).join('');
          document.getElementById('po-select-variant').innerHTML = opts;
          document.getElementById('po-variant-select-box').classList.remove('hidden');

          document.getElementById('po-item-cost').value = roundAmt(p.variants[0].cost);
        } else {
          document.getElementById('po-variant-select-box').classList.add('hidden');
        }
      };

      window.addToPO = function() {
        const pid = document.getElementById('po-select-product').value;
        const vid = document.getElementById('po-select-variant').value;
        const qty = roundStock(parseFloat(document.getElementById('po-qty').value));
        const cost = roundAmt(parseFloat(document.getElementById('po-item-cost').value) || 0);

        if(!pid || !vid || !qty || qty <= 0) return showAlert("กรอกข้อมูลไม่ครบ", "กรุณาเลือกและระบุจำนวนหน่วยที่ถูกต้อง", true);

        const p = db.products[pid];
        const v = p.variants.find(x => x.id === vid);

        const existing = poList.find(item => item.productId === pid && item.variantId === vid);
        if (existing) {
          existing.qty = roundStock(existing.qty + qty);
          existing.cost = cost;
        } else {
          poList.push({
            id: 'PO-ITEM-' + generateID(),
            productId: pid,
            variantId: vid,
            productName: p.name,
            sizeName: v.sizeName,
            qty: qty,
            cost: cost
          });
        }

        document.getElementById('po-qty').value = "";
        document.getElementById('po-item-cost').value = "";
        renderPOItems();
      };

      function renderPOItems() {
        const container = document.getElementById('po-items-list');
        container.innerHTML = poList.map((item, idx) => `
          <div class="bg-white p-3 rounded-xl border flex justify-between items-center text-xs text-slate-800 shadow-sm">
            <div>
              <b class="text-sm block">${escapeHTML(item.productName)}</b>
              <span class="text-slate-400">ขนาด: ${escapeHTML(item.sizeName)} | ทุนที่ระบุ: ${formatMoney(item.cost)}</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="font-black text-indigo-600 text-sm">${item.qty} หน่วย</span>
              <button onclick="poList.splice(${idx}, 1); renderPOItems();" class="text-rose-500 text-xl font-bold p-1">&times;</button>
            </div>
          </div>
        `).join('');
        document.getElementById('po-footer').classList.toggle('hidden', poList.length === 0);
      }

      window.savePurchaseOrder = function() {
        if (!guardOnce('savePurchaseOrder')) return;
        if(poList.length === 0) return;
        const supplierId = document.getElementById('po-select-supplier').value;
        if (!supplierId || !db.suppliers[supplierId]) {
          return showAlert("ยังไม่ได้เลือกซัพพลายเออร์", "กรุณาเลือกซัพพลายเออร์ หรือกด \"จัดการซัพพลายเออร์\" เพื่อเพิ่มรายชื่อก่อน", true);
        }
        const sTerms = parseInt(document.getElementById('po-supplier-terms').value) || 30;

        const totalCost = poList.reduce((sum, item) => roundAmt(sum + (item.qty * item.cost)), 0);
        const poId = 'PO-' + generateID();

        const rDate = Date.now();
        const dDate = new Date(rDate + (sTerms * 24 * 60 * 60 * 1000));

        const itemsWithSnapshot = poList.map(item => {
          const v = db.products[item.productId] && db.products[item.productId].variants.find(x => x.id === item.variantId);
          return { ...item, stockBefore: v ? v.stock : null, costBefore: v ? v.cost : null };
        });

        const po = {
          id: poId,
          time: rDate,
          supplierId: supplierId,
          terms: sTerms,
          dueDate: dDate.toISOString().slice(0, 10),
          items: itemsWithSnapshot,
          total: totalCost,
          paidAmount: 0,
          status: 'UNPAID'
        };

        db.pos.push(po);

        poList.forEach(item => {
          if(db.products[item.productId]) {
            const v = db.products[item.productId].variants.find(x => x.id === item.variantId);
            if(v) {
              const oldTotalCost = roundAmt(v.stock * v.cost);
              const newTotalCost = roundAmt(item.qty * item.cost);
              v.stock = roundStock(v.stock + item.qty);
              if(v.stock > 0) {
                v.cost = roundAmt((oldTotalCost + newTotalCost) / v.stock);
              } else {
                v.cost = item.cost;
              }
            }
          }
        });

        persist();
        logTransaction('PO_RECEIVE', { poId, supplierId, total: totalCost, itemCount: po.items.length });
        poList = [];
        renderPOItems();
        showToast("รับของเข้าสต็อกและบันทึกตั้งบัญชีเจ้าหนี้เรียบร้อย (ยังไม่จ่ายเงิน)");
        window.switchPOTab('PENDING_PO');
      };

      function totalAccountsPayable() {
        return roundAmt(
          db.pos
            .filter(po => po.status === 'UNPAID')
            .reduce((sum, po) => sum + (po.total - (po.paidAmount || 0)), 0)
        );
      }

      function renderPendingPOs() {
        const apEl = document.getElementById('ap-total-summary');
        if (apEl) apEl.innerText = formatMoney(totalAccountsPayable());

        const container = document.getElementById('pending-po-list-container');
        let sortedPos = [...db.pos].sort((a,b) => b.time - a.time);

        container.innerHTML = sortedPos.map(po => {
          const sName = db.suppliers[po.supplierId] ? db.suppliers[po.supplierId].name : 'ซัพพลายเออร์ (ถูกลบแล้ว)';
          let itemsPreview = po.items.map(item => `
            <div class="flex justify-between text-[11px] text-slate-500 py-0.5">
              <span>• ${escapeHTML(item.productName)} (${escapeHTML(item.sizeName)})</span>
              <span>x${item.qty} (ทุน: ${formatMoney(item.cost)})</span>
            </div>
          `).join('');

          const isOverdue = po.status === 'UNPAID' && new Date(po.dueDate) < new Date();
          const remaining = roundAmt(po.total - (po.paidAmount || 0));

          return `
            <div class="bg-white p-4 border rounded-2xl shadow-xs text-slate-800">
              <div class="flex justify-between items-center mb-2 border-b pb-1.5">
                <div>
                  <b class="text-xs font-black text-indigo-600">${escapeHTML(po.id)}</b>
                  <p class="text-[9px] text-slate-400 font-bold mt-0.5">ซัพพลายเออร์: ${escapeHTML(sName)}</p>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-lg ${po.status === 'PAID' ? 'bg-emerald-50 text-emerald-600' : po.status === 'CANCELLED' ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-500'} font-bold">
                  ${po.status === 'PAID' ? '✅ จ่ายครบแล้ว' : po.status === 'CANCELLED' ? '🚫 ยกเลิกแล้ว' : isOverdue ? '🚨 ค้างชำระ (เกินกำหนด)' : '⏳ รอครบกำหนดชำระ'}
                </span>
              </div>
              <div class="mb-3 space-y-1">
                ${itemsPreview}
              </div>
              <div class="bg-slate-50 p-2 rounded-lg text-[10px] mb-3 flex justify-between">
                <span>📅 รับของ: ${new Date(po.time).toLocaleDateString('th-TH')}</span>
                <span>⌛ กำหนดชำระ: ${new Date(po.dueDate).toLocaleDateString('th-TH')}</span>
              </div>
              <div class="flex justify-between items-center text-[10px] text-slate-400 border-t pt-2 mt-2">
                <div>
                  <span>ยอดเต็ม: <b class="text-slate-600">${formatMoney(po.total)}</b></span>
                  ${po.paidAmount > 0 ? `<br><span>จ่ายแล้ว: <b class="text-emerald-600">${formatMoney(po.paidAmount)}</b> · คงเหลือ: <b class="text-rose-600">${formatMoney(remaining)}</b></span>` : ''}
                </div>
                ${po.status === 'UNPAID' ? `
                  <div class="flex gap-1.5">
                    <button onclick="window.openCancelPOConfirm('${escapeHTML(po.id)}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold rounded-lg text-[10px] btn-touch">ยกเลิกใบ</button>
                    <button onclick="window.openPaySupplierModal('${escapeHTML(po.id)}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] btn-touch shadow-xs">
                      💸 จ่ายเงิน
                    </button>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');

        if(sortedPos.length === 0) {
          container.innerHTML = '<p class="text-center text-slate-400 p-8 font-bold text-xs bg-white rounded-2xl border">ไม่มีประวัติการซื้อเชื่อเจ้าหนี้</p>';
        }
      }

      window.openPaySupplierModal = function(poId) {
        const po = db.pos.find(x => x.id === poId);
        if (!po) return;
        window.openManagerPinModal(() => {
          const remaining = roundAmt(po.total - (po.paidAmount || 0));
          const sName = db.suppliers[po.supplierId] ? db.suppliers[po.supplierId].name : 'ซัพพลายเออร์';
          document.getElementById('pay-supplier-po-id').value = poId;
          document.getElementById('pay-supplier-info').innerText = `${sName} — บิลเลขที่ ${po.id} (คงเหลือ ${formatMoney(remaining)})`;
          document.getElementById('pay-supplier-amount').value = remaining;
          document.getElementById('pay-supplier-amount').max = remaining;
          document.getElementById('modal-pay-supplier').classList.remove('hidden');
          document.getElementById('modal-pay-supplier').classList.add('flex');
        });
      };

      window.confirmPaySupplier = function() {
        if (!guardOnce('confirmPaySupplier')) return;
        const poId = document.getElementById('pay-supplier-po-id').value;
        const po = db.pos.find(x => x.id === poId);
        if (!po) return;

        const remaining = roundAmt(po.total - (po.paidAmount || 0));
        const amt = roundAmt(parseFloat(document.getElementById('pay-supplier-amount').value) || 0);
        if (amt <= 0) return showAlert("จำนวนไม่ถูกต้อง", "กรุณาระบุจำนวนเงินที่จะจ่ายให้ถูกต้อง", true);
        if (amt > remaining) return showAlert("จำนวนเกินยอดค้าง", `ยอดค้างชำระของบิลนี้เหลือ ${formatMoney(remaining)} เท่านั้น`, true);
        if (!db.currentShift) return showAlert("ไม่ได้เปิดกะ", "กรุณาเปิดกะก่อนทำการเบิกจ่ายเงินสด", true);
        if (db.currentShift.cashOnHand < amt) return showAlert("เงินสดไม่พอ", "เงินสดในลิ้นชักมีไม่พอสำหรับจ่ายค่าสินค้ายอดนี้", true);

        const sName = db.suppliers[po.supplierId] ? db.suppliers[po.supplierId].name : 'ซัพพลายเออร์';
        const isFullPayment = amt === remaining;

        window.showCustomConfirm(
          isFullPayment ? "ยืนยันจ่ายเงินให้เจ้าหนี้ (เต็มจำนวน)?" : "ยืนยันจ่ายเงินให้เจ้าหนี้ (บางส่วน)?",
          `จ่าย ${formatMoney(amt)} ให้ "${sName}" (บิลเลขที่ ${po.id}) เงินจะถูกหักออกจากลิ้นชักทันที${!isFullPayment ? ` — จะยังคงเหลือค้างชำระอีก ${formatMoney(roundAmt(remaining - amt))}` : ''}`,
          () => {
            db.currentShift.cashOnHand = roundAmt(db.currentShift.cashOnHand - amt);
            db.currentShift.transactions.push({
              time: Date.now(),
              type: 'OUT',
              cat: 'รายจ่าย-ซื้อของเข้าร้าน',
              note: `จ่ายเงินคู่ค้าบิลเลขที่ ${po.id}${!isFullPayment ? ' (จ่ายบางส่วน)' : ''}`,
              amt: amt
            });

            po.paidAmount = roundAmt((po.paidAmount || 0) + amt);
            if (po.paidAmount >= po.total) po.status = 'PAID';

            db.cashLedger.push({
              id: 'TX-' + generateID(),
              date: new Date().toISOString().slice(0, 10),
              description: `จ่ายเงินค่าซื้อสินค้าวัสดุก่อสร้างให้: ${sName} (อ้างอิงใบของเครดิต ${po.id})${!isFullPayment ? ' - จ่ายบางส่วน' : ''}`,
              income: 0,
              expense: amt,
              type: 'expense-goods',
              refId: po.id
            });

            persist();
            logTransaction('SUPPLIER_PAYMENT', { poId: po.id, supplierId: po.supplierId, amount: amt, fullyPaid: po.status === 'PAID' });
            updateShiftUI();
            renderPendingPOs();
            closeModal('modal-pay-supplier');
            showToast(po.status === 'PAID' ? "จ่ายเงินให้เจ้าหนี้ครบแล้ว!" : "บันทึกการจ่ายเงินบางส่วนเรียบร้อย");
          }
        );
      };

      window.openCancelPOConfirm = function(poId) {
        const po = db.pos.find(x => x.id === poId);
        if (!po) return;
        window.openManagerPinModal(() => {
          window.showCustomConfirm(
            "ยกเลิกใบสั่งซื้อนี้?",
            `จะคืนสต็อกสินค้าทั้งหมดในใบ ${po.id} กลับเป็นค่าก่อนรับของ และลบยอดเจ้าหนี้นี้ออกจากระบบ ใช้สำหรับกรณีกรอกข้อมูลผิดเท่านั้น การกระทำนี้ย้อนกลับไม่ได้`,
            () => window.cancelPurchaseOrder(poId)
          );
        });
      };

      window.cancelPurchaseOrder = function(poId) {
        if (!guardOnce('cancelPurchaseOrder')) return;
        const po = db.pos.find(x => x.id === poId);
        if (!po || po.status !== 'UNPAID') return;

        for (const item of po.items) {
          const v = db.products[item.productId] && db.products[item.productId].variants.find(x => x.id === item.variantId);
          if (!v || v.stock < item.qty) {
            return showAlert(
              "ยกเลิกไม่ได้",
              `สต็อกของ "${item.productName} (${item.sizeName})" ถูกขายหรือปรับไปแล้วบางส่วนหลังรับของล็อตนี้ จึงไม่สามารถคืนสต็อกกลับแบบปลอดภัยได้ กรุณาปรับสต็อกด้วยตนเองที่หน้าตรวจนับสต็อกแทน`,
              true
            );
          }
        }

        po.items.forEach(item => {
          const v = db.products[item.productId] && db.products[item.productId].variants.find(x => x.id === item.variantId);
          if (v && item.stockBefore !== null && item.costBefore !== null) {
            v.stock = item.stockBefore;
            v.cost = item.costBefore;
          }
        });

        po.status = 'CANCELLED';
        persist();
        logTransaction('PO_CANCEL', { poId: po.id, supplierId: po.supplierId, total: po.total });
        renderPendingPOs();
        showToast("ยกเลิกใบสั่งซื้อและคืนสต็อกเรียบร้อย");
      };

      window.renderPOItems = renderPOItems;
      window.renderPendingPOs = renderPendingPOs;

      // ==========================================
      // SUPPLIER MANAGEMENT
      // ==========================================

      function supplierUnpaidTotal(supplierId) {
        return roundAmt(
          db.pos
            .filter(po => po.supplierId === supplierId && po.status === 'UNPAID')
            .reduce((sum, po) => sum + (po.total - (po.paidAmount || 0)), 0)
        );
      }
      window.supplierUnpaidTotal = supplierUnpaidTotal;

      function refreshSupplierDropdown() {
        const sel = document.getElementById('po-select-supplier');
        if (!sel) return;
        const currentVal = sel.value;
        const suppliers = Object.values(db.suppliers || {});
        sel.innerHTML = suppliers.length === 0
          ? `<option value="">-- ยังไม่มีซัพพลายเออร์ กด "จัดการซัพพลายเออร์" เพื่อเพิ่ม --</option>`
          : suppliers.map(s => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join('');
        if (suppliers.some(s => s.id === currentVal)) sel.value = currentVal;
        const selected = db.suppliers[sel.value];
        if (selected) document.getElementById('po-supplier-terms').value = selected.terms || 30;
      }
      window.refreshSupplierDropdown = refreshSupplierDropdown;

      window.onPOSupplierSelect = function() {
        const s = db.suppliers[document.getElementById('po-select-supplier').value];
        if (s) document.getElementById('po-supplier-terms').value = s.terms || 30;
      };

      function renderSupplierManagerList() {
        const container = document.getElementById('supplier-manager-list');
        const suppliers = Object.values(db.suppliers || {});
        if (suppliers.length === 0) {
          container.innerHTML = '<p class="text-center text-slate-400 p-6 text-xs">ยังไม่มีซัพพลายเออร์ในระบบ</p>';
          return;
        }
        container.innerHTML = suppliers.map(s => {
          const unpaid = supplierUnpaidTotal(s.id);
          return `
            <div class="bg-white p-3 rounded-xl border flex justify-between items-center text-xs text-slate-800">
              <div>
                <b>${escapeHTML(s.name)}</b>
                <p class="text-[10px] text-slate-400">เลขผู้เสียภาษี: ${escapeHTML(s.taxId || '-')} · เครดิต ${s.terms || 30} วัน</p>
                ${unpaid > 0 ? `<p class="text-[10px] text-rose-500 font-bold mt-0.5">ค้างชำระ: ${formatMoney(unpaid)}</p>` : ''}
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <button onclick="window.openSupplierForm('${escapeHTML(s.id)}')" class="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg font-bold text-[10px] btn-touch">แก้ไข</button>
                <button onclick="window.deleteSupplier('${escapeHTML(s.id)}')" class="px-2 py-1 bg-rose-50 text-rose-600 rounded-lg font-bold text-[10px] btn-touch">ลบ</button>
              </div>
            </div>`;
        }).join('');
      }

      window.openSupplierManagerModal = function() {
        window.openManagerPinModal(() => {
          renderSupplierManagerList();
          window.openSupplierForm(null);
          document.getElementById('modal-supplier-manager').classList.remove('hidden');
          document.getElementById('modal-supplier-manager').classList.add('flex');
        });
      };

      window.openSupplierForm = function(id) {
        document.getElementById('edit-supplier-id').value = id || '';
        if (id && db.suppliers[id]) {
          const s = db.suppliers[id];
          document.getElementById('supplier-form-title').innerText = 'แก้ไขซัพพลายเออร์';
          document.getElementById('supplier-name').value = s.name;
          document.getElementById('supplier-taxid').value = s.taxId || '';
          document.getElementById('supplier-terms').value = s.terms || 30;
        } else {
          document.getElementById('supplier-form-title').innerText = 'เพิ่มซัพพลายเออร์ใหม่';
          document.getElementById('supplier-name').value = '';
          document.getElementById('supplier-taxid').value = '';
          document.getElementById('supplier-terms').value = 30;
        }
      };

      window.saveSupplier = function() {
        if (!guardOnce('saveSupplier')) return;
        const id = document.getElementById('edit-supplier-id').value;
        const name = document.getElementById('supplier-name').value.trim();
        const taxId = document.getElementById('supplier-taxid').value.trim();
        const terms = parseInt(document.getElementById('supplier-terms').value) || 30;
        if (!name) return showAlert('ข้อมูลไม่ครบ', 'กรุณาระบุชื่อซัพพลายเออร์', true);

        const isNew = !id;
        const finalId = id || ('S' + String(Object.keys(db.suppliers || {}).length + 1).padStart(3, '0') + '-' + generateID());
        db.suppliers[finalId] = { id: finalId, name, taxId, terms };
        persist();
        logTransaction(isNew ? 'SUPPLIER_CREATE' : 'SUPPLIER_EDIT', { supplierId: finalId, name });
        refreshSupplierDropdown();
        renderSupplierManagerList();
        window.openSupplierForm(null);
        showToast('บันทึกข้อมูลซัพพลายเออร์สำเร็จ');
      };

      window.deleteSupplier = function(id) {
        if (!guardOnce('deleteSupplier')) return;
        const unpaid = supplierUnpaidTotal(id);
        if (unpaid > 0) {
          return showAlert('ลบไม่ได้', `ซัพพลายเออร์รายนี้ยังมียอดค้างชำระ ${formatMoney(unpaid)} อยู่ กรุณาจ่ายให้ครบก่อนลบ`, true);
        }
        const hasHistory = db.pos.some(po => po.supplierId === id);
        window.showCustomConfirm(
          'ลบซัพพลายเออร์นี้?',
          hasHistory
            ? 'ซัพพลายเออร์รายนี้มีประวัติใบสั่งซื้อเก่าอยู่ ประวัติจะยังคงอยู่ในระบบ แต่จะไม่สามารถสั่งซื้อใหม่จากรายนี้ได้อีก'
            : 'ยืนยันการลบซัพพลายเออร์รายนี้ออกจากระบบ',
          () => {
            const name = db.suppliers[id] ? db.suppliers[id].name : id;
            delete db.suppliers[id];
            persist();
            logTransaction('SUPPLIER_DELETE', { supplierId: id, name });
            refreshSupplierDropdown();
            renderSupplierManagerList();
            showToast('ลบซัพพลายเออร์สำเร็จ');
          }
        );
      };

      // ==========================================
      // CAMERA SCANNER (WITH HTTPS PRE-FLIGHT CHECK)
      // ==========================================
      window.startCameraScan = function() {
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
          return showAlert("ความปลอดภัยของเบราว์เซอร์", "ระบบกล้องสแกนบาร์โค้ดต้องการการเชื่อมต่อแบบปลอดภัย (HTTPS) เพื่ออนุญาตสิทธิ์การเข้าถึงกล้องถ่ายภาพ กรุณารันแอปพลิเคชันบนเซิร์ฟเวอร์ที่มี SSL ติดตั้ง", true);
        }

        document.getElementById('modal-camera').classList.remove('hidden');
        document.getElementById('modal-camera').classList.add('flex');
        isCameraActive = true;
        
        if (!scanner) {
          scanner = new Html5Qrcode("reader");
        }
        
        const config = { fps: 15, qrbox: { width: 250, height: 250 } };
        scanner.start(
          { facingMode: currentFacingMode }, 
          config, 
          (decodedText) => {
            playSound('success');
            window.stopCameraScan();
            document.getElementById('search-product').value = decodedText;
            window.onSearchInput({target: {value: decodedText}});
          }
        ).catch(err => {
          console.warn("Camera start err:", err);
          showAlert("สแกนล้มเหลว", "ไม่สามารถเปิดกล้องหลักของระบบได้ โปรดตรวจสอบความสมบูรณ์ของการเชื่อมต่อ SSL และการอนุญาตสิทธิ์เข้าถึงกล้อง", true);
          window.stopCameraScan();
        });
      };

      window.stopCameraScan = function() {
        if (scanner && isCameraActive) {
          scanner.stop().then(() => {
            isCameraActive = false;
            closeModal('modal-camera');
          }).catch(err => {
            console.log(err);
            closeModal('modal-camera');
          });
        } else {
          closeModal('modal-camera');
        }
      };

      window.toggleCamera = function() {
        currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
        if (scanner && isCameraActive) {
          scanner.stop().then(() => { startCameraScan(); });
        }
      };

      // ==========================================



/* END */

/* START part3.js */
// ==========================================
// SMART POS PRO — PART 3 of 3 (plain <script>, no build step)
// Excel import, settings, backup/restore, storage quota, archive, auto-backup, and the new Database Validator/Health/Audit Log/Auto Repair/Versioning + full Sheets sync systems
// Loaded in order via <script> tags in index.html — this file shares the
// same global scope as the other parts, so functions/variables defined in
// any part are usable from any other part. Load order in index.html matters
// (Part 1 must load before Part 2, etc.) but call order does not — a
// function only needs to EXIST by the time it's actually invoked (e.g. a
// button click), not by the time the file that calls it was parsed.
// ==========================================

      // EXCEL / CSV QUICK IMPORT ENGINE
      // ==========================================
      // Each ROW represents either:
      //  - a "MAIN" row: one size/variant of a product (ชื่อสินค้า + ขนาด + ทุน/ราคาขาย/สต็อก)
      //  - a "FRACTION" row: one แบ่งขาย option that belongs to the size named in the same
      //    "ขนาด" column of a MAIN row (matched by ชื่อสินค้า + ขนาด). This lets one flat
      //    table fully represent multi-size products AND แบ่งขาย products, and lets
      //    window.exportExcel() produce a file that re-imports into this same tool with all
      //    columns auto-matched (see checkHeaderMatch rules below, which match this exact
      //    wording first).
      const fieldsToMap = [
        { key: 'name', label: 'ชื่อสินค้าหลัก' },
        { key: 'rowType', label: 'ประเภทแถว (ขนาดหลัก/แบ่งขาย)' },
        { key: 'size', label: 'ขนาดสินค้า' },
        { key: 'category', label: 'หมวดหมู่สินค้า' },
        { key: 'groupName', label: 'กลุ่มสินค้า (การ์ดร่วม, ถ้ามี)' },
        { key: 'barcode', label: 'รหัสบาร์โค้ด' },
        { key: 'cost', label: 'ราคาทุน' },
        { key: 'price', label: 'ราคาขาย (หรือราคาแบ่งขาย)' },
        { key: 'stock', label: 'จำนวนสต็อก' },
        { key: 'minStock', label: 'จุดสั่งซื้อขั้นต่ำ' },
        { key: 'fractionName', label: 'ชื่อหน่วยแบ่งขาย' },
        { key: 'fractionMultiplier', label: 'อัตราส่วนแบ่งขาย' }
      ];

      function checkHeaderMatch(header, key) {
        if (!header) return false;
        header = header.toString().toLowerCase().trim();

        // เช็คตรงตัวกับหัวคอลัมน์ที่ window.exportExcel() สร้างเองก่อนเสมอ — คอลัมน์ใหม่บาง
        // คอลัมน์มีคำคาบเกี่ยวกัน (เช่น "ชื่อหน่วยแบ่งขาย" มีคำว่า "ชื่อ" และ "ขาย" ปนอยู่ ซึ่งเป็น
        // คำสำคัญของ "ชื่อสินค้า" และ "ราคาขาย" ด้วย, "กลุ่มสินค้า" มีคำว่า "สินค้า" ปนอยู่ด้วยเช่นกัน)
        // ถ้าจับคู่แบบทายคำอย่างเดียวจะเดาผิดฟิลด์ได้ การเช็คตรงตัวก่อนจึงรับประกันว่าไฟล์ที่ส่งออก
        // จากระบบเองจะจับคู่คอลัมน์ถูกทุกครั้งทันที โดยไม่ต้องจับคู่มือ ส่วนไฟล์จากภายนอกที่หัวคอลัมน์
        // ไม่ตรงเป๊ะจะยังคงใช้การทายคำถัดไป
        const exactHeaders = {
          name: 'ชื่อสินค้า', rowType: 'ประเภทแถว', size: 'ขนาด', category: 'หมวดหมู่',
          groupName: 'กลุ่มสินค้า', barcode: 'บาร์โค้ด', cost: 'ทุน', price: 'ราคาขาย', stock: 'สต็อก',
          minStock: 'สต็อกขั้นต่ำ', fractionName: 'ชื่อหน่วยแบ่งขาย', fractionMultiplier: 'อัตราส่วนแบ่งขาย'
        };
        const exactMatchKey = Object.keys(exactHeaders).find(k => exactHeaders[k].toLowerCase() === header);
        if (exactMatchKey) return exactMatchKey === key;

        const rules = {
          name: ["ชื่อสินค้า", "ชื่อ", "name", "สินค้า", "product", "รายการ"],
          rowType: ["ประเภทแถว", "ประเภท", "rowtype", "row type", "type"],
          size: ["ขนาด", "size", "รุ่น", "variant"],
          category: ["หมวดหมู่", "category", "หมวด", "ประเภทสินค้า", "cat"],
          groupName: ["กลุ่มสินค้า", "กลุ่ม", "group"],
          barcode: ["บาร์โค้ด", "barcode", "รหัส", "code", "id", "sku"],
          cost: ["ทุน", "cost", "ซื้อ", "ราคาส่ง"],
          price: ["ราคาขาย", "ขาย", "ราคา", "price", "ปลีก"],
          stock: ["สต็อก", "stock", "จำนวน", "คงเหลือ", "qty", "quantity", "ชิ้น"],
          minStock: ["ขั้นต่ำ", "min", "reorder", "เกณฑ์", "เตือน"],
          fractionName: ["ชื่อหน่วยแบ่งขาย", "หน่วยแบ่งขาย", "fraction name", "fractionname"],
          fractionMultiplier: ["อัตราส่วนแบ่งขาย", "อัตราส่วน", "multiplier", "fraction"]
        };
        // ถ้าหัวคอลัมน์เข้าเงื่อนไข "สต็อกขั้นต่ำ" (มีคำว่า "ขั้นต่ำ") ให้ตัดสิทธิ์ฟิลด์ "สต็อก" ทั่วไป
        // ออกก่อน เพราะ "สต็อกขั้นต่ำ" มีคำว่า "สต็อก" ปนอยู่ด้วยเช่นกัน (ทายคำซ้อนกัน)
        if (key === 'stock' && rules.minStock.some(term => header.includes(term))) return false;

        return rules[key] ? rules[key].some(term => header.includes(term)) : false;
      }

      window.handleBulkFileUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        const fileExtension = file.name.split('.').pop().toLowerCase();

        reader.onload = function(e) {
          try {
            const data = new Uint8Array(e.target.result);
            let workbook;
            
            if (fileExtension === 'csv') {
              let decodedText;
              try {
                const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                decodedText = utf8Decoder.decode(data);
              } catch (err) {
                const winDecoder = new TextDecoder('windows-874');
                decodedText = winDecoder.decode(data);
              }
              workbook = XLSX.read(decodedText, { type: 'string' });
            } else {
              workbook = XLSX.read(data, { type: 'array' });
            }

            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

            if (json.length < 2) return showAlert("ไฟล์ไม่มีข้อมูล", "ไม่พบข้อมูลสำหรับประมวลผลภายในตารางของไฟล์นี้", true);
            
            uploadedHeaders = json[0].map(h => (h || '').toString().trim());
            uploadedRows = json.slice(1).filter(row => row && row.some(cell => cell !== null && cell !== undefined && cell !== ''));
            showMappingSetup();
          } catch (err) {
            console.error(err);
            showAlert("ข้อผิดพลาดการอ่านข้อมูล", "เกิดปัญหาขัดข้องขณะถอดรหัสโครงสร้างตารางของไฟล์นี้", true);
          }
        };
        
        reader.readAsArrayBuffer(file);
      };

      window.openQuickCommandModal = function() {
        document.getElementById('command-input').value = "";
        document.getElementById('import-preview-area').innerHTML = "";
        document.getElementById('preview-actions-bar').classList.add('hidden');
        document.getElementById('import-hint').classList.add('hidden');
        document.getElementById('import-mapping-sec').classList.add('hidden');
        document.getElementById('btn-confirm-import').classList.add('hidden');
        pendingImportData = []; uploadedHeaders = []; uploadedRows = [];
        document.getElementById('modal-command').classList.remove('hidden');
        document.getElementById('modal-command').classList.add('flex');
      };

      window.processCommandText = function() {
        const text = document.getElementById('command-input').value.trim();
        if(!text) return showAlert("ไม่มีข้อมูล", "กรุณากรอกระบุข้อมูลสินค้าแบบรายบรรทัดเพื่อวิเคราะห์ข้อมูล", true);

        const rows = text.split('\n').map(line => line.split(',').map(cell => cell.trim()));
        if (rows.length < 1) return showAlert("รูปแบบข้อมูลตกหล่น", "โปรดตรวจสอบรูปแบบการใช้เครื่องหมายจุลภาคคั่นระหว่างข้อมูล", true);

        uploadedHeaders = ["ชื่อสินค้า", "ขนาด", "หมวดหมู่", "บาร์โค้ด", "ราคาทุน", "ราคาขาย", "จำนวนสต็อก", "จุดสั่งซื้อขั้นต่ำ"];
        uploadedRows = rows;

        showMappingSetup();
      };

      function showMappingSetup() {
        const grid = document.getElementById('mapping-selectors-grid');
        grid.innerHTML = fieldsToMap.map(field => {
          let optionsHtml = `<option value="">-- ไม่ระบุ (ใช้ค่าเริ่มต้น) --</option>`;
          uploadedHeaders.forEach((header, idx) => {
            const isMatch = checkHeaderMatch(header, field.key);
            optionsHtml += `<option value="${idx}" ${isMatch ? 'selected' : ''}>${escapeHTML(header)}</option>`;
          });
          return `
            <div>
              <label class="font-bold text-indigo-900 block mb-1 text-[10px]">${escapeHTML(field.label)}</label>
              <select id="map-${escapeHTML(field.key)}" class="w-full bg-white border p-1 rounded font-bold outline-none text-[10px] text-slate-800">${optionsHtml}</select>
            </div>
          `;
        }).join('');

        document.getElementById('import-mapping-sec').classList.remove('hidden');
      }

      // Parses a raw cell value into a number, distinguishing "left blank" (use default,
      // not an error) from "typed something that isn't a valid, non-negative number" (error).
      function parseImportNumber(raw, defaultIfBlank) {
        if (defaultIfBlank === undefined) defaultIfBlank = 0;
        if (raw === undefined || raw === null || raw.toString().trim() === '') {
          return { value: defaultIfBlank, blank: true, invalid: false, negative: false };
        }
        // Strip thousand-separator commas and stray whitespace first. Without this,
        // parseFloat("1,000") silently returns 1 (stops at the comma) instead of 1000
        // or NaN — a mis-typed price/stock would sail through validation undetected.
        const cleaned = raw.toString().replace(/,/g, '').trim();
        const num = parseFloat(cleaned);
        if (isNaN(num)) return { value: defaultIfBlank, blank: false, invalid: true, negative: false };
        return { value: num, blank: false, invalid: false, negative: num < 0 };
      }

      window.applyColumnMappingAndAnalyze = function() {
        const mapping = {};
        fieldsToMap.forEach(field => {
          const el = document.getElementById(`map-${field.key}`);
          const val = el ? el.value : "";
          mapping[field.key] = val !== "" ? parseInt(val) : null;
        });

        if (mapping.name === null) {
          return showAlert("ยังไม่ได้จับคู่คอลัมน์ชื่อสินค้า", "กรุณาเลือกคอลัมน์ที่ตรงกับ \"ชื่อสินค้าหลัก\" ก่อนวิเคราะห์ข้อมูล มิฉะนั้นทุกแถวจะถูกตีว่าผิดพลาดเพราะไม่มีชื่อ", true);
        }

        pendingImportData = [];
        let rowIdCounter = 0;

        uploadedRows.forEach((row) => {
          if (!row || row.length === 0 || row.join('').trim() === "") return;

          let name = mapping.name !== null ? (row[mapping.name] || '').toString().trim() : '';
          let sizeName = mapping.size !== null ? (row[mapping.size] || '').toString().trim() : '';
          let category = mapping.category !== null ? (row[mapping.category] || '').toString().trim() : '';
          let groupName = mapping.groupName !== null ? (row[mapping.groupName] || '').toString().trim() : '';
          let rowTypeRaw = mapping.rowType !== null ? (row[mapping.rowType] || '').toString().trim() : '';
          name = window.repairThaiText(name);
          sizeName = window.repairThaiText(sizeName) || 'ปกติ';
          category = window.repairThaiText(category);
          groupName = window.repairThaiText(groupName);

          // ไม่ระบุคอลัมน์ประเภทแถว หรือเว้นว่างไว้ = ถือเป็นแถว "ขนาดหลัก" ตามค่าเริ่มต้น
          // (ย้อนหลังเข้ากันได้กับไฟล์เก่าที่ไม่มีคอลัมน์นี้)
          const isFractionRow = /แบ่ง|fraction/i.test(rowTypeRaw);

          const rawBarcode = mapping.barcode !== null ? (row[mapping.barcode] || '').toString().trim() : '';
          const costP = parseImportNumber(mapping.cost !== null ? row[mapping.cost] : undefined, 0);
          const priceP = parseImportNumber(mapping.price !== null ? row[mapping.price] : undefined, 0);
          const stockP = parseImportNumber(mapping.stock !== null ? row[mapping.stock] : undefined, 0);
          const minP = parseImportNumber(mapping.minStock !== null ? row[mapping.minStock] : undefined, 10);

          let fractionName = mapping.fractionName !== null ? (row[mapping.fractionName] || '').toString().trim() : '';
          fractionName = window.repairThaiText(fractionName);
          const fractionMultiplierP = parseImportNumber(mapping.fractionMultiplier !== null ? row[mapping.fractionMultiplier] : undefined, 0);

          pendingImportData.push({
            _rowId: 'R' + (rowIdCounter++),
            id: 'P-' + generateID(),
            rowType: isFractionRow ? 'FRACTION' : 'MAIN',
            name, sizeName, category, groupName, barcode: rawBarcode,
            cost: costP.value, costRaw: costP,
            price: priceP.value, priceRaw: priceP,
            stock: stockP.value, stockRaw: stockP,
            minStock: minP.value, minRaw: minP,
            fractionName, fractionMultiplier: fractionMultiplierP.value, fractionMultiplierRaw: fractionMultiplierP
          });
        });

        window.revalidateAndRenderImportPreview();
      };

      // Re-checks every row for format errors AND duplicates (both within the uploaded file
      // and against products already in the stock database), then redraws the preview table.
      // Called after the initial analyze pass, and again after every inline edit / row removal,
      // so the person always sees up-to-date validation before committing anything.
      window.revalidateAndRenderImportPreview = function() {
        const barcodeCounts = {};
        const nameSizeCounts = {}; // counts MAIN rows only (one variant per name+size)
        const fractionKeyCounts = {}; // counts FRACTION rows per name+size+fractionName
        pendingImportData.forEach(item => {
          const bc = (item.barcode || '').toLowerCase();
          if (item.rowType !== 'FRACTION' && bc) barcodeCounts[bc] = (barcodeCounts[bc] || 0) + 1;
          const ns = item.name.toLowerCase() + '|' + item.sizeName.toLowerCase();
          if (item.name) {
            if (item.rowType === 'FRACTION') {
              const fk = ns + '|' + (item.fractionName || '').toLowerCase();
              fractionKeyCounts[fk] = (fractionKeyCounts[fk] || 0) + 1;
            } else {
              nameSizeCounts[ns] = (nameSizeCounts[ns] || 0) + 1;
            }
          }
        });

        // Map every barcode already in the live database to the product/size it belongs to,
        // so we can tell "this row updates that same item" apart from "this barcode collides
        // with a totally different product" (which would break barcode scanning if imported).
        const dbBarcodeMap = {};
        // Map name+size -> { cost, existsInDb } so FRACTION rows can find their parent variant's
        // cost, whether that variant is already in the database or is a MAIN row earlier in
        // this same file (both cases must work for a re-imported export to round-trip cleanly).
        const dbVariantByNameSize = {};
        Object.values(db.products).forEach(p => {
          if (p.isDeleted) return;
          p.variants.forEach(v => {
            if (v.barcode) dbBarcodeMap[v.barcode.toString().toLowerCase()] = { productName: p.name, sizeName: v.sizeName };
            dbVariantByNameSize[p.name.toLowerCase() + '|' + v.sizeName.toLowerCase()] = { cost: v.cost };
          });
        });
        pendingImportData.forEach(item => {
          if (item.rowType !== 'FRACTION' && item.name) {
            const ns = item.name.toLowerCase() + '|' + item.sizeName.toLowerCase();
            dbVariantByNameSize[ns] = { cost: item.cost }; // MAIN rows in-file take priority over DB
          }
        });

        // Names of products currently suspended (ระงับการขาย) — importing a row with a
        // matching name will revive that product rather than create a duplicate, so flag
        // it as a warning up front instead of surprising the person after confirming.
        const deletedProductNames = new Set(
          Object.values(db.products).filter(p => p.isDeleted).map(p => p.name.toLowerCase())
        );

        const existingCategoryNames = new Set(db.categories.map(c => c.name.toLowerCase()));

        pendingImportData.forEach(item => {
          const errors = [];
          const warnings = [];

          if (!item.name) errors.push('ชื่อสินค้าว่าง');

          if (item.rowType === 'FRACTION') {
            // แถวแบ่งขาย: อ้างอิงขนาดหลักด้วยชื่อสินค้า+ขนาด ไม่มีทุน/สต็อกของตัวเอง
            // (ใช้ทุนของขนาดหลักคูณอัตราส่วนแทน เหมือนตอนขายจริง)
            if (!item.fractionName) errors.push('ยังไม่ได้ระบุชื่อหน่วยแบ่งขาย');

            if (item.fractionMultiplierRaw.invalid) errors.push('อัตราส่วนแบ่งขายไม่ใช่ตัวเลข');
            else if (item.fractionMultiplierRaw.blank || item.fractionMultiplier <= 0) errors.push('อัตราส่วนแบ่งขายต้องมากกว่า 0');

            if (item.priceRaw.invalid) errors.push('ราคาแบ่งขายไม่ใช่ตัวเลข');
            else if (item.priceRaw.negative) errors.push('ราคาแบ่งขายติดลบ');

            const ns = item.name.toLowerCase() + '|' + item.sizeName.toLowerCase();
            const parent = dbVariantByNameSize[ns];
            if (!parent) {
              errors.push(`ไม่พบขนาดหลัก "${item.sizeName}" ของสินค้านี้ (ต้องมีแถว "ขนาดหลัก" ชื่อ+ขนาดเดียวกันอยู่ในไฟล์ หรือมีอยู่แล้วในระบบ)`);
            } else if (!item.fractionMultiplierRaw.invalid && item.fractionMultiplier > 0 && !item.priceRaw.invalid && !item.priceRaw.negative) {
              const impliedCost = roundAmt(parent.cost * item.fractionMultiplier);
              if (item.price > 0 && impliedCost > 0 && item.price < impliedCost) {
                warnings.push(`ราคาแบ่งขายต่ำกว่าทุนต่อหน่วย (ทุนโดยประมาณ ${formatMoney(impliedCost)}) — ขาดทุน`);
              }
            }

            if (item.name && item.fractionName) {
              const fk = ns + '|' + item.fractionName.toLowerCase();
              if (fractionKeyCounts[fk] > 1) errors.push('ชื่อหน่วยแบ่งขายซ้ำกันเองในไฟล์นี้ (ขนาดเดียวกัน)');
            }
          } else {
            if (item.costRaw.invalid) errors.push('ทุนไม่ใช่ตัวเลข');
            else if (item.costRaw.negative) errors.push('ทุนติดลบ');

            if (item.priceRaw.invalid) errors.push('ราคาขายไม่ใช่ตัวเลข');
            else if (item.priceRaw.negative) errors.push('ราคาขายติดลบ');

            if (item.stockRaw.invalid) errors.push('สต็อกไม่ใช่ตัวเลข');
            else if (item.stockRaw.negative) errors.push('สต็อกติดลบ');

            if (item.minRaw.invalid) errors.push('สต็อกขั้นต่ำไม่ใช่ตัวเลข');
            else if (item.minRaw.negative) errors.push('สต็อกขั้นต่ำติดลบ');

            const bc = (item.barcode || '').toLowerCase();
            if (bc && barcodeCounts[bc] > 1) errors.push('บาร์โค้ดซ้ำกันเองในไฟล์นี้');

            if (bc && dbBarcodeMap[bc]) {
              const owner = dbBarcodeMap[bc];
              const isSameItem = owner.productName.toLowerCase() === item.name.toLowerCase() && owner.sizeName === item.sizeName;
              if (!isSameItem) {
                errors.push(`บาร์โค้ดนี้ถูกใช้กับ "${owner.productName} (${owner.sizeName})" อยู่แล้ว`);
              }
            }

            if (item.name) {
              const ns = item.name.toLowerCase() + '|' + item.sizeName.toLowerCase();
              if (nameSizeCounts[ns] > 1) errors.push('ชื่อ+ขนาดซ้ำกันเองในไฟล์นี้');
              if (deletedProductNames.has(item.name.toLowerCase())) {
                warnings.push('สินค้านี้เคยถูกระงับการขายไว้ — นำเข้าจะกู้คืนสถานะให้ขายได้อีกครั้ง');
              }
            }

            if (!item.priceRaw.invalid && !item.costRaw.invalid && item.price > 0 && item.cost > 0 && item.price < item.cost) {
              warnings.push('ราคาขายต่ำกว่าทุน (ขาดทุน)');
            }

            if (item.category && !existingCategoryNames.has(item.category.toLowerCase())) {
              warnings.push(`หมวดหมู่ "${item.category}" ยังไม่มีในระบบ — จะสร้างหมวดหมู่ใหม่ให้อัตโนมัติ`);
            }
          }

          item.errors = errors;
          item.warnings = warnings;
          item.isValid = errors.length === 0;
        });

        renderImportPreviewTable();
      };

      function renderImportPreviewTable() {
        const rows = pendingImportData;
        const successCount = rows.filter(r => r.isValid && r.warnings.length === 0).length;
        const warnCount = rows.filter(r => r.isValid && r.warnings.length > 0).length;
        const errorCount = rows.filter(r => !r.isValid).length;

        const editableCell = (rowId, field, value, type) => {
          const display = (value === undefined || value === null || value === '') ? '' : value.toString();
          return `<span class="inline-edit-cell" onclick="window.editImportCell('${rowId}','${field}',this,'${type || 'text'}')">${escapeHTML(display)}</span>`;
        };
        const naCell = () => `<span class="text-slate-300">—</span>`;

        let html = `
          <table class="w-full text-left border text-[10px] whitespace-nowrap text-slate-700">
            <thead class="bg-slate-100 sticky top-0 z-10">
              <tr>
                <th class="p-2 border min-w-[160px] whitespace-normal">สถานะ (คลิกค่าในตารางเพื่อแก้ไข)</th>
                <th class="p-2 border">ประเภท</th>
                <th class="p-2 border">สินค้าหลัก</th>
                <th class="p-2 border">ขนาด</th>
                <th class="p-2 border">หมวดหมู่</th>
                <th class="p-2 border font-mono">บาร์โค้ด</th>
                <th class="p-2 border">ทุน</th>
                <th class="p-2 border">ราคาขาย / ราคาแบ่งขาย</th>
                <th class="p-2 border">สต็อก</th>
                <th class="p-2 border text-rose-500">ขั้นต่ำ</th>
                <th class="p-2 border">ชื่อหน่วยแบ่งขาย</th>
                <th class="p-2 border">อัตราส่วน</th>
                <th class="p-2 border"></th>
              </tr>
            </thead>
            <tbody>
        `;

        rows.forEach(item => {
          const isFraction = item.rowType === 'FRACTION';
          const rowClass = !item.isValid ? 'bg-rose-50' : (item.warnings.length ? 'bg-amber-50' : (isFraction ? 'bg-emerald-50/40' : 'bg-white'));
          let statusLabel;
          if (!item.isValid) statusLabel = `❌ ${escapeHTML(item.errors.join(' / '))}`;
          else if (item.warnings.length) statusLabel = `⚠️ ${escapeHTML(item.warnings.join(' / '))}`;
          else statusLabel = '✅ พร้อมนำเข้า';

          const barcodeCell = item.barcode
            ? editableCell(item._rowId, 'barcode', item.barcode, 'text')
            : `<span class="inline-edit-cell text-slate-400 italic" onclick="window.editImportCell('${item._rowId}','barcode',this,'text')">(สร้างอัตโนมัติ)</span>`;

          html += `
            <tr class="${rowClass}">
              <td class="p-2 border font-bold max-w-[220px] whitespace-normal">${statusLabel}</td>
              <td class="p-2 border text-center">${isFraction ? '✂️ แบ่งขาย' : '📦 ขนาดหลัก'}</td>
              <td class="p-2 border">${editableCell(item._rowId, 'name', item.name, 'text')}</td>
              <td class="p-2 border">${editableCell(item._rowId, 'sizeName', item.sizeName, 'text')}</td>
              <td class="p-2 border">${isFraction ? naCell() : (item.category ? editableCell(item._rowId, 'category', item.category, 'text') : `<span class="inline-edit-cell text-slate-400 italic" onclick="window.editImportCell('${item._rowId}','category',this,'text')">(งานทั่วไป)</span>`)}</td>
              <td class="p-2 border font-mono">${isFraction ? naCell() : barcodeCell}</td>
              <td class="p-2 border">${isFraction ? naCell() : editableCell(item._rowId, 'cost', item.cost, 'number')}</td>
              <td class="p-2 border text-indigo-600 font-bold">${editableCell(item._rowId, 'price', item.price, 'number')}</td>
              <td class="p-2 border text-emerald-600 font-bold">${isFraction ? naCell() : editableCell(item._rowId, 'stock', item.stock, 'number')}</td>
              <td class="p-2 border text-rose-600 font-bold">${isFraction ? naCell() : editableCell(item._rowId, 'minStock', item.minStock, 'number')}</td>
              <td class="p-2 border">${isFraction ? editableCell(item._rowId, 'fractionName', item.fractionName, 'text') : naCell()}</td>
              <td class="p-2 border">${isFraction ? editableCell(item._rowId, 'fractionMultiplier', item.fractionMultiplier, 'number') : naCell()}</td>
              <td class="p-2 border text-center"><button onclick="window.removeImportRow('${item._rowId}')" title="ลบแถวนี้ออกจากการนำเข้า" class="text-rose-500 font-black">✕</button></td>
            </tr>
          `;
        });

        html += `</tbody></table>`;
        document.getElementById('import-preview-area').innerHTML = html;

        document.getElementById('import-stats').innerHTML =
          `ทั้งหมด <b>${rows.length}</b> แถว &nbsp;|&nbsp; ✅ พร้อมนำเข้า <b class="text-emerald-600">${successCount}</b> &nbsp;|&nbsp; ⚠️ มีคำเตือน <b class="text-amber-500">${warnCount}</b> &nbsp;|&nbsp; ❌ ผิดพลาด (จะไม่ถูกนำเข้า) <b class="text-rose-500">${errorCount}</b>`;
        document.getElementById('preview-actions-bar').classList.remove('hidden');
        document.getElementById('import-hint').classList.remove('hidden');
        document.getElementById('btn-confirm-import').classList.toggle('hidden', rows.filter(r => r.isValid).length === 0);
      }

      // Turns one preview cell into an inline text/number input, exactly like the stock
      // spreadsheet editor, so mistakes caught by validation can be fixed on the spot without
      // re-uploading the file. Saving re-runs full validation (duplicates can depend on other rows).
      window.editImportCell = function(rowId, field, element, inputType) {
        if (element.querySelector('input')) return;
        const item = pendingImportData.find(r => r._rowId === rowId);
        if (!item) return;

        const currentValue = item[field];
        const input = document.createElement('input');
        input.type = inputType === 'number' ? 'number' : 'text';
        if (inputType === 'number') input.step = 'any';
        input.className = 'inline-input';
        input.value = (field === 'barcode' && !currentValue) ? '' : currentValue;

        element.innerHTML = '';
        element.appendChild(input);
        input.focus(); input.select();

        const save = () => {
          const raw = input.value;
          if (inputType === 'number') {
            const parsed = parseImportNumber(raw, field === 'minStock' ? 10 : 0);
            item[field] = parsed.value;
            item[field + 'Raw'] = parsed;
          } else if (field === 'sizeName') {
            item.sizeName = window.repairThaiText(raw.trim()) || 'ปกติ';
          } else if (field === 'name') {
            item.name = window.repairThaiText(raw.trim());
          } else if (field === 'category') {
            item.category = window.repairThaiText(raw.trim());
          } else if (field === 'fractionName') {
            item.fractionName = window.repairThaiText(raw.trim());
          } else {
            item[field] = raw.trim();
          }
          window.revalidateAndRenderImportPreview();
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      };

      window.removeImportRow = function(rowId) {
        pendingImportData = pendingImportData.filter(r => r._rowId !== rowId);
        window.revalidateAndRenderImportPreview();
      };

      window.confirmImportData = function() {
        if (!guardOnce('confirmImportData')) return;
        const validCount = pendingImportData.filter(i => i.isValid).length;
        if (validCount === 0) return showAlert("ไม่มีรายการที่นำเข้าได้", "ทุกแถวยังมีข้อผิดพลาดอยู่ กรุณาแก้ไขหรือลบแถวที่ผิดพลาดออกก่อน", true);

        window.openManagerPinModal(() => {
          window.showCustomConfirm(
            "ยืนยันการนำเข้าข้อมูล?",
            `ระบบจะเพิ่ม/อัปเดตสินค้า ${validCount} รายการลงคลังจริงทันที (แถวที่ยังผิดพลาดจะถูกข้ามไปโดยอัตโนมัติ)`,
            () => {
              const validItems = pendingImportData.filter(i => i.isValid);
              const mainItems = validItems.filter(i => i.rowType !== 'FRACTION');
              const fractionItems = validItems.filter(i => i.rowType === 'FRACTION');
              let importedFractionCount = 0;

              // PASS 1: สร้าง/อัปเดตสินค้าและขนาดหลักก่อน (เหมือนเดิมทุกประการ)
              mainItems.forEach(item => {
                let barcode = item.barcode;
                if (!barcode) {
                  barcode = 'AUTO-' + (db.counters.barcode++);
                } else {
                  const barcodeNumber = parseInt(barcode);
                  if (!isNaN(barcodeNumber) && barcodeNumber >= db.counters.barcode) {
                    db.counters.barcode = barcodeNumber + 1;
                  }
                }

                // Resolve the row's category name to an existing category (case-insensitive
                // match), or create a new one on the fly — hardware-store catalogs from a
                // supplier commonly introduce categories the store hasn't set up yet.
                let categoryName = 'งานทั่วไป';
                if (item.category) {
                  const existingCat = db.categories.find(c => c.name.toLowerCase() === item.category.toLowerCase());
                  if (existingCat) {
                    categoryName = existingCat.name;
                  } else {
                    categoryName = item.category;
                    db.counters.category++;
                    db.categories.push({ id: 'CAT-' + String(db.counters.category).padStart(2, '0'), name: categoryName, icon: '📦', color: '#6366f1' });
                  }
                }

                // Match by name across ALL products, including ones currently suspended
                // (isDeleted) — otherwise re-importing a discontinued item's stock file
                // would create a second, separate product record with the same name
                // instead of reviving the original one.
                let existingProduct = Object.values(db.products).find(p => p.name.toLowerCase() === item.name.toLowerCase());

                if (existingProduct) {
                  if (existingProduct.isDeleted) existingProduct.isDeleted = false;
                  if (!Array.isArray(existingProduct.cat)) existingProduct.cat = [];
                  if (item.category && !existingProduct.cat.some(c => c.toLowerCase() === categoryName.toLowerCase())) {
                    existingProduct.cat.push(categoryName);
                  }
                  // อัปเดตกลุ่มสินค้าเฉพาะเมื่อไฟล์ระบุค่ามาจริงๆ (ไม่เขียนทับด้วยค่าว่างถ้าช่องนี้ไม่ได้กรอก
                  // ในไฟล์ที่นำเข้า เพื่อไม่ให้การนำเข้าซ้ำไปลบการจัดกลุ่มที่ตั้งไว้ในระบบโดยไม่ตั้งใจ)
                  if (item.groupName) existingProduct.groupName = item.groupName;
                  const existingV = existingProduct.variants.find(v => v.sizeName === item.sizeName || (barcode && v.barcode === barcode));
                  if (existingV) {
                    existingV.cost = item.cost;
                    existingV.price = item.price;
                    existingV.stock = roundStock(item.stock);
                    existingV.minStock = item.minStock;
                    if (barcode) existingV.barcode = barcode;
                    if (!Array.isArray(existingV.fractions)) existingV.fractions = [];
                  } else {
                    existingProduct.variants.push({
                      id: 'V-' + generateID(), sizeName: item.sizeName, barcode: barcode,
                      cost: item.cost, price: item.price, stock: roundStock(item.stock), minStock: item.minStock, fractions: []
                    });
                  }
                } else {
                  db.products[item.id] = {
                    id: item.id, name: item.name, cat: [categoryName], groupName: item.groupName || '', image: "📦", isDeleted: false, variants: [
                      { id: 'V-' + generateID(), sizeName: item.sizeName, barcode: barcode, cost: item.cost, price: item.price, stock: roundStock(item.stock), minStock: item.minStock, fractions: [] }
                    ]
                  };
                }
              });

              // PASS 2: แนบตัวเลือกแบ่งขายเข้ากับขนาดหลักที่ตรงกัน (ชื่อสินค้า + ขนาด) —
              // รันหลัง PASS 1 เสมอ เพื่อให้ขนาดหลักที่เพิ่งสร้าง/อัปเดตในไฟล์เดียวกันมีอยู่แล้ว
              fractionItems.forEach(item => {
                const product = Object.values(db.products).find(p => p.name.toLowerCase() === item.name.toLowerCase());
                const variant = product ? product.variants.find(v => v.sizeName === item.sizeName) : null;
                if (!product || !variant) return; // ป้องกันพลาด แม้ revalidate ควรกรองออกไปแล้วก็ตาม
                if (!Array.isArray(variant.fractions)) variant.fractions = [];

                const existingFraction = variant.fractions.find(f => f.fractionName.toLowerCase() === item.fractionName.toLowerCase());
                if (existingFraction) {
                  existingFraction.fractionMultiplier = item.fractionMultiplier;
                  existingFraction.fractionPrice = item.price;
                } else {
                  variant.fractions.push({
                    id: 'F-' + generateID(),
                    fractionName: item.fractionName,
                    fractionMultiplier: item.fractionMultiplier,
                    fractionPrice: item.price
                  });
                }
                importedFractionCount++;
              });


              persist(); renderSaleHome(); window.renderStock(); closeModal('modal-command');
              logTransaction('PRODUCT_IMPORT', { importedCount: validCount, mainCount: mainItems.length, fractionCount: importedFractionCount, skippedCount: pendingImportData.length - validCount });
              showToast(`นำเข้าข้อมูลสินค้าสำเร็จ ${mainItems.length} ขนาด${importedFractionCount > 0 ? ` + ${importedFractionCount} ตัวเลือกแบ่งขาย` : ''}`);
            }
          );
        });
      };

      window.selectOnlyValidImports = function() {
        pendingImportData = pendingImportData.filter(item => item.isValid);
        showToast("คัดเอาแถวที่ผิดพลาดออกเรียบร้อย");
        window.revalidateAndRenderImportPreview();
      };

      // ==========================================
      // ==========================================
      // USER MANAGEMENT (individual login credentials per person, on top of
      // the shared store PIN — for attributing who did what, and for a family
      // business wanting each member to have their own PIN instead of one
      // shared code)
      // ==========================================
      function renderUserManagerList() {
        const container = document.getElementById('user-manager-list');
        if (!db.users || db.users.length === 0) {
          container.innerHTML = '<p class="text-center text-slate-400 p-6 text-xs">ยังไม่มีผู้ใช้งานเพิ่มเติม — ใช้ PIN หลักของร้านได้ตามปกติ</p>';
          return;
        }
        container.innerHTML = db.users.map(u => `
          <div class="bg-white p-3 rounded-xl border flex justify-between items-center text-xs text-slate-800">
            <div>
              <b>${escapeHTML(u.name)}</b>
              <p class="text-[10px] text-slate-400">👤 เพิ่มเมื่อ ${new Date(u.createdAt).toLocaleDateString('th-TH')}</p>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button onclick="window.openUserForm('${escapeHTML(u.id)}')" class="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg font-bold text-[10px] btn-touch">แก้ไข</button>
              <button onclick="window.deleteUser('${escapeHTML(u.id)}')" class="px-2 py-1 bg-rose-50 text-rose-600 rounded-lg font-bold text-[10px] btn-touch">ลบ</button>
            </div>
          </div>`).join('');
      }

      window.openUserManagerModal = function() {
        window.openManagerPinModal(() => {
          renderUserManagerList();
          window.openUserForm(null);
          document.getElementById('modal-user-manager').classList.remove('hidden');
          document.getElementById('modal-user-manager').classList.add('flex');
        });
      };

      window.openUserForm = function(id) {
        document.getElementById('edit-user-id').value = id || '';
        document.getElementById('user-pin').value = '';
        if (id && db.users) {
          const u = db.users.find(x => x.id === id);
          if (u) {
            document.getElementById('user-form-title').innerText = 'แก้ไขผู้ใช้งาน';
            document.getElementById('user-name').value = u.name;
            document.getElementById('user-pin').placeholder = 'เว้นว่างไว้ถ้าไม่เปลี่ยน PIN';
            return;
          }
        }
        document.getElementById('user-form-title').innerText = 'เพิ่มผู้ใช้งานใหม่';
        document.getElementById('user-name').value = '';
        document.getElementById('user-pin').placeholder = 'PIN 4 หลัก';
      };

      window.saveUser = async function() {
        if (!guardOnce('saveUser')) return;
        const id = document.getElementById('edit-user-id').value;
        const name = document.getElementById('user-name').value.trim();
        const pin = document.getElementById('user-pin').value.trim();

        if (!name) return showAlert('ข้อมูลไม่ครบ', 'กรุณาระบุชื่อผู้ใช้งาน', true);
        if (!id && !/^\d{4}$/.test(pin)) return showAlert('PIN ไม่ถูกต้อง', 'กรุณาระบุ PIN 4 หลัก (ตัวเลขเท่านั้น) สำหรับผู้ใช้งานใหม่', true);
        if (pin && !/^\d{4}$/.test(pin)) return showAlert('PIN ไม่ถูกต้อง', 'PIN ต้องเป็นตัวเลข 4 หลักเท่านั้น', true);

        if (!db.users) db.users = [];
        const isNew = !id;

        // ทุกคนที่เพิ่มในหน้านี้เป็น "staff" เสมอ — เจ้าของร้านคือคนที่ถือ PIN หลักของร้าน
        // (ตั้งที่ ⚙️ ตั้งค่า > เปลี่ยนรหัส PIN) อยู่แล้วโดยไม่ต้องมีบทบาทซ้ำซ้อนในนี้
        if (isNew) {
          const salt = generatePinSalt();
          const hash = await hashPIN(pin, salt);
          db.users.push({
            id: 'U-' + generateID(), name, role: 'staff',
            pinHash: hash, pinSalt: salt,
            createdAt: new Date().toISOString()
          });
        } else {
          const u = db.users.find(x => x.id === id);
          if (!u) return;
          u.name = name;
          if (pin) {
            u.pinSalt = generatePinSalt();
            u.pinHash = await hashPIN(pin, u.pinSalt);
          }
        }

        persist();
        logTransaction(isNew ? 'USER_CREATE' : 'USER_EDIT', { name });
        renderUserManagerList();
        window.openUserForm(null);
        showToast('บันทึกข้อมูลผู้ใช้งานสำเร็จ');
      };

      window.deleteUser = function(id) {
        if (!guardOnce('deleteUser')) return;
        const u = db.users.find(x => x.id === id);
        if (!u) return;
        window.showCustomConfirm(
          `ลบผู้ใช้งาน "${u.name}"?`,
          'ประวัติการทำรายการเดิมของผู้ใช้งานนี้จะยังคงอยู่ในระบบ (แสดงชื่อเดิมไว้) แต่จะเข้าสู่ระบบด้วย PIN นี้ไม่ได้อีกต่อไป',
          () => {
            db.users = db.users.filter(x => x.id !== id);
            persist();
            logTransaction('USER_DELETE', { userId: id, name: u.name });
            renderUserManagerList();
            showToast('ลบผู้ใช้งานสำเร็จ');
          }
        );
      };

      // ==========================================
      // SETTINGS & PIN MANAGEMENT
      // ==========================================
      window.openSettingsModal = function() {
        document.getElementById('setting-store-name').value = db.storeName;
        document.getElementById('setting-store-address').value = db.storeAddress;
        document.getElementById('setting-promptpay-id').value = db.promptPayId;
        document.getElementById('setting-tax-name').value = db.settings.taxPayerName || "";
        document.getElementById('setting-tax-id').value = db.settings.taxPayerId || "";
        document.getElementById('setting-sheets-url').value = db.settings.googleSheetsUrl || "";
        document.getElementById('setting-mgr-session-minutes').value = String(db.settings.mgrSessionMinutes || 0);
        
        updateSheetsPendingCount();

        document.getElementById('modal-settings').classList.remove('hidden');
        document.getElementById('modal-settings').classList.add('flex');
      };

      window.saveSettings = function() {
        if (!guardOnce('saveSettings')) return;
        db.storeName = document.getElementById('setting-store-name').value;
        db.storeAddress = document.getElementById('setting-store-address').value;
        db.promptPayId = document.getElementById('setting-promptpay-id').value;
        db.settings.taxPayerName = document.getElementById('setting-tax-name').value;
        db.settings.taxPayerId = document.getElementById('setting-tax-id').value;
        db.settings.googleSheetsUrl = document.getElementById('setting-sheets-url').value.trim();
        db.settings.mgrSessionMinutes = parseInt(document.getElementById('setting-mgr-session-minutes').value) || 0;
        if (db.settings.mgrSessionMinutes === 0) window.lockManagerSessionNow();

        persist(); closeModal('modal-settings'); showToast("บันทึกการตั้งค่าสำเร็จ");
        if(activeView === 'stock') window.renderStock();
        renderAll();
      };

      window.changePinFromSettings = async function() {
        const cur = document.getElementById('setting-pin-current').value;
        const n1 = document.getElementById('setting-pin-new').value;
        const n2 = document.getElementById('setting-pin-confirm').value;
        
        const curHash = await hashPIN(cur, db.pinSalt);
        if(db.pinHash && curHash !== db.pinHash) return showAlert("ผิดพลาด", "รหัส PIN ปัจจุบันไม่ถูกต้อง", true);
        // Require exactly 4 digits (0-9 only) — the lock screen keypad can only ever type
        // digits, so a PIN containing letters/symbols would permanently lock everyone out.
        if(!/^\d{4}$/.test(n1)) return showAlert("ผิดพลาด", "PIN ใหม่ต้องเป็นตัวเลข 4 หลักเท่านั้น (0-9)", true);
        if(n1 !== n2) return showAlert("ผิดพลาด", "ยืนยันรหัส PIN ไม่ตรงกัน", true);
        
        // Always issue a fresh random salt when the PIN changes, so the stored hash can never
        // be matched against a precomputed table shared across stores/devices.
        db.pinSalt = generatePinSalt();
        db.pinHash = await hashPIN(n1, db.pinSalt);
        db.security.lockFailCount = 0; db.security.lockUntil = 0;
        db.security.mgrFailCount = 0; db.security.mgrLockUntil = 0;
        persist();
        document.getElementById('setting-pin-current').value = "";
        document.getElementById('setting-pin-new').value = "";
        document.getElementById('setting-pin-confirm').value = "";
        showToast("เปลี่ยนรหัส PIN ผู้จัดการสำเร็จ");
      };

      // ==========================================
      // BACKUP / EXPORT / RESTORE SYSTEM
      // ==========================================
      window.exportExcel = function() {
        // หัวคอลัมน์นี้ตรงกับ fieldsToMap/checkHeaderMatch ของระบบนำเข้าทุกคำ — อัปโหลดไฟล์นี้
        // กลับเข้าไปที่ "นำเข้าสินค้าด่วน" แล้วทุกคอลัมน์จะจับคู่ให้อัตโนมัติ (multi-size และ
        // สินค้าแบ่งขายจะกลับเข้าไปครบถ้วนตามเดิม ไม่ใช่แค่ขนาดหลัก)
        const rows = [[
          "ชื่อสินค้า", "ประเภทแถว", "ขนาด", "หมวดหมู่", "กลุ่มสินค้า", "บาร์โค้ด",
          "ทุน", "ราคาขาย", "สต็อก", "สต็อกขั้นต่ำ",
          "ชื่อหน่วยแบ่งขาย", "อัตราส่วนแบ่งขาย"
        ]];
        Object.values(db.products).forEach(p => {
          if (p.isDeleted) return;
          const categoryText = Array.isArray(p.cat) ? p.cat.join(', ') : (p.cat || '');
          p.variants.forEach(v => {
            rows.push([
              p.name, "ขนาดหลัก", v.sizeName, categoryText, p.groupName || '', v.barcode,
              v.cost, v.price, v.stock, v.minStock || 10,
              "", ""
            ]);
            (v.fractions || []).forEach(f => {
              rows.push([
                p.name, "แบ่งขาย", v.sizeName, "", "", "",
                "", f.fractionPrice, "", "",
                f.fractionName, f.fractionMultiplier
              ]);
            });
          });
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, "Stock");
        XLSX.writeFile(wb, "SmartPOS_Stock.xlsx");
      };

      // Shared download helper used by manual export, auto-backup, and pre-import backup.
      function downloadJSONFile(dataObj, filenamePrefix) {
        try {
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataObj));
          const a = document.createElement('a');
          a.setAttribute("href", dataStr);
          a.setAttribute("download", `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`);
          a.click();
          return true;
        } catch (e) {
          console.error("Backup download failed:", e);
          return false;
        }
      }

      // ==========================================
      // STORAGE QUOTA WARNING
      // ==========================================
      // Everything lives in the browser's IndexedDB (via localforage) on this one device.
      // Years of accumulated bills can eventually approach the browser's storage quota,
      // which would make saves start failing. Warn early so there's time to archive
      // before that happens, rather than finding out via a failed save.
      async function checkStorageQuota() {
        try {
          if (!(navigator.storage && navigator.storage.estimate)) return;
          const est = await navigator.storage.estimate();
          const banner = document.getElementById('storage-warning-banner');
          if (!banner || !est.quota || !est.usage) return;
          const pct = (est.usage / est.quota) * 100;
          if (pct >= 80) {
            const usageMB = (est.usage / (1024 * 1024)).toFixed(1);
            const quotaMB = (est.quota / (1024 * 1024)).toFixed(0);
            banner.innerText = `⚠️ พื้นที่จัดเก็บข้อมูลใช้ไปแล้ว ${pct.toFixed(0)}% (${usageMB}MB จาก ${quotaMB}MB) แนะนำให้ตรวจสอบและลดข้อมูลที่ไม่จำเป็นเพื่อคืนพื้นที่`;
            banner.classList.remove('hidden');
          } else {
            banner.classList.add('hidden');
          }
        } catch (e) {
          console.error("Storage quota check failed:", e);
        }
      }

      // ==========================================
      // AUTOMATIC BACKUP
      // ==========================================
      const AUTO_BACKUP_DATE_KEY = 'POS_LAST_AUTO_BACKUP_DATE';
      // Runs once per calendar day (checked at app startup) so a backup file downloads
      // automatically without anyone having to remember to press "Backup" — covers stores
      // that stay open continuously or where a shift is never formally closed.
      async function runDailyAutoBackupIfNeeded() {
        try {
          const todayStr = new Date().toISOString().slice(0, 10);
          const lastBackupDate = await localforage.getItem(AUTO_BACKUP_DATE_KEY);
          if (lastBackupDate === todayStr) return;
          downloadJSONFile(db, "AutoBackup_Daily");
          await localforage.setItem(AUTO_BACKUP_DATE_KEY, todayStr);
          await markBackupCompleted();
          showToast("ระบบสำรองข้อมูลประจำวันอัตโนมัติแล้ว (ไฟล์ AutoBackup_Daily ในโฟลเดอร์ดาวน์โหลด)");
        } catch (e) {
          console.error("Daily auto backup failed:", e);
        }
      }
      // Also triggered right when a shift/store is closed for the day (see
      // closeShiftProcess), so the backup naturally lines up with end-of-day, and marks
      // today's date as already backed up so the startup check above won't duplicate it.
      async function runAutoBackupNow(filenamePrefix) {
        try {
          downloadJSONFile(db, filenamePrefix || "AutoBackup_ShiftClose");
          await localforage.setItem(AUTO_BACKUP_DATE_KEY, new Date().toISOString().slice(0, 10));
          await markBackupCompleted();
        } catch (e) {
          console.error("Auto backup on shift close failed:", e);
        }
      }

// ==========================================
// DATABASE VALIDATOR
// ==========================================
// Pure, side-effect-free checks of the in-memory db object's structure and
// referential integrity. Used at startup (before rendering anything), before
// restoring a backup, and on demand from the DB Health admin panel.
//
// validateDatabase() never modifies db — see autoRepair.js for the module
// that actually fixes problems this finds.


function typeOf(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

/**
 * @param {object} db
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function validateDatabase(db) {
  const errors = [];
  const warnings = [];

  if (!db || typeof db !== 'object') {
    return { valid: false, errors: ['ฐานข้อมูลว่างเปล่าหรือไม่ใช่ object'], warnings };
  }

  // --- 1. Top-level shape & types ---
  for (const [key, expectedType] of Object.entries(DB_TOP_LEVEL_TYPES)) {
    if (!(key in db)) {
      errors.push(`ขาดฟิลด์หลัก: "${key}"`);
      continue;
    }
    const actual = typeOf(db[key]);
    if (actual !== expectedType) {
      errors.push(`ฟิลด์ "${key}" ควรเป็น ${expectedType} แต่พบ ${actual}`);
    }
  }

  if (typeOf(db.products) !== 'object' || typeOf(db.customers) !== 'object' || typeOf(db.categories) !== 'array') {
    // Can't safely run the referential checks below without these — bail early.
    return { valid: errors.length === 0, errors, warnings };
  }

  const categoryNames = new Set((db.categories || []).map(c => c.name));
  const productIds = new Set(Object.keys(db.products || {}));
  const variantIds = new Set();
  const barcodeSeen = new Map();

  // --- 2. Products / variants / fractions ---
  for (const [pid, p] of Object.entries(db.products || {})) {
    if (pid !== p.id) errors.push(`สินค้า key "${pid}" กับ id ภายใน "${p.id}" ไม่ตรงกัน`);
    if (!p.name) warnings.push(`สินค้า ${pid} ไม่มีชื่อ`);
    if (!Array.isArray(p.variants)) {
      errors.push(`สินค้า ${pid} ไม่มี variants เป็น array`);
      continue;
    }
    if (p.variants.length === 0) warnings.push(`สินค้า ${pid} (${p.name || '-'}) ไม่มีหน่วยสินค้า (variant) เลย`);
    (p.cat || []).forEach(catName => {
      if (!categoryNames.has(catName)) warnings.push(`สินค้า ${pid} อ้างอิงหมวดหมู่ "${catName}" ที่ไม่มีอยู่จริง`);
    });
    p.variants.forEach(v => {
      variantIds.add(v.id);
      if (typeof v.stock !== 'number' || isNaN(v.stock)) errors.push(`variant ${v.id} (${pid}) มี stock ไม่ใช่ตัวเลข`);
      else if (v.stock < 0) warnings.push(`variant ${v.id} (${pid}) มี stock ติดลบ (${v.stock})`);
      if (typeof v.price !== 'number' || isNaN(v.price)) errors.push(`variant ${v.id} (${pid}) มี price ไม่ใช่ตัวเลข`);
      if (typeof v.cost !== 'number' || isNaN(v.cost)) warnings.push(`variant ${v.id} (${pid}) มี cost ไม่ใช่ตัวเลข`);
      if (v.barcode) {
        if (barcodeSeen.has(v.barcode)) {
          errors.push(`บาร์โค้ด "${v.barcode}" ซ้ำกันระหว่าง variant ${barcodeSeen.get(v.barcode)} และ ${v.id}`);
        } else {
          barcodeSeen.set(v.barcode, v.id);
        }
      }
      (v.fractions || []).forEach(f => {
        if (typeof f.fractionMultiplier !== 'number' || f.fractionMultiplier <= 0) {
          errors.push(`หน่วยย่อย ${f.id} ของ variant ${v.id} มี fractionMultiplier ไม่ถูกต้อง`);
        }
      });
    });
  }

  // --- 3. Categories ---
  const catIdSeen = new Set();
  (db.categories || []).forEach(c => {
    if (catIdSeen.has(c.id)) errors.push(`หมวดหมู่ id "${c.id}" ซ้ำ`);
    catIdSeen.add(c.id);
    if (!c.name) warnings.push(`หมวดหมู่ ${c.id} ไม่มีชื่อ`);
  });

  // --- 4. Customers ---
  for (const [cid, c] of Object.entries(db.customers || {})) {
    if (cid !== c.id) errors.push(`ลูกค้า key "${cid}" กับ id ภายใน "${c.id}" ไม่ตรงกัน`);
    if (typeof c.debt !== 'number' || isNaN(c.debt)) errors.push(`ลูกค้า ${cid} มี debt ไม่ใช่ตัวเลข`);
    else if (c.debt < 0) warnings.push(`ลูกค้า ${cid} มียอดหนี้ติดลบ (${c.debt})`);
  }

  // --- 5. Bills reference existing products/customers ---
  if (Array.isArray(db.bills)) {
    db.bills.forEach(b => {
      if (b.customerId && !db.customers[b.customerId]) {
        warnings.push(`บิล ${b.id || '(ไม่มี id)'} อ้างอิงลูกค้า "${b.customerId}" ที่ไม่มีอยู่จริง`);
      }
      (b.items || []).forEach(item => {
        if (item.productId && !productIds.has(item.productId)) {
          warnings.push(`บิล ${b.id || '(ไม่มี id)'} มีรายการอ้างอิงสินค้า "${item.productId}" ที่ไม่มีอยู่จริง (อาจถูกลบไปแล้ว)`);
        }
      });
    });
  }

  // --- 6. Counters sanity ---
  if (db.counters && typeof db.counters === 'object') {
    ['product', 'customer', 'category', 'po', 'barcode', 'variant'].forEach(k => {
      if (typeof db.counters[k] !== 'number') warnings.push(`counters.${k} ไม่ใช่ตัวเลข`);
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

window.validateDatabase = validateDatabase;


// ============ FROM: Smart-pos-pro-v9-modular/js/db/health.js ============
// ==========================================
// DATABASE HEALTH
// ==========================================
// Turns validateDatabase()'s raw errors/warnings plus a few operational
// signals (storage quota, last backup date, log size) into a single 0-100
// health score and a human-readable report, for the admin "DB Health" panel.


const LAST_HEALTH_CHECK_KEY = "smart_pos_pro_v620_last_health_check";
const LAST_BACKUP_KEY = "smart_pos_pro_v620_last_backup_at";

/**
 * @param {object} db
 * @returns {Promise<{score:number, grade:string, errors:string[], warnings:string[], stats:object}>}
 */
async function checkDatabaseHealth(db) {
  const { valid, errors, warnings } = validateDatabase(db);

  let score = 100;
  score -= errors.length * 12;   // structural errors are serious
  score -= warnings.length * 3;  // warnings are minor deductions
  score = Math.max(0, Math.min(100, score));

  // Storage quota
  let quotaUsedPct = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota) quotaUsedPct = Math.round((est.usage / est.quota) * 1000) / 10;
    }
  } catch (e) { /* not fatal — some browsers don't support this */ }
  if (quotaUsedPct !== null && quotaUsedPct > 85) {
    warnings.push(`พื้นที่จัดเก็บของเบราว์เซอร์ใกล้เต็ม (ใช้ไปแล้ว ${quotaUsedPct}%)`);
    score -= 10;
  }

  // Last backup recency
  let lastBackupAt = null;
  try { lastBackupAt = await localforage.getItem(LAST_BACKUP_KEY); } catch (e) {}
  let daysSinceBackup = null;
  if (lastBackupAt) {
    daysSinceBackup = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000);
    if (daysSinceBackup > 7) {
      warnings.push(`ไม่ได้สำรองข้อมูลมา ${daysSinceBackup} วันแล้ว`);
      score -= 5;
    }
  } else {
    warnings.push('ยังไม่เคยสำรองข้อมูล (backup) เลย');
    score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 50 ? 'C' : score >= 25 ? 'D' : 'F';

  const auditLogCount = await getAuditLogCount().catch(() => 0);

  const stats = {
    productCount: Object.keys(db.products || {}).length,
    customerCount: Object.keys(db.customers || {}).length,
    billCount: (db.bills || []).length,
    categoryCount: (db.categories || []).length,
    quotaUsedPct,
    lastBackupAt,
    daysSinceBackup,
    auditLogCount,
    schemaVersion: db.schemaVersion || 0
  };

  const report = { valid, score, grade, errors, warnings, stats, checkedAt: new Date().toISOString() };

  try { await localforage.setItem(LAST_HEALTH_CHECK_KEY, report.checkedAt); } catch (e) {}

  return report;
}

/** Call whenever a manual/auto backup succeeds, so health checks know backup recency. */
async function markBackupCompleted() {
  try { await localforage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch (e) {}
}

window.checkDatabaseHealth = checkDatabaseHealth;
window.markBackupCompleted = markBackupCompleted;


// ============ FROM: Smart-pos-pro-v9-modular/js/db/auditLog.js ============
// ==========================================
// TRANSACTION / AUDIT LOG
// ==========================================
// An append-only record of every business-critical action (sale, refund,
// stock adjustment, debt payment, PO receipt, product/price edits, settings
// changes, manual repairs, restores, ...). Stored under its OWN localforage
// key (not inside the main db object) so that:
//   1) restoring/importing a database backup can never wipe out history of
//      what happened before the restore, and
//   2) the frequently-saved main db object doesn't grow unbounded with log
//      entries, which would slow down every autosave.
//
// Entries are capped (see MAX_ENTRIES) with the oldest entries trimmed off
// first — this is a POS running in a single browser tab, not a general
// ledger, so unbounded growth would eventually blow the storage quota.

const AUDIT_LOG_KEY = "smart_pos_pro_v620_audit_log";
const MAX_ENTRIES = 5000;

let cachedLog = null; // in-memory cache, hydrated on first use

async function loadLog() {
  if (cachedLog) return cachedLog;
  try {
    const raw = await localforage.getItem(AUDIT_LOG_KEY);
    cachedLog = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.error("Audit log load failed:", e);
    cachedLog = [];
  }
  return cachedLog;
}

async function saveLog() {
  try {
    await localforage.setItem(AUDIT_LOG_KEY, cachedLog);
  } catch (e) {
    // The audit log is diagnostic/history data — losing a write to it should
    // never block or corrupt the actual POS transaction that triggered it.
    console.error("Audit log save failed:", e);
  }
}

/**
 * Records one entry in the transaction/audit log.
 * @param {string} action   short machine key, e.g. "SALE", "REFUND", "STOCK_ADJUST",
 *                           "DEBT_PAYMENT", "PO_RECEIVE", "PRODUCT_EDIT", "SETTINGS_EDIT",
 *                           "AUTO_REPAIR", "DB_RESTORE", "DB_RESET"
 * @param {object} details  free-form metadata about the action (ids, amounts, before/after)
 * @param {object} [opts]
 * @param {string} [opts.actor]  who performed it (device id / "manager" / "system")
 */
async function logTransaction(action, details = {}, opts = {}) {
  const log = await loadLog();
  const entry = {
    id: 'AL' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase(),
    ts: new Date().toISOString(),
    action,
    actor: opts.actor || currentUserName || (window.__deviceId || 'unknown'),
    details
  };
  log.push(entry);
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
  await saveLog();
  return entry;
}

/** Returns log entries, most recent first. Optionally filtered by action or date range. */
async function getAuditLog({ action = null, since = null, limit = 200 } = {}) {
  const log = await loadLog();
  let out = log.slice().reverse();
  if (action) out = out.filter(e => e.action === action);
  if (since) out = out.filter(e => new Date(e.ts) >= new Date(since));
  return out.slice(0, limit);
}

/** Total entry count — used by the DB Health panel. */
async function getAuditLogCount() {
  const log = await loadLog();
  return log.length;
}

/** Exports the full audit log as a downloadable JSON blob (for accountants / disputes). */
async function exportAuditLog() {
  const log = await loadLog();
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Clears the audit log. Only ever called explicitly by a manager from the admin panel. */
async function clearAuditLog() {
  cachedLog = [];
  await saveLog();
}

window.logTransaction = logTransaction;
window.getAuditLog = getAuditLog;
window.exportAuditLog = exportAuditLog;


// ============ FROM: Smart-pos-pro-v9-modular/js/db/autoRepair.js ============
// ==========================================
// DATABASE AUTO REPAIR
// ==========================================
// Fixes the class of problems that are safe to fix automatically without
// human judgement: missing arrays/objects reset to empty, missing fields
// filled from defaults, negative stock clamped to 0, orphaned category
// references dropped, duplicate top-level ids de-duplicated. Never deletes
// bills/customers/products — only ever repairs *shape*, never business data,
// and every fix taken is recorded so it's auditable.
//
// Anything it can't safely fix on its own (e.g. a bill referencing a genuinely
// deleted product — that's just history, and is left alone) is left for a
// human to review in the DB Health panel.


/**
 * Mutates `db` in place, fixing what it safely can.
 * @param {object} db
 * @returns {{fixes: string[], remaining: {errors:string[], warnings:string[]}}}
 */
function repairDatabase(db) {
  const fixes = [];

  // 1. Missing/wrong-typed top-level fields → reset to default shape.
  for (const [key, expectedType] of Object.entries(DB_TOP_LEVEL_TYPES)) {
    const actual = Array.isArray(db[key]) ? 'array' : (db[key] === null ? 'null' : typeof db[key]);
    if (!(key in db) || actual !== expectedType) {
      db[key] = JSON.parse(JSON.stringify(DB_DEFAULT[key] ?? (expectedType === 'array' ? [] : expectedType === 'object' ? {} : '')));
      fixes.push(`ตั้งค่าฟิลด์ "${key}" ใหม่เป็นค่าเริ่มต้น (เดิมหายไปหรือชนิดข้อมูลผิด)`);
    }
  }
  db.settings = { ...DB_DEFAULT.settings, ...(db.settings || {}) };
  db.counters = { ...DB_DEFAULT.counters, ...(db.counters || {}) };
  db.security = { ...DB_DEFAULT.security, ...(db.security || {}) };

  // 2. Products / variants
  const seenBarcodes = new Set();
  Object.entries(db.products || {}).forEach(([pid, p]) => {
    if (p.id !== pid) { p.id = pid; fixes.push(`แก้ไข id ภายในของสินค้า ${pid} ให้ตรงกับ key`); }
    if (!Array.isArray(p.variants)) { p.variants = []; fixes.push(`สินค้า ${pid} ไม่มี variants → ตั้งเป็น array ว่าง`); }
    if (!Array.isArray(p.cat)) { p.cat = []; fixes.push(`สินค้า ${pid} มี cat ผิดชนิด → ตั้งเป็น array ว่าง`); }
    p.variants.forEach(v => {
      if (typeof v.stock !== 'number' || isNaN(v.stock)) { v.stock = 0; fixes.push(`variant ${v.id} มี stock ผิดพลาด → ตั้งเป็น 0`); }
      else if (v.stock < 0) { v.stock = 0; fixes.push(`variant ${v.id} มี stock ติดลบ → ปรับเป็น 0`); }
      if (typeof v.price !== 'number' || isNaN(v.price)) { v.price = 0; fixes.push(`variant ${v.id} มี price ผิดพลาด → ตั้งเป็น 0`); }
      if (typeof v.cost !== 'number' || isNaN(v.cost)) { v.cost = 0; fixes.push(`variant ${v.id} มี cost ผิดพลาด → ตั้งเป็น 0`); }
      if (v.minStock === undefined) v.minStock = 10;
      if (!Array.isArray(v.fractions)) { v.fractions = []; fixes.push(`variant ${v.id} มี fractions ผิดชนิด → ตั้งเป็น array ว่าง`); }
      if (v.barcode) {
        if (seenBarcodes.has(v.barcode)) {
          const oldBarcode = v.barcode;
          v.barcode = oldBarcode + '-DUP-' + v.id;
          fixes.push(`บาร์โค้ดซ้ำ "${oldBarcode}" ที่ variant ${v.id} → เปลี่ยนเป็น "${v.barcode}" ชั่วคราว (โปรดตรวจสอบ)`);
        } else {
          seenBarcodes.add(v.barcode);
        }
      }
    });
  });

  // 3. Categories — drop exact-duplicate ids, keep first occurrence.
  const seenCatIds = new Set();
  const dedupedCats = [];
  (db.categories || []).forEach(c => {
    if (seenCatIds.has(c.id)) { fixes.push(`ลบหมวดหมู่ id "${c.id}" ที่ซ้ำกัน`); return; }
    seenCatIds.add(c.id);
    dedupedCats.push(c);
  });
  db.categories = dedupedCats;

  // 4. Customers
  Object.entries(db.customers || {}).forEach(([cid, c]) => {
    if (c.id !== cid) { c.id = cid; fixes.push(`แก้ไข id ภายในของลูกค้า ${cid} ให้ตรงกับ key`); }
    if (typeof c.debt !== 'number' || isNaN(c.debt)) { c.debt = 0; fixes.push(`ลูกค้า ${cid} มียอดหนี้ผิดพลาด → ตั้งเป็น 0`); }
  });

  const remaining = validateDatabase(db);
  return { fixes, remaining };
}

/**
 * Runs the validator; if it finds errors, repairs and logs what changed.
 * Safe to call on every startup — it's a no-op (besides the validation
 * pass) when the database is already healthy.
 */
async function autoRepairIfNeeded(db) {
  const before = validateDatabase(db);
  if (before.valid) return { ran: false, fixes: [], before, after: before };

  const { fixes, remaining } = repairDatabase(db);
  await logTransaction('AUTO_REPAIR', { beforeErrors: before.errors, fixes, remainingErrors: remaining.errors });
  return { ran: true, fixes, before, after: remaining };
}

window.repairDatabase = repairDatabase;
window.autoRepairIfNeeded = autoRepairIfNeeded;


// ============ FROM: Smart-pos-pro-v9-modular/js/db/versioning.js ============
// ==========================================
// DATABASE VERSIONING / MIGRATIONS
// ==========================================
// Every db object now carries a `schemaVersion` number. On load, we walk
// forward from whatever version the saved data is at, applying one
// migration function per step, until we reach SCHEMA_VERSION. This replaces
// the old approach of scattering one-off "if (!db.foo) db.foo = ..." patches
// through the init code — new migrations are added here, in one place, and
// every migration that ever ran is recorded to the audit log.
//
// HOW TO ADD A NEW MIGRATION:
//   1. Bump SCHEMA_VERSION in db/schema.js by 1.
//   2. Add a new entry to MIGRATIONS below keyed by the OLD version number
//      (i.e. the migration that turns a v1 db into a v2 db is keyed `1`).
//   3. The migrate(db) function mutates db in place and doesn't need to set
//      schemaVersion itself — the runner does that.


const MIGRATIONS = {
  // Example shape for the future:
  // 1: {
  //   description: "เพิ่มฟิลด์ suppliers[].terms",
  //   migrate(db) { ... }
  // },
};

/**
 * Applies any pending migrations to `db` in place.
 * @returns {Promise<{migrated: boolean, fromVersion: number, toVersion: number, steps: string[]}>}
 */
async function runMigrations(db) {
  const fromVersion = typeof db.schemaVersion === 'number' ? db.schemaVersion : 0;
  const steps = [];
  let v = fromVersion;

  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (step) {
      step.migrate(db);
      steps.push(`v${v} → v${v + 1}: ${step.description}`);
    }
    v++;
  }

  db.schemaVersion = SCHEMA_VERSION;

  if (steps.length > 0) {
    await logTransaction('DB_MIGRATION', { fromVersion, toVersion: SCHEMA_VERSION, steps });
  }

  return { migrated: steps.length > 0, fromVersion, toVersion: SCHEMA_VERSION, steps };
}

window.runMigrations = runMigrations;


// ============ FROM: Smart-pos-pro-v9-modular/js/db/adminPanel.js ============
// ==========================================
// DB HEALTH / AUDIT LOG — ADMIN PANEL UI
// ==========================================
// Thin UI layer over db/health.js, db/validator.js, db/autoRepair.js and
// db/auditLog.js. Opened from ⚙️ ตั้งค่า > 🩺 เปิดแผงควบคุมฐานข้อมูล.


const ACTION_LABELS = {
  SALE: '🛒 ขายสินค้า',
  REFUND: '↩️ คืนสินค้า/เงิน',
  STOCK_ADJUST: '⚖️ ปรับสต็อก',
  DEBT_PAYMENT: '💵 รับชำระหนี้',
  PO_RECEIVE: '📦 รับของเข้าสต็อก',
  SUPPLIER_PAYMENT: '🤝 จ่ายเงินเจ้าหนี้',
  AUTO_REPAIR: '🔧 ซ่อมแซมอัตโนมัติ',
  DB_MIGRATION: '🗂️ อัปเดตโครงสร้างข้อมูล',
  DB_RESTORE: '📥 กู้คืนฐานข้อมูล'
};

function scoreColor(score) {
  if (score >= 90) return 'text-emerald-600';
  if (score >= 75) return 'text-lime-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-rose-600';
}

async function renderDbHealthPanel() {
  const el = document.getElementById('db-health-content');
  el.innerHTML = `<p class="text-center text-slate-400 py-8">กำลังตรวจสอบ...</p>`;

  const report = await checkDatabaseHealth(db);

  const errorsHTML = report.errors.length
    ? `<ul class="list-disc list-inside space-y-1 text-rose-700">${report.errors.map(e => `<li>${escapeHTML(e)}</li>`).join('')}</ul>`
    : `<p class="text-emerald-600">✓ ไม่พบข้อผิดพลาดเชิงโครงสร้าง</p>`;

  const warningsHTML = report.warnings.length
    ? `<ul class="list-disc list-inside space-y-1 text-amber-700">${report.warnings.map(w => `<li>${escapeHTML(w)}</li>`).join('')}</ul>`
    : `<p class="text-emerald-600">✓ ไม่พบคำเตือน</p>`;

  el.innerHTML = `
    <div class="flex items-center justify-between bg-slate-50 rounded-2xl p-4 border">
      <div>
        <div class="text-[10px] text-slate-400 font-bold">คะแนนสุขภาพฐานข้อมูล</div>
        <div class="text-3xl font-bold ${scoreColor(report.score)}">${report.score}/100 <span class="text-lg">(${report.grade})</span></div>
      </div>
      <div class="text-right text-[10px] text-slate-500 leading-relaxed">
        <div>สินค้า: ${report.stats.productCount} รายการ</div>
        <div>ลูกค้า: ${report.stats.customerCount} ราย</div>
        <div>บิล: ${report.stats.billCount} ใบ</div>
        <div>เวอร์ชันโครงสร้าง: v${report.stats.schemaVersion}</div>
      </div>
    </div>

    <div class="bg-white rounded-2xl border p-3">
      <div class="text-[10px] text-slate-500 mb-1">พื้นที่จัดเก็บที่ใช้ไป</div>
      <div class="font-bold">${report.stats.quotaUsedPct !== null ? report.stats.quotaUsedPct + '%' : 'ไม่สามารถตรวจสอบได้'}</div>
    </div>
    <div class="bg-white rounded-2xl border p-3">
      <div class="text-[10px] text-slate-500 mb-1">สำรองข้อมูลล่าสุด</div>
      <div class="font-bold">${report.stats.daysSinceBackup === null ? 'ยังไม่เคยสำรองข้อมูล' : (report.stats.daysSinceBackup === 0 ? 'วันนี้' : report.stats.daysSinceBackup + ' วันที่แล้ว')}</div>
    </div>

    <div>
      <div class="text-xs font-bold text-rose-700 mb-1">❌ ข้อผิดพลาด (${report.errors.length})</div>
      ${errorsHTML}
    </div>
    <div>
      <div class="text-xs font-bold text-amber-700 mb-1">⚠️ คำเตือน (${report.warnings.length})</div>
      ${warningsHTML}
    </div>

    <div class="flex gap-2 pt-2">
      <button onclick="window.runAutoRepairFromPanel()" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs btn-touch">🔧 ซ่อมแซมอัตโนมัติ</button>
      <button onclick="window.openAuditLogModal()" class="flex-1 py-2.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-bold text-xs btn-touch">📜 ดู Audit Log</button>
    </div>
  `;
}

window.openDbHealthModal = function () {
  document.getElementById('modal-db-health').classList.remove('hidden');
  document.getElementById('modal-db-health').classList.add('flex');
  renderDbHealthPanel();
};

window.runAutoRepairFromPanel = function () {
  window.openManagerPinModal(() => {
    window.showCustomConfirm(
      'ซ่อมแซมฐานข้อมูลอัตโนมัติ?',
      'ระบบจะแก้ไขปัญหาโครงสร้างข้อมูลที่ปลอดภัยต่อการแก้ไขอัตโนมัติ (เช่น ฟิลด์หาย สต็อกติดลบ บาร์โค้ดซ้ำ) การเปลี่ยนแปลงทั้งหมดจะถูกบันทึกลง audit log',
      async () => {
        const result = await autoRepairIfNeeded(db);
        if (result.ran) {
          persist();
          showToast(`ซ่อมแซมสำเร็จ ${result.fixes.length} รายการ`);
        } else {
          showToast('ไม่พบปัญหาที่ต้องซ่อมแซม');
        }
        renderDbHealthPanel();
      }
    );
  });
};

async function renderAuditLogList() {
  const listEl = document.getElementById('audit-log-list');
  listEl.innerHTML = `<p class="text-center text-slate-400 py-6">กำลังโหลด...</p>`;
  const entries = await getAuditLog({ limit: 200 });
  if (entries.length === 0) {
    listEl.innerHTML = `<p class="text-center text-slate-400 py-6">ยังไม่มีประวัติการทำรายการ</p>`;
    return;
  }
  listEl.innerHTML = entries.map(e => {
    const label = ACTION_LABELS[e.action] || e.action;
    const time = new Date(e.ts).toLocaleString('th-TH');
    const detailStr = escapeHTML(JSON.stringify(e.details));
    return `
      <div class="bg-slate-50 rounded-xl p-3 border">
        <div class="flex justify-between items-start">
          <span class="font-bold">${label}</span>
          <span class="text-slate-400 text-[10px]">${time}</span>
        </div>
        <div class="text-slate-500 text-[10px] mt-1 break-all font-mono">${detailStr}</div>
      </div>`;
  }).join('');
}

window.openAuditLogModal = function () {
  document.getElementById('modal-audit-log').classList.remove('hidden');
  document.getElementById('modal-audit-log').classList.add('flex');
  renderAuditLogList();
};

// ============ FROM: Smart-pos-pro-v9-modular/js/db/sheetsSchema.js ============
// ==========================================
// GOOGLE SHEETS — FULL DATABASE SCHEMA
// ==========================================
// Single source of truth for every sheet tab and its column headers used by
// the "ซิงค์ฐานข้อมูลทั้งหมด" (sync whole database) feature. Each entry maps
// one part of db to one Sheet tab. Keep this in sync with the Apps
// Script's expectations — the .gs script just writes whatever headers/rows
// it's sent, so THIS file is what actually defines the table structure.
//
// Row order for every sheet: first column is always the unique ID used for
// de-duplication (kept even for sheets that are fully replaced each sync,
// so a human skimming the sheet can still find things by ID).


function fmtDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('th-TH');
}

const SHEETS = {
  // Product data is genuinely relational (1 product -> many size/variants -> many
  // fraction/split-sale units), so it gets THREE linked sheets instead of one wide
  // row with a JSON blob column — each level is then natively readable/filterable/
  // sortable in Sheets without parsing anything.
  productsMaster: {
    sheetName: 'สินค้าหลัก',
    headers: ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'ไอคอน', 'รูปภาพ', 'จำนวนขนาดทั้งหมด', 'สถานะ', 'อัปเดตล่าสุด'],
    buildRows(db) {
      return Object.values(db.products).map(p => [
        p.id, p.name, (p.cat || []).join(', '), p.image || '',
        // =IMAGE() renders an actual thumbnail directly in the cell when a photo URL
        // is set — Sheets evaluates any cell value starting with "=" as a formula.
        p.imageUrl ? `=IMAGE("${p.imageUrl.replace(/"/g, '""')}")` : '',
        (p.variants || []).length,
        p.isDeleted ? 'ระงับการขาย' : 'ใช้งานอยู่',
        new Date().toISOString()
      ]);
    }
  },

  productVariants: {
    sheetName: 'ตัวเลือกสินค้า_ขนาด',
    headers: ['รหัสตัวเลือก', 'รหัสสินค้า', 'ชื่อสินค้า', 'ขนาด_รุ่น', 'บาร์โค้ด', 'ราคาทุน', 'ราคาขาย', 'สต็อกคงเหลือ', 'สต็อกขั้นต่ำ', 'มีหน่วยย่อย_แบ่งขาย'],
    buildRows(db) {
      const rows = [];
      Object.values(db.products).forEach(p => {
        (p.variants || []).forEach(v => {
          rows.push([
            v.id, p.id, p.name, v.sizeName, v.barcode || '',
            v.cost, v.price, v.stock, v.minStock,
            (v.fractions || []).length > 0 ? 'มี' : 'ไม่มี'
          ]);
        });
      });
      return rows;
    }
  },

  productFractions: {
    sheetName: 'หน่วยย่อย_แบ่งขาย',
    headers: ['รหัสหน่วยย่อย', 'รหัสตัวเลือก', 'รหัสสินค้า', 'ชื่อสินค้า', 'ชื่อหน่วยย่อย', 'ตัวคูณสต็อก', 'ราคาต่อหน่วยย่อย'],
    buildRows(db) {
      const rows = [];
      Object.values(db.products).forEach(p => {
        (p.variants || []).forEach(v => {
          (v.fractions || []).forEach(f => {
            rows.push([f.id, v.id, p.id, p.name, f.fractionName, f.fractionMultiplier, f.fractionPrice]);
          });
        });
      });
      return rows;
    }
  },

  categories: {
    sheetName: 'หมวดหมู่',
    headers: ['รหัสหมวดหมู่', 'ชื่อหมวดหมู่', 'ไอคอน', 'สี'],
    buildRows(db) {
      return (db.categories || []).map(c => [c.id, c.name, c.icon || '', c.color || '']);
    }
  },

  customers: {
    sheetName: 'ลูกค้า',
    headers: ['รหัสลูกค้า', 'ชื่อลูกค้า', 'เบอร์โทร', 'ยอดหนี้ค้างชำระ'],
    buildRows(db) {
      return Object.values(db.customers).map(c => [c.id, c.name, c.phone || '', c.debt || 0]);
    }
  },

  suppliers: {
    sheetName: 'ซัพพลายเออร์',
    headers: ['รหัสซัพพลายเออร์', 'ชื่อซัพพลายเออร์', 'เลขผู้เสียภาษี', 'เครดิตเทอม_วัน'],
    buildRows(db) {
      return Object.values(db.suppliers || {}).map(s => [s.id, s.name, s.taxId || '', s.terms || 0]);
    }
  },

  sales: {
    sheetName: 'บิลขาย',
    headers: ['รหัสบิล', 'วันเวลา', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'ช่องทางชำระ', 'ยอดขายรวม', 'ต้นทุนรวม', 'กำไร', 'จำนวนรายการ', 'สถานะคืนสินค้า', 'ยอดคืนสะสม', 'บันทึกเข้าsheetล่าสุด'],
    buildRows(db) {
      return (db.bills || []).map(b => {
        const cName = b.customerId && b.customerId !== 'GENERAL' && db.customers[b.customerId] ? db.customers[b.customerId].name : 'ลูกค้าทั่วไป';
        const methodLabel = b.method === 'CASH' ? 'เงินสด' : b.method === 'TRANSFER' ? 'เงินโอน (QR)' : 'ค้างชำระ (วางบิล)';
        return [
          b.id, fmtDate(b.time), b.customerId || '', cName, methodLabel,
          b.total, b.totalCost, roundAmt(b.total - b.totalCost), (b.items || []).length,
          b.isRefunded ? 'คืนเต็มจำนวน' : ((b.refundAmount || 0) > 0 ? 'คืนบางส่วน' : 'ปกติ'),
          b.refundAmount || 0,
          new Date().toISOString()
        ];
      });
    }
  },

  saleItems: {
    sheetName: 'รายการขาย',
    headers: ['รหัสบิล', 'รหัสสินค้า', 'รหัสตัวเลือก', 'ชื่อสินค้า', 'ขนาด_รุ่น', 'จำนวน', 'ตัวคูณหน่วยย่อย', 'ราคาต่อหน่วย', 'ต้นทุนต่อหน่วย', 'ยอดรวมบรรทัด', 'จำนวนที่คืนแล้ว'],
    buildRows(db) {
      const rows = [];
      (db.bills || []).forEach(b => {
        (b.items || []).forEach(i => {
          rows.push([
            b.id, i.id || '', i.variantId || '', i.name, i.sizeName || '',
            i.qty, i.multiplier || 1, i.price, i.cost,
            roundAmt(i.qty * i.price), i.refundedQty || 0
          ]);
        });
      });
      return rows;
    }
  },

  shifts: {
    sheetName: 'กะการทำงาน',
    headers: ['รหัสกะ', 'เวลาเปิดกะ', 'เวลาปิดกะ', 'เงินสดเปิด', 'เงินสดคงเหลือปิดกะ', 'ยอดโอนสะสม', 'จำนวนรายการนำเข้า_ออกเงินสด'],
    buildRows(db) {
      return (db.shifts || []).map(s => [
        s.id, fmtDate(s.startTime), fmtDate(s.endTime), s.openingCash, s.cashOnHand, s.transferSales,
        (s.transactions || []).length
      ]);
    }
  },

  purchaseOrders: {
    sheetName: 'ใบสั่งซื้อ',
    headers: ['รหัสใบสั่งซื้อ', 'รหัสซัพพลายเออร์', 'วันที่สั่งซื้อ', 'กำหนดชำระ', 'เครดิตเทอม_วัน', 'ยอดรวม', 'จ่ายแล้ว', 'คงค้างชำระ', 'สถานะ'],
    buildRows(db) {
      return (db.pos || []).map(po => [
        po.id, po.supplierId, fmtDate(po.time), po.dueDate || '', po.terms || 0,
        po.total, po.paidAmount || 0, roundAmt(po.total - (po.paidAmount || 0)), po.status
      ]);
    }
  },

  poItems: {
    sheetName: 'รายการสั่งซื้อ',
    headers: ['รหัสใบสั่งซื้อ', 'รหัสสินค้า', 'รหัสตัวเลือก', 'จำนวนที่สั่ง', 'ราคาทุนต่อหน่วย'],
    buildRows(db) {
      const rows = [];
      (db.pos || []).forEach(po => {
        (po.items || []).forEach(i => {
          rows.push([po.id, i.productId, i.variantId, i.qty, i.cost]);
        });
      });
      return rows;
    }
  },

  cashLedger: {
    sheetName: 'บัญชีรายรับรายจ่าย',
    headers: ['รหัสรายการ', 'วันที่', 'รายละเอียด', 'รายรับ', 'รายจ่าย', 'ประเภท', 'รหัสอ้างอิง'],
    buildRows(db) {
      return (db.cashLedger || []).map(t => [t.id, t.date, t.description, t.income || 0, t.expense || 0, t.type, t.refId || '']);
    }
  }
};

/** Builds { sheetName, headers, rows } for every entry in SHEETS, ready to POST one at a time. */
function buildAllSheetPayloads() {
  return Object.values(SHEETS).map(def => ({
    sheetName: def.sheetName,
    headers: def.headers,
    rows: def.buildRows(db)
  }));
}


// ============ FROM: Smart-pos-pro-v9-modular/js/features/resetSystem.js ============

      // ==========================================
      // CLEAR PRODUCTS / FULL SYSTEM RESET
      // ==========================================
      // Both actions are destructive and irreversible, so they're layered with
      // FOUR separate safeguards: (1) manager PIN, (2) a typed confirmation
      // phrase that must match exactly before the button even enables,
      // (3) an automatic backup download of the current data right before
      // wiping anything, (4) guardOnce to stop a double-tap from running it twice.

      function openDangerConfirm(title, desc, phrase, action) {
        document.getElementById('danger-confirm-title').innerText = title;
        document.getElementById('danger-confirm-desc').innerText = desc;
        document.getElementById('danger-confirm-phrase-hint').innerText = `"${phrase}"`;
        document.getElementById('danger-confirm-input').value = '';
        const btn = document.getElementById('danger-confirm-btn');
        btn.disabled = true;
        btn.className = "flex-1 py-3 bg-slate-300 text-white rounded-xl font-bold text-xs btn-touch cursor-not-allowed";
        dangerConfirmPhrase = phrase;
        dangerConfirmAction = action;
        document.getElementById('modal-danger-confirm').classList.remove('hidden');
        document.getElementById('modal-danger-confirm').classList.add('flex');
      }

      window.checkDangerConfirmInput = function() {
        const input = document.getElementById('danger-confirm-input').value.trim();
        const btn = document.getElementById('danger-confirm-btn');
        const match = input === dangerConfirmPhrase;
        btn.disabled = !match;
        btn.className = match
          ? "flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs btn-touch"
          : "flex-1 py-3 bg-slate-300 text-white rounded-xl font-bold text-xs btn-touch cursor-not-allowed";
      };

      window.runDangerConfirmAction = function() {
        if (!guardOnce('runDangerConfirmAction')) return;
        const input = document.getElementById('danger-confirm-input').value.trim();
        if (input !== dangerConfirmPhrase) return; // belt-and-braces — button is disabled anyway unless matched
        const action = dangerConfirmAction;
        dangerConfirmAction = null;
        dangerConfirmPhrase = '';
        closeModal('modal-danger-confirm');
        if (action) action();
      };

      // Auto-downloads a JSON backup of the whole current database before any
      // destructive action, so a mistaken reset can always be recovered from
      // ⚙️ ตั้งค่า > Restore.
      function backupBeforeDanger(label) {
        try { window.downloadJSONFile(db, `Backup_ก่อน_${label}`); } catch (e) { console.error(e); }
      }

      window.openClearProductsModal = function() {
        window.openManagerPinModal(() => {
          openDangerConfirm(
            "ล้างข้อมูลสินค้าทั้งหมด?",
            "จะลบสินค้า หน่วยนับ และหมวดหมู่ทั้งหมดออกจากระบบ แต่จะไม่กระทบข้อมูลลูกค้า ประวัติการขาย หรือยอดหนี้ค้างชำระ ระบบจะดาวน์โหลดไฟล์สำรองข้อมูลปัจจุบันให้ก่อนดำเนินการ",
            "ล้างสินค้า",
            () => {
              backupBeforeDanger("ล้างสินค้า");
              const productCount = Object.keys(db.products).length;
              db.products = {};
              db.categories = JSON.parse(JSON.stringify(DB_DEFAULT.categories));
              db.counters.product = 0;
              db.counters.variant = 0;
              db.counters.category = DB_DEFAULT.counters.category;
              persist();
              logTransaction('PRODUCT_CLEAR', { clearedCount: productCount });
              renderAll();
              showAlert("ล้างข้อมูลสินค้าสำเร็จ", `ลบสินค้าออกไป ${productCount} รายการ และตั้งหมวดหมู่กลับเป็นค่าเริ่มต้นแล้ว`, false);
            }
          );
        });
      };

      window.openFullResetModal = function() {
        window.openManagerPinModal(() => {
          openDangerConfirm(
            "รีเซ็ตระบบทั้งหมด?",
            "จะลบข้อมูลทั้งหมดในระบบ ทั้งสินค้า ลูกค้า ประวัติการขาย กะการทำงาน และตั้งค่าต่าง ๆ กลับเป็นค่าเริ่มต้นจากโรงงานอย่างถาวร ระบบจะดาวน์โหลดไฟล์สำรองข้อมูลปัจจุบันให้ก่อนดำเนินการ",
            "รีเซ็ตระบบ",
            () => {
              backupBeforeDanger("รีเซ็ตระบบ");
              logTransaction('DB_RESET', { previousProductCount: Object.keys(db.products).length, previousBillCount: db.bills.length });
              db = JSON.parse(JSON.stringify(DB_DEFAULT));
              persist();
              showAlert("รีเซ็ตระบบสำเร็จ", "ระบบถูกตั้งค่ากลับเป็นค่าเริ่มต้นจากโรงงานแล้ว หน้าเว็บจะโหลดใหม่อีกครั้ง", false);
              setTimeout(() => location.reload(), 1500);
            }
          );
        });
      };


// ============ FROM: Smart-pos-pro-v9-modular/js/features/sheetsFullSync.js ============

      // ==========================================
      // GOOGLE SHEETS — FULL DATABASE SYNC
      // ==========================================
      // Unlike sendToGoogleSheets() (sync.js), which appends ONE sale row the
      // moment it happens, this replaces the ENTIRE content of every sheet tab
      // with what's currently in db — so Sheets always ends up an exact
      // mirror of the local database after running it. That's the right model
      // for master data (products/categories/customers/suppliers, which get
      // edited and deleted, not just appended to) and is also the simplest,
      // most robust way to keep the transactional sheets (sales, shifts, POs,
      // cash ledger) consistent without needing per-row upsert logic on the
      // Apps Script side.
      //
      // Sent as JSON with Content-Type: text/plain (not application/json) on
      // purpose — that keeps it a "simple request" so the browser doesn't
      // attempt a CORS preflight OPTIONS call, which Apps Script Web Apps
      // don't handle. The Apps Script side parses e.postData.contents as JSON.

      window.syncFullDatabaseToSheets = async function() {
        const url = db.settings.googleSheetsUrl;
        if (!url) return showAlert("ไม่พบการตั้งค่า", "กรุณากรอก Google Sheets Web App URL ในช่องตั้งค่าก่อน", true);
        if (!guardOnce('syncFullDatabaseToSheets')) return;

        const payloads = buildAllSheetPayloads();
        const totalRows = payloads.reduce((sum, p) => sum + p.rows.length, 0);

        window.showCustomConfirm(
          "ซิงค์ฐานข้อมูลทั้งหมดไป Google Sheets?",
          `ระบบจะส่งข้อมูลทั้งหมด ${payloads.length} ตาราง (รวม ${totalRows} แถว) ไปเขียนทับข้อมูลเดิมใน Google Sheets ทั้งหมด การแก้ไขใดๆ ที่ทำไว้ในชีตโดยตรง (นอกเหนือจากที่ระบบ POS ส่งไป) จะถูกเขียนทับ`,
          async () => {
            showToast(`กำลังซิงค์ข้อมูล ${payloads.length} ตาราง...`);
            let successCount = 0;
            const failedSheets = [];

            for (const payload of payloads) {
              try {
                await fetchWithRetry(url, {
                  method: "POST",
                  mode: "no-cors",
                  headers: { "Content-Type": "text/plain;charset=utf-8" },
                  body: JSON.stringify({ action: 'fullReplace', ...payload })
                });
                successCount++;
              } catch (err) {
                console.error(`Full sync failed for sheet "${payload.sheetName}":`, err);
                failedSheets.push(payload.sheetName);
              }
            }

            logTransaction('SHEETS_FULL_SYNC', { sheetCount: payloads.length, totalRows, successCount, failedSheets });

            if (failedSheets.length === 0) {
              showAlert("ซิงค์ข้อมูลสำเร็จ", `ส่งข้อมูลครบทั้ง ${payloads.length} ตาราง (${totalRows} แถว) เรียบร้อยแล้ว`, false);
            } else {
              showAlert("ซิงค์ข้อมูลสำเร็จบางส่วน", `สำเร็จ ${successCount}/${payloads.length} ตาราง — ตารางที่ล้มเหลว: ${failedSheets.join(', ')} กรุณาลองซิงค์ใหม่อีกครั้ง`, true);
            }
          }
        );
      };

      // Quick connection test against the full-sync endpoint — sends an empty
      // "ping" sheet so the person can confirm the Apps Script deployment
      // understands the fullReplace action before running a real sync.
      window.testFullSyncConnection = async function() {
        const url = db.settings.googleSheetsUrl;
        if (!url) return showAlert("ไม่พบ URL", "กรุณาระบุ URL ของ Google Apps Script ก่อนทำการทดสอบ", true);
        showToast("กำลังทดสอบการเชื่อมต่อระบบซิงค์ฐานข้อมูลทั้งหมด...");
        try {
          await fetchWithRetry(url, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: 'ping' })
          });
          showAlert("เชื่อมต่อสำเร็จ!", "ระบบส่งคำขอทดสอบไปยัง Google Apps Script สำเร็จแล้ว", false);
        } catch (err) {
          showAlert("เชื่อมต่อล้มเหลว", "เกิดข้อผิดพลาด: " + err.message, true);
        }
      };

/* END */

/* START part4.js */
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


/* END */

/* START supabase-integration.js */
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
  // This project uses relational Supabase tables, not public.pos_state.
  // Do not write the entire local demo DB over a relational schema.
  console.warn('[SmartPOS] Legacy full-state sync disabled: public.pos_state is not part of this schema.');
  updateSyncStatusBadge('offline', null);
  return false;
};

async function checkAndPullNewerStateOnStartup() {
  // V4 uses relational tables; never attempt to read the deprecated pos_state row.
  console.info('[SmartPOS] Legacy pos_state startup pull skipped; relational sync must be used.');
  updateSyncStatusBadge('offline', null);
  return;
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


/* END */
