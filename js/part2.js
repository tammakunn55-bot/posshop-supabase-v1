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


