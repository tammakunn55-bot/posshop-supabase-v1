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

