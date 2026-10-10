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
