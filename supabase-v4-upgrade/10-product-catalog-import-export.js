/* Smart POS V4 — Product Catalog Import/Export
 * Version: 2.0.0
 * Load AFTER 01-core.js, 02-sales-stock.js, 04-supabase.js and the V4 adapters.
 * Supports complete JSON catalog (optional embedded images), flat CSV, image-folder imports,
 * safe merge, validation, optional stock import through set_variant_stock RPC, and cloud sync.
 */
(() => {
  'use strict';
  if (window.__smartPosCatalogIOLoaded) return;
  window.__smartPosCatalogIOLoaded = true;

  const FORMAT = 'smartpos-product-catalog';
  const VERSION = 2;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const $ = (sel, root = document) => root.querySelector(sel);
  const list = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
  const clean = v => String(v ?? '').trim();
  const number = (v, fallback = 0) => {
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(String(v).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = v => [true, 1, '1', 'true', 'yes', 'y', 'ใช่', 'active'].includes(typeof v === 'string' ? v.trim().toLowerCase() : v);
  const invalidNumeric = v => v !== undefined && v !== null && clean(v) !== '' && !Number.isFinite(Number(String(v).replace(/,/g, '').trim()));
  const newId = prefix => `${prefix || 'P-'}${(window.generateID ? window.generateID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)}`;
  const currentDb = () => window.db || null;
  const notify = (title, message, error = false) => {
    if (typeof window.showAlert === 'function') window.showAlert(title, message, error);
    else (error ? console.error : console.log)(title, message);
  };
  const toast = message => { if (typeof window.showToast === 'function') window.showToast(message); else console.info(message); };
  const clone = value => JSON.parse(JSON.stringify(value));

  const CSV_COLUMNS = [
    'source_store_id','product_id','product_name','brand','description','categories','group_name','image_emoji','image_url','image_storage_path','image_filename','is_deleted',
    'variant_id','sku','barcode','size_name','unit','cost','current_cost','last_cost','price','stock','min_stock','min_margin_pct','variant_active',
    'fraction_id','fraction_name','fraction_multiplier','fraction_price'
  ];

  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+@\-]/.test(s) && !/^-[0-9]+(?:\.[0-9]+)?$/.test(s)) s = `'${s}`; // mitigate spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(rows) {
    return '\uFEFF' + [CSV_COLUMNS.join(','), ...rows.map(row => CSV_COLUMNS.map(k => csvCell(row[k])).join(','))].join('\r\n');
  }
  function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(x => x !== '')) rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (quoted) throw new Error('ไฟล์ CSV มีเครื่องหมายอัญประกาศไม่ครบ');
    if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); if (row.some(x => x !== '')) rows.push(row); }
    if (rows.length < 2) throw new Error('ไม่พบแถวข้อมูลใน CSV');
    const headers = rows.shift().map(h => clean(h).toLowerCase().replace(/^\ufeff/, '').replace(/[\s-]+/g, '_'));
    const aliases = {
      product: 'product_name', name: 'product_name', productname: 'product_name', product_code: 'product_id',
      category: 'categories', category_name: 'categories', image: 'image_emoji', imageurl: 'image_url', photo: 'image_url', brand_name: 'brand', product_description: 'description',
      variant: 'variant_id', variantid: 'variant_id', size: 'size_name', option: 'size_name', barcode_no: 'barcode',
      sku_code: 'sku', selling_price: 'price', unit_cost: 'cost', minstock: 'min_stock', minimum_stock: 'min_stock',
      fractionname: 'fraction_name', multiplier: 'fraction_multiplier', fractionprice: 'fraction_price',
      imagepath: 'image_storage_path', image_file: 'image_filename', deleted: 'is_deleted', currentcost: 'current_cost', lastcost: 'last_cost', minmarginpct: 'min_margin_pct', active: 'variant_active'
    };
    const mapped = headers.map(h => aliases[h] || h);
    if (!mapped.includes('product_name')) throw new Error('CSV ต้องมีคอลัมน์ product_name หรือ product_name ที่เทียบเท่า');
    return rows.map((values, i) => {
      const obj = { __row: i + 2 };
      if (values.length !== headers.length) obj.__csv_error = `แถว ${i + 2}: จำนวนคอลัมน์ (${values.length}) ไม่ตรงกับหัวตาราง (${headers.length})`;
      mapped.forEach((h, j) => { if (h && CSV_COLUMNS.includes(h)) obj[h] = values[j] ?? ''; });
      return obj;
    });
  }
  function categoryNames(p, categoryMap) {
    if (Array.isArray(p.cat)) return p.cat.map(x => typeof x === 'string' ? x : x?.name).filter(Boolean);
    if (Array.isArray(p.categories)) return p.categories.map(x => typeof x === 'string' ? x : x?.name).filter(Boolean);
    if (typeof p.categories === 'string') return p.categories.split(/[|;、]/).map(clean).filter(Boolean);
    if (Array.isArray(p.category_ids)) return p.category_ids.map(id => categoryMap.get(id)).filter(Boolean);
    return [];
  }
  function flattenCatalog(db, options = {}) {
    const cats = new Map(list(db.categories).map(c => [String(c.id), c.name]));
    const rows = [];
    for (const p of list(db.products)) {
      const variants = list(p.variants);
      const base = {
        source_store_id: clean(localStorage.getItem('POS_STORE_ID')), product_id: p.id || '', product_name: p.name || '', brand: p.brand || '', description: p.description || '', categories: categoryNames(p, cats).join('|'),
        group_name: p.groupName || p.group_name || '', image_emoji: p.image || '📦', image_url: p.imageUrl || '',
        image_storage_path: p.imageStoragePath || '', image_filename: '', is_deleted: p.isDeleted ? 'true' : 'false'
      };
      if (!variants.length) rows.push({ ...base });
      for (const v of variants) {
        const variantBase = {
          ...base, variant_id: v.id || '', sku: v.sku || v.code || '', barcode: v.barcode || '',
          size_name: v.sizeName || v.size_name || '', unit: v.unit || '', cost: v.cost ?? 0, current_cost: v.currentCost ?? v.current_cost ?? v.cost ?? 0, last_cost: v.lastCost ?? v.last_cost ?? v.cost ?? 0,
          price: v.price ?? v.selling_price ?? 0, stock: options.includeStock === false ? '' : (v.stock ?? 0),
          min_stock: v.minStock ?? v.min_stock ?? 0, min_margin_pct: v.minMarginPct ?? v.min_margin_pct ?? '', variant_active: v.active === false ? 'false' : 'true'
        };
        const fractions = list(v.fractions);
        if (!fractions.length) rows.push({ ...variantBase });
        else for (const f of fractions) rows.push({
          ...variantBase, fraction_id: f.id || '', fraction_name: f.fractionName || f.fraction_name || '',
          fraction_multiplier: f.fractionMultiplier ?? f.multiplier ?? 0,
          fraction_price: f.fractionPrice ?? f.fraction_price ?? 0
        });
      }
    }
    return rows;
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function safeFilename(s) { return clean(s || 'SmartPOS').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'SmartPOS'; }
  function fileStamp() { return new Date().toISOString().slice(0, 10); }
  function dataUrlFromBlob(blob) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error || new Error('อ่านรูปไม่สำเร็จ')); r.readAsDataURL(blob); });
  }
  async function resolveImageUrl(p) {
    if (p.imageStoragePath && typeof window.refreshProductImageUrl === 'function') {
      await window.refreshProductImageUrl(p.id, false);
    }
    return clean(currentDb()?.products?.[p.id]?.imageUrl || p.imageUrl || p.image_url);
  }
  async function exportJson(options = {}) {
    const db = currentDb(); if (!db) throw new Error('ไม่พบข้อมูล POS');
    const products = list(db.products).map(p => clone(p));
    const result = {
      format: FORMAT, formatVersion: VERSION, exportedAt: new Date().toISOString(),
      sourceStoreId: clean(localStorage.getItem('POS_STORE_ID')),
      storeName: clean(db.storeName), categories: clone(list(db.categories)), products,
      options: { includesImages: !!options.embedImages, includesStock: options.includeStock !== false }
    };
    if (options.includeStock === false) for (const p of result.products) for (const v of list(p.variants)) delete v.stock;
    const imageErrors = [];
    if (options.embedImages) {
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        try {
          const url = await resolveImageUrl(p);
          if (!url) continue;
          const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) throw new Error('ไฟล์ปลายทางไม่ใช่รูปภาพ');
          if (blob.size > MAX_IMAGE_BYTES) throw new Error('รูปใหญ่กว่า 5 MB');
          p.imageDataUrl = await dataUrlFromBlob(blob);
          p.imageUrl = url;
          p.imageFileName = `${safeFilename(p.id || p.name)}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg','jpg')}`;
        } catch (e) { imageErrors.push(`${p.name || p.id}: ${e.message || e}`); }
      }
    }
    downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json;charset=utf-8' }), `SmartPOS_Catalog_${fileStamp()}.json`);
    return { products: products.length, images: products.filter(p => p.imageDataUrl).length, imageErrors };
  }
  function exportCsv(options = {}) {
    const db = currentDb(); if (!db) throw new Error('ไม่พบข้อมูล POS');
    const rows = flattenCatalog(db, options);
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `SmartPOS_Catalog_${fileStamp()}.csv`);
    return { products: list(db.products).length, rows: rows.length };
  }
  function exportTemplate() {
    const rows = [{ product_id: 'P-EXAMPLE', product_name: 'ตัวอย่างสินค้า', brand: 'ตัวอย่างแบรนด์', description: 'รายละเอียดสินค้า', categories: 'เครื่องมือ|อุปกรณ์', group_name: 'กลุ่มสินค้า', image_emoji: '📦', image_url: '', image_storage_path: '', image_filename: 'P-EXAMPLE.jpg', is_deleted: 'false', variant_id: 'V-EXAMPLE', sku: 'SKU-EXAMPLE', barcode: '8850000000000', size_name: 'มาตรฐาน', unit: 'ชิ้น', cost: 10, current_cost: 10, last_cost: 10, price: 15, stock: 0, min_stock: 0, min_margin_pct: 20, variant_active: 'true', fraction_id: 'F-EXAMPLE', fraction_name: 'ครึ่งชิ้น', fraction_multiplier: 0.5, fraction_price: 8 }];
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'SmartPOS_Product_Import_Template.csv');
  }

  function parseJsonCatalog(obj) {
    if (Array.isArray(obj)) return { categories: [], products: obj, sourceStoreId: '', format: 'legacy-array' };
    if (!obj || typeof obj !== 'object') throw new Error('JSON ต้องเป็น object หรือ array ของสินค้า');
    const products = Array.isArray(obj.products) ? obj.products : (obj.db?.products ? list(obj.db.products) : null);
    if (!products) throw new Error('ไม่พบรายการ products ใน JSON');
    if (obj.format && obj.format !== FORMAT) throw new Error('รูปแบบไฟล์ไม่ใช่ SmartPOS Product Catalog');
    return { categories: Array.isArray(obj.categories) ? obj.categories : (obj.db?.categories || []), products, sourceStoreId: obj.sourceStoreId || '', format: obj.format || 'legacy' };
  }
  function normalizeJsonProduct(raw, rowNo, errors) {
    const name = clean(raw.name ?? raw.product_name);
    if (!name) { errors.push(`รายการ ${rowNo}: ไม่มีชื่อสินค้า`); return null; }
    const p = {
      id: clean(raw.id ?? raw.product_id) || newId('P-'), name,
      image: clean(raw.image ?? raw.image_emoji) || '📦', imageUrl: clean(raw.imageUrl ?? raw.image_url),
      imageStoragePath: clean(raw.imageStoragePath ?? raw.image_storage_path),
      groupName: clean(raw.groupName ?? raw.group_name), isDeleted: bool(raw.isDeleted ?? raw.is_deleted),
      cat: categoryNames(raw, new Map()), variants: [],
      ...(raw.brand !== undefined ? { brand: clean(raw.brand) } : {}),
      ...(raw.description !== undefined ? { description: clean(raw.description) } : {}),
      ...(raw.imageDataUrl ? { imageDataUrl: raw.imageDataUrl } : {}),
      ...(raw.imageFileName ? { imageFileName: raw.imageFileName } : {})
    };
    for (const [vi, rv] of list(raw.variants).entries()) {
      const sizeName = clean(rv.sizeName ?? rv.size_name ?? rv.unit_name) || 'มาตรฐาน';
      const costRaw = rv.cost ?? rv.unit_cost, priceRaw = rv.price ?? rv.selling_price, stockRaw = rv.stock, minStockRaw = rv.minStock ?? rv.min_stock;
      for (const [field, value] of [['cost',costRaw],['price',priceRaw],['stock',stockRaw],['min_stock',minStockRaw],['current_cost',rv.currentCost ?? rv.current_cost],['last_cost',rv.lastCost ?? rv.last_cost],['min_margin_pct',rv.minMarginPct ?? rv.min_margin_pct]]) if (invalidNumeric(value)) errors.push(`${name}: รุ่น ${sizeName} ค่า ${field} ไม่ใช่ตัวเลข`);
      const cost = number(costRaw, 0), price = number(priceRaw, 0);
      const stock = number(stockRaw, 0), minStock = number(minStockRaw, 0);
      if ([cost, price, stock, minStock, number(rv.currentCost ?? rv.current_cost, cost), number(rv.lastCost ?? rv.last_cost, cost), number(rv.minMarginPct ?? rv.min_margin_pct, 0)].some(n => n < 0)) errors.push(`${name}: รุ่น ${sizeName} มีราคา/สต็อก/ค่ากำไรติดลบ`);
      const fractions = list(rv.fractions).map((f, fi) => {
        const multiplierRaw = f.fractionMultiplier ?? f.fraction_multiplier ?? f.multiplier, fractionPriceRaw = f.fractionPrice ?? f.fraction_price;
        if (invalidNumeric(multiplierRaw) || invalidNumeric(fractionPriceRaw)) errors.push(`${name}: หน่วยย่อยแถว ${fi + 1} มีตัวคูณ/ราคาไม่ใช่ตัวเลข`);
        const multiplier = number(multiplierRaw, 0);
        const fractionPrice = number(fractionPriceRaw, 0);
        if (!clean(f.fractionName ?? f.fraction_name) || multiplier <= 0 || fractionPrice < 0) errors.push(`${name}: หน่วยย่อยแถว ${fi + 1} ไม่ถูกต้อง`);
        return { id: clean(f.id ?? f.fraction_id) || newId('F-'), fractionName: clean(f.fractionName ?? f.fraction_name) || 'หน่วยย่อย', fractionMultiplier: multiplier, fractionPrice };
      });
      p.variants.push({
        id: clean(rv.id ?? rv.variant_id) || newId('V-'), sizeName,
        barcode: clean(rv.barcode), sku: clean(rv.sku), unit: clean(rv.unit) || sizeName,
        cost, currentCost: number(rv.currentCost ?? rv.current_cost, cost), lastCost: number(rv.lastCost ?? rv.last_cost, cost),
        price, stock, minStock, fractions,
        ...(rv.minMarginPct !== undefined ? { minMarginPct: number(rv.minMarginPct, 20) } : {}),
        ...(rv.active !== undefined ? { active: rv.active !== false } : {})
      });
    }
    if (!p.variants.length) p.variants.push({ id: newId('V-'), sizeName: 'มาตรฐาน', barcode: '', unit: 'ชิ้น', cost: 0, price: 0, stock: 0, minStock: 0, fractions: [] });
    return p;
  }
  function parseCsvProducts(rows, errors) {
    const productMap = new Map();
    const variantKeys = new Map();
    for (const row of rows) {
      const name = clean(row.product_name);
      if (!name) { errors.push(`แถว ${row.__row}: ไม่มี product_name`); continue; }
      const productKey = clean(row.product_id) || `name:${name.toLowerCase()}|${clean(row.group_name).toLowerCase()}`;
      if (!productMap.has(productKey)) productMap.set(productKey, {
        id: clean(row.product_id) || newId('P-'), name, image: clean(row.image_emoji) || '📦',
        imageUrl: clean(row.image_url), imageStoragePath: clean(row.image_storage_path),
        imageFileName: clean(row.image_filename), brand: clean(row.brand), description: clean(row.description), groupName: clean(row.group_name), isDeleted: bool(row.is_deleted),
        cat: clean(row.categories).split(/[|;、]/).map(clean).filter(Boolean), variants: []
      });
      const p = productMap.get(productKey);
      // Later non-empty values may fill missing product metadata, but don't silently conflict.
      if (p.name !== name) errors.push(`แถว ${row.__row}: product_id เดียวกันมีชื่อสินค้าต่างกัน`);
      if (row.variant_id || row.barcode || row.sku || row.size_name || row.price !== undefined) {
        const variantKey = clean(row.variant_id) || (clean(row.barcode) ? `barcode:${clean(row.barcode)}` : `row:${row.__row}`);
        if (!variantKeys.has(productKey)) variantKeys.set(productKey, new Map());
        const perProduct = variantKeys.get(productKey);
        let v = perProduct.get(variantKey);
        if (!v) {
          v = { id: clean(row.variant_id) || newId('V-'), sizeName: clean(row.size_name) || 'มาตรฐาน', barcode: clean(row.barcode), sku: clean(row.sku), unit: clean(row.unit) || 'ชิ้น', cost: number(row.cost), currentCost: number(row.current_cost, number(row.cost)), lastCost: number(row.last_cost, number(row.cost)), price: number(row.price), stock: number(row.stock), minStock: number(row.min_stock), minMarginPct: row.min_margin_pct === undefined || clean(row.min_margin_pct) === '' ? undefined : number(row.min_margin_pct), active: row.variant_active === undefined || clean(row.variant_active) === '' ? true : bool(row.variant_active), fractions: [] };
          perProduct.set(variantKey, v); p.variants.push(v);
        } else {
          for (const field of ['barcode','sku','size_name','unit','cost','current_cost','last_cost','price','stock','min_stock','min_margin_pct','variant_active']) {
            const key = ({size_name:'sizeName', min_stock:'minStock', current_cost:'currentCost', last_cost:'lastCost', min_margin_pct:'minMarginPct', variant_active:'active'})[field] || field;
            if (row[field] !== undefined && clean(row[field]) !== '' && String(v[key] ?? '') !== String(field === 'cost' || field === 'price' || field === 'stock' || field === 'min_stock' ? number(row[field]) : (field === 'size_name' ? clean(row[field]) : clean(row[field])))) {
              // Repeated variant rows may have blank cells; report only true conflicting non-empty values.
              if (clean(row[field]) !== '') errors.push(`แถว ${row.__row}: รุ่น ${v.sizeName} มีค่า ${field} ไม่ตรงกันระหว่างแถว`);
            }
          }
        }
        if (clean(row.fraction_name)) {
          const fid = clean(row.fraction_id) || `${variantKey}:fraction:${clean(row.fraction_name).toLowerCase()}`;
          if (!v.fractions.some(f => f.id === fid || f.fractionName.toLowerCase() === clean(row.fraction_name).toLowerCase())) {
            v.fractions.push({ id: clean(row.fraction_id) || newId('F-'), fractionName: clean(row.fraction_name), fractionMultiplier: number(row.fraction_multiplier), fractionPrice: number(row.fraction_price) });
          }
        }
      }
    }
    return [...productMap.values()];
  }
  function analyzeCsvRows(rows) {
    const groups = new Map();
    const groupKey = row => clean(row.product_id) ? `id:${clean(row.product_id)}` : `name:${clean(row.product_name).toLowerCase()}|${clean(row.group_name).toLowerCase()}`;
    const numericFields = ['cost','current_cost','last_cost','price','stock','min_stock','min_margin_pct','fraction_multiplier','fraction_price'];
    for (const row of rows) {
      const key = groupKey(row);
      if (!groups.has(key)) groups.set(key, { key, rows: [], errors: [] });
      const g = groups.get(key); g.rows.push(row);
      if (row.__csv_error) g.errors.push({ row: row.__row, message: row.__csv_error });
      const name = clean(row.product_name);
      if (!name) g.errors.push({ row: row.__row, message: `แถว ${row.__row}: ไม่มี product_name` });
      for (const field of numericFields) {
        const value = clean(row[field]);
        if (value !== '' && !Number.isFinite(Number(value.replace(/,/g, '')))) g.errors.push({ row: row.__row, message: `แถว ${row.__row}: คอลัมน์ ${field} ไม่ใช่ตัวเลข` });
        else if (value !== '' && Number(value.replace(/,/g, '')) < 0) g.errors.push({ row: row.__row, message: `แถว ${row.__row}: คอลัมน์ ${field} ต้องไม่ติดลบ` });
      }
      if (clean(row.fraction_name) && number(row.fraction_multiplier) <= 0) g.errors.push({ row: row.__row, message: `แถว ${row.__row}: fraction_multiplier ต้องมากกว่า 0 เมื่อระบุ fraction_name` });
    }
    // Same product ID must not describe different product names.
    for (const g of groups.values()) {
      const names = new Set(g.rows.map(r => clean(r.product_name).toLowerCase()).filter(Boolean));
      if (names.size > 1) for (const r of g.rows) g.errors.push({ row: r.__row, message: `แถว ${r.__row}: product_id เดียวกันมีชื่อสินค้าต่างกัน` });
    }
    // A barcode assigned to separate products is a conflict; skip both product groups.
    const barcodeGroups = new Map();
    for (const g of groups.values()) for (const r of g.rows) {
      const barcode = clean(r.barcode); if (!barcode) continue;
      if (!barcodeGroups.has(barcode)) barcodeGroups.set(barcode, new Set());
      barcodeGroups.get(barcode).add(g.key);
    }
    for (const [barcode, keys] of barcodeGroups) if (keys.size > 1) {
      for (const key of keys) {
        const g = groups.get(key);
        for (const r of g.rows.filter(x => clean(x.barcode) === barcode)) g.errors.push({ row: r.__row, message: `แถว ${r.__row}: บาร์โค้ด ${barcode} ซ้ำในสินค้าอื่นของไฟล์` });
      }
    }
    const skuGroups = new Map();
    for (const g of groups.values()) for (const r of g.rows) {
      const sku = clean(r.sku).toLowerCase(); if (!sku) continue;
      if (!skuGroups.has(sku)) skuGroups.set(sku, new Set());
      skuGroups.get(sku).add(g.key);
    }
    for (const [sku, keys] of skuGroups) if (keys.size > 1) {
      for (const key of keys) {
        const g = groups.get(key);
        for (const r of g.rows.filter(x => clean(x.sku).toLowerCase() === sku)) g.errors.push({ row: r.__row, message: `แถว ${r.__row}: SKU ${clean(r.sku)} ซ้ำในสินค้าอื่นของไฟล์` });
      }
    }
    // Run the existing parser and validator per product group so a bad product does not block good products.
    for (const g of groups.values()) {
      const localErrors = [];
      const products = parseCsvProducts(g.rows, localErrors);
      localErrors.forEach(message => {
        const m = message.match(/แถว (\d+)/);
        g.errors.push({ row: m ? Number(m[1]) : g.rows[0]?.__row, message });
      });
      const validationErrors = validateProducts(products);
      validationErrors.forEach(message => g.errors.push({ row: g.rows[0]?.__row, message: `สินค้า ${g.rows[0]?.product_name || g.key}: ${message}` }));
      for (const conflict of existingCatalogConflicts(products)) g.errors.push({ row: g.rows[0]?.__row, message: `แถว ${g.rows[0]?.__row}: ${conflict}` });
      g.products = products;
      g.errors = [...new Map(g.errors.map(e => [`${e.row}|${e.message}`, e])).values()];
    }
    const validGroups = [...groups.values()].filter(g => g.errors.length === 0);
    const invalidGroups = [...groups.values()].filter(g => g.errors.length > 0);
    const errorRows = invalidGroups.flatMap(g => g.rows.map(row => ({ ...row, import_error: g.errors.map(e => e.message).join(' | ') })));
    return {
      products: validGroups.flatMap(g => g.products), validRows: validGroups.flatMap(g => g.rows),
      invalidProducts: invalidGroups.length, validProducts: validGroups.length, errorRows,
      errors: invalidGroups.flatMap(g => g.errors.map(e => e.message)), totalRows: rows.length
    };
  }
  function downloadImportErrorReport(errorRows) {
    if (!Array.isArray(errorRows) || !errorRows.length) { notify('ไม่มีรายงานข้อผิดพลาด', 'ไม่พบแถวที่ต้องแก้ไข'); return; }
    const columns = ['source_row', ...CSV_COLUMNS, 'import_error', 'raw_json'];
    const csv = '\uFEFF' + [columns.join(','), ...errorRows.map(row => columns.map(key => csvCell(key === 'source_row' ? row.__row : row[key])).join(','))].join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `SmartPOS_Import_Errors_${fileStamp()}.csv`);
  }

  function validateProducts(products) {
    const errors = [], barcodeOwners = new Map(), skuOwners = new Map(), variantOwners = new Map(), idOwners = new Map();
    products.forEach((p, pi) => {
      if (!clean(p.name)) errors.push(`สินค้าแถว ${pi + 1}: ไม่มีชื่อ`);
      if (idOwners.has(p.id)) errors.push(`รหัสสินค้า ${p.id} ซ้ำในไฟล์`); else idOwners.set(p.id, p.name);
      for (const v of list(p.variants)) {
        const variantId = clean(v.id);
        if (variantId) { if (variantOwners.has(variantId)) errors.push(`รหัสรุ่น ${variantId} ซ้ำในไฟล์`); else variantOwners.set(variantId, p.name); }
        const sku = clean(v.sku).toLowerCase();
        if (sku) { if (skuOwners.has(sku)) errors.push(`SKU ${v.sku} ซ้ำในไฟล์ (${skuOwners.get(sku)} / ${p.name})`); else skuOwners.set(sku, p.name); }
        if (number(v.cost) < 0 || number(v.price) < 0 || number(v.stock) < 0 || number(v.minStock) < 0) errors.push(`${p.name}: ราคา/สต็อกติดลบ`);
        const barcode = clean(v.barcode);
        if (barcode) {
          if (barcodeOwners.has(barcode)) errors.push(`บาร์โค้ด ${barcode} ซ้ำในไฟล์ (${barcodeOwners.get(barcode)} / ${p.name})`);
          else barcodeOwners.set(barcode, p.name);
        }
        for (const f of list(v.fractions)) if (number(f.fractionMultiplier) <= 0 || number(f.fractionPrice) < 0) errors.push(`${p.name}: หน่วยย่อย ${f.fractionName} มีตัวคูณ/ราคาไม่ถูกต้อง`);
      }
    });
    return errors;
  }
  async function readImageFile(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type || '')) throw new Error('รองรับเฉพาะรูป JPG, PNG และ WebP');
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: รูปใหญ่กว่า 5 MB`);
    const compressed = typeof window.compressImageFile === 'function' ? await window.compressImageFile(file) : file;
    return compressed;
  }
  function dataUrlToFile(dataUrl, filename) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('รูปฝังใน JSON ต้องเป็น data URL ของ JPG/PNG/WebP/GIF');
    const raw = atob(m[2]); const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('รูปใน JSON ใหญ่กว่า 5 MB');
    const ext = m[1].split('/')[1].replace('jpeg','jpg');
    return new File([bytes], filename || `product.${ext}`, { type: m[1] });
  }
  function imageFileIndex(files) {
    const map = new Map();
    for (const f of files || []) {
      const base = f.name.replace(/\.[^.]+$/, '').toLowerCase();
      if (!map.has(base)) map.set(base, f);
    }
    return map;
  }
  async function uploadImageForProduct(p, imageFiles, sourceStoreId) {
    let file = null;
    if (p.imageDataUrl) file = dataUrlToFile(p.imageDataUrl, p.imageFileName || `${safeFilename(p.id)}.jpg`);
    if (!file && p.imageFileName && imageFiles.has(p.imageFileName.replace(/\.[^.]+$/, '').toLowerCase())) file = imageFiles.get(p.imageFileName.replace(/\.[^.]+$/, '').toLowerCase());
    if (!file) {
      const keys = [p.id, ...list(p.variants).flatMap(v => [v.barcode, v.sku, v.id])].map(x => clean(x).toLowerCase()).filter(Boolean);
      for (const key of keys) if (imageFiles.has(key)) { file = imageFiles.get(key); break; }
    }
    if (!file) {
      // Storage paths are private and project-specific. Only preserve them when source and destination stores match.
      const currentStore = clean(localStorage.getItem('POS_STORE_ID'));
      if (p.imageStoragePath && sourceStoreId && sourceStoreId === currentStore) return { imageUrl: p.imageUrl || '', imageStoragePath: p.imageStoragePath };
      return { imageUrl: p.imageUrl || '', imageStoragePath: '' };
    }
    if (typeof window.uploadProductImageToSupabase !== 'function') throw new Error('ไม่มีฟังก์ชันอัปโหลดรูป Supabase');
    const safeFile = await readImageFile(file);
    const uploaded = await window.uploadProductImageToSupabase(safeFile, p.id);
    return { imageUrl: uploaded.url || '', imageStoragePath: uploaded.path || '' };
  }
  function matchProduct(existingProducts, incoming) {
    if (existingProducts[incoming.id]) return existingProducts[incoming.id];
    const barcodeSet = new Set(list(incoming.variants).map(v => clean(v.barcode)).filter(Boolean));
    if (barcodeSet.size) {
      for (const p of Object.values(existingProducts)) if (list(p.variants).some(v => barcodeSet.has(clean(v.barcode)))) return p;
    }
    const skuSet = new Set(list(incoming.variants).map(v => clean(v.sku).toLowerCase()).filter(Boolean));
    if (skuSet.size) {
      for (const p of Object.values(existingProducts)) if (list(p.variants).some(v => skuSet.has(clean(v.sku).toLowerCase()))) return p;
    }
    return null;
  }
  function existingCatalogConflicts(products) {
    const existing = currentDb()?.products || {};
    const barcodeOwners = new Map(), skuOwners = new Map();
    for (const p of Object.values(existing)) for (const v of list(p.variants)) {
      const barcode = clean(v.barcode), sku = clean(v.sku).toLowerCase();
      if (barcode && !barcodeOwners.has(barcode)) barcodeOwners.set(barcode, p.id);
      if (sku && !skuOwners.has(sku)) skuOwners.set(sku, p.id);
    }
    const errors = [];
    for (const p of products) {
      const match = matchProduct(existing, p);
      for (const v of list(p.variants)) {
        const barcode = clean(v.barcode), sku = clean(v.sku).toLowerCase();
        if (barcodeOwners.has(barcode) && barcodeOwners.get(barcode) !== match?.id) errors.push(`บาร์โค้ด ${barcode} ของ ${p.name} ถูกใช้กับสินค้าเดิมแล้ว`);
        if (skuOwners.has(sku) && skuOwners.get(sku) !== match?.id) errors.push(`SKU ${v.sku} ของ ${p.name} ถูกใช้กับสินค้าเดิมแล้ว`);
      }
    }
    return [...new Set(errors)];
  }

  function mergeProduct(existing, incoming, options = {}) {
    const target = existing || {};
    const id = existing?.id || incoming.id || newId('P-');
    const priorVariants = list(target.variants);
    const variants = [];
    for (const iv of list(incoming.variants)) {
      const old = priorVariants.find(v => (iv.id && v.id === iv.id) || (iv.barcode && clean(v.barcode) === clean(iv.barcode)) || (iv.sku && clean(v.sku) === clean(iv.sku)));
      const variantId = old?.id || (iv.id && !Object.values(currentDb().products || {}).some(p => list(p.variants).some(v => v.id === iv.id)) ? iv.id : newId('V-'));
      variants.push({
        ...(old || {}), ...iv, id: variantId,
        stock: options.importStock ? number(iv.stock, 0) : number(old?.stock, 0),
        currentCost: number(iv.currentCost ?? old?.currentCost ?? iv.cost, number(iv.cost)),
        lastCost: number(iv.lastCost ?? old?.lastCost ?? iv.cost, number(iv.cost)),
        fractions: list(iv.fractions).map(f => {
          const oldFraction = list(old?.fractions).find(of => (f.id && of.id === f.id) || clean(of.fractionName).toLowerCase() === clean(f.fractionName).toLowerCase());
          return { ...(oldFraction || {}), ...f, id: oldFraction?.id || (f.id && !priorVariants.some(pv => list(pv.fractions).some(of => of.id === f.id)) ? f.id : newId('F-')) };
        })
      });
    }
    return {
      ...target, ...incoming, id, name: incoming.name,
      cat: Array.isArray(incoming.cat) ? incoming.cat : list(target.cat),
      groupName: incoming.groupName ?? target.groupName ?? '',
      image: incoming.image || target.image || '📦', imageUrl: incoming.imageUrl || target.imageUrl || '',
      imageStoragePath: incoming.imageStoragePath || target.imageStoragePath || '',
      isDeleted: incoming.isDeleted === true, variants
    };
  }
  async function syncCatalogToCloud(importedProducts, importStock) {
    if (typeof window.syncProductsToSupabase !== 'function') return { synced: false, stockApplied: 0, note: 'ไม่พบตัวเชื่อมซิงค์สินค้า' };
    await window.syncProductsToSupabase(true);
    if (!importStock) return { synced: true, stockApplied: 0 };
    const c = typeof window.getSupabaseClient === 'function' ? window.getSupabaseClient() : null;
    if (!c) return { synced: true, stockApplied: 0, note: 'ไม่ได้เชื่อมต่อคลาวด์ จึงยังไม่ได้อัปเดตสต็อกบนคลาวด์' };
    const { data: storeData, error: storeError } = await c.rpc('get_my_store');
    if (storeError) throw storeError;
    const store = Array.isArray(storeData) ? storeData[0] : storeData;
    if (!store?.store_id) throw new Error('ไม่พบร้านปัจจุบันบน Supabase');
    let applied = 0;
    for (const p of importedProducts) for (const v of list(p.variants)) {
      const { data: row, error } = await c.from('product_variants').select('id').eq('store_id', store.store_id).eq('local_id', v.id).maybeSingle();
      if (error) throw error;
      if (!row?.id) continue;
      const { error: setError } = await c.rpc('set_variant_stock', { p_variant_id: row.id, p_new_stock: number(v.stock), p_note: 'นำเข้าสินค้าจากไฟล์ SmartPOS catalog' });
      if (setError) throw setError;
      applied++;
    }
    return { synced: true, stockApplied: applied };
  }

  async function importCatalog(parsed, options = {}) {
    const db = currentDb(); if (!db) throw new Error('ไม่พบฐานข้อมูล POS');
    const errors = [];
    let incoming = parsed.products;
    if (parsed.isCsvRows) incoming = parseCsvProducts(incoming, errors);
    else incoming = incoming.map((p, i) => normalizeJsonProduct(p, i + 1, errors)).filter(Boolean);
    errors.push(...validateProducts(incoming));
    if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 100), totalErrors: errors.length };

    const imageFiles = imageFileIndex(options.imageFiles || []);
    const original = clone(db.products || {}), originalCats = clone(db.categories || []);
    const imported = [], imageErrors = [], usedBarcodes = new Map();
    for (const p of Object.values(original)) for (const v of list(p.variants)) if (clean(v.barcode)) usedBarcodes.set(clean(v.barcode), { productId: p.id, variantId: v.id });
    // Reject collisions with existing products unless they resolve to that same matched record.
    for (const p of incoming) {
      const match = matchProduct(original, p);
      for (const v of list(p.variants)) {
        const code = clean(v.barcode); if (!code || !usedBarcodes.has(code)) continue;
        const owner = usedBarcodes.get(code);
        if (!match || owner.productId !== match.id) return { ok: false, errors: [`บาร์โค้ด ${code} ถูกใช้กับสินค้าเดิม (${original[owner.productId]?.name || owner.productId}) แล้ว`], totalErrors: 1 };
      }
      for (const v of list(p.variants)) {
        const sku = clean(v.sku).toLowerCase(); if (!sku) continue;
        const owner = Object.values(original).find(product => list(product.variants).some(existingVariant => clean(existingVariant.sku).toLowerCase() === sku));
        if (owner && (!match || owner.id !== match.id)) return { ok: false, errors: [`SKU ${v.sku} ถูกใช้กับสินค้าเดิม (${owner.name || owner.id}) แล้ว`], totalErrors: 1 };
      }
    }
    // Create/merge category names before products; category IDs are retained for existing names.
    const catByName = new Map(list(db.categories).map(c => [clean(c.name).toLowerCase(), c]));
    const importedCategoryNames = list(parsed.categories).map(c => typeof c === 'string' ? c : c?.name).map(clean).filter(Boolean);
    for (const name of [...importedCategoryNames, ...incoming.flatMap(p => list(p.cat))]) {
      const key = clean(name).toLowerCase(); if (!key || catByName.has(key)) continue;
      const c = { id: newId('CAT-'), name: clean(name) }; db.categories.push(c); catByName.set(key, c);
    }
    try {
      for (const p of incoming) {
        const match = matchProduct(original, p);
        const candidate = mergeProduct(match, p, { importStock: !!options.importStock });
        try {
          const image = await uploadImageForProduct(p, imageFiles, parsed.sourceStoreId);
          candidate.imageUrl = image.imageUrl || candidate.imageUrl || '';
          candidate.imageStoragePath = image.imageStoragePath || '';
        } catch (e) {
          imageErrors.push(`${p.name}: ${e.message || e}`);
          if (p.imageDataUrl || p.imageFileName) throw new Error(`อัปโหลดรูปของ ${p.name} ไม่สำเร็จ: ${e.message || e}`);
        }
        // If a barcode/SKU match identifies a product with another ID, preserve the existing product ID.
        candidate.id = match?.id || candidate.id;
        db.products[candidate.id] = candidate;
        imported.push(candidate);
        if (typeof options.onProgress === 'function') options.onProgress(imported.length, incoming.length, p.name);
      }
      if (typeof window.persist === 'function') window.persist();
      if (typeof window.renderStock === 'function') window.renderStock();
      if (typeof window.renderSaleHome === 'function') window.renderSaleHome();
      let cloud = { synced: false, stockApplied: 0, note: 'นำเข้าในเครื่องแล้ว ยังไม่ได้ซิงค์คลาวด์' };
      if (options.syncCloud && typeof window.syncProductsToSupabase === 'function') {
        try { cloud = await syncCatalogToCloud(imported, !!options.importStock); }
        catch (e) { cloud = { synced: false, stockApplied: 0, note: `บันทึกในเครื่องแล้ว แต่ซิงค์คลาวด์ไม่ครบ: ${e.message || e}` }; }
      }
      return { ok: true, products: imported.length, categories: db.categories.length - originalCats.length, images: imported.filter(p => p.imageStoragePath).length, imageErrors, cloud };
    } catch (e) {
      db.products = original; db.categories = originalCats;
      if (typeof window.persist === 'function') window.persist();
      if (typeof window.renderStock === 'function') window.renderStock();
      return { ok: false, errors: [e.message || String(e)], totalErrors: 1, imageErrors };
    }
  }

  // Public API for automation or custom UI.
  window.exportProductCatalogJSON = exportJson;
  window.exportProductCatalogCSV = exportCsv;
  window.downloadProductImportTemplate = exportTemplate;
  window.downloadProductImportErrorReport = downloadImportErrorReport;
  window.previewProductCatalogCSV = function(text) { const rows = parseCsv(text); return analyzeCsvRows(rows); };
  window.importProductCatalogFile = async function(file, options = {}) {
    if (!file) throw new Error('กรุณาเลือกไฟล์');
    const text = await file.text();
    if (/\.csv$/i.test(file.name) || file.type.includes('csv')) {
      const rows = parseCsv(text), analysis = analyzeCsvRows(rows);
      const continueValid = options.continueValidProducts === true || options.skipInvalidRows === true;
      if (analysis.errors.length && !continueValid) return { ok: false, errors: analysis.errors.slice(0, 100), totalErrors: analysis.errors.length, errorRows: analysis.errorRows, validProducts: analysis.validProducts, invalidProducts: analysis.invalidProducts };
      if (!analysis.products.length) return { ok: false, errors: analysis.errors.length ? analysis.errors.slice(0, 100) : ['ไม่พบสินค้าที่ผ่านการตรวจสอบ'], totalErrors: analysis.errors.length, errorRows: analysis.errorRows, validProducts: 0, invalidProducts: analysis.invalidProducts };
      const result = await importCatalog({ products: analysis.products, categories: [], sourceStoreId: clean(rows[0]?.source_store_id) }, options);
      return { ...result, importErrors: analysis.errors.slice(0, 100), totalErrors: analysis.errors.length, errorRows: analysis.errorRows, validProducts: analysis.validProducts, invalidProducts: analysis.invalidProducts };
    }
    let parsed;
    try { parsed = parseJsonCatalog(JSON.parse(text)); } catch (e) { throw new Error('อ่าน JSON ไม่สำเร็จ: ' + (e.message || e)); }
    return importCatalog(parsed, options);
  };

  function ensureStyles() {
    if ($('#smartpos-catalog-io-style')) return;
    const style = document.createElement('style'); style.id = 'smartpos-catalog-io-style';
    style.textContent = `#smartpos-catalog-io-modal{position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:14px;font-family:inherit}#smartpos-catalog-io-modal.open{display:flex}#smartpos-catalog-io-modal .spio-card{background:#fff;color:#0f172a;border-radius:18px;width:min(760px,100%);max-height:92vh;overflow:auto;box-shadow:0 24px 80px #0003}#smartpos-catalog-io-modal .spio-btn{border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;font-weight:700;background:#fff;cursor:pointer}#smartpos-catalog-io-modal .spio-primary{background:#0f766e;border-color:#0f766e;color:#fff}#smartpos-catalog-io-modal .spio-muted{color:#64748b;font-size:12px}#smartpos-catalog-io-modal label{font-size:13px;font-weight:600}#smartpos-catalog-io-modal input[type=file]{display:block;width:100%;padding:8px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc}#smartpos-catalog-io-modal .spio-result{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;font-size:12px;max-height:180px;overflow:auto}#smartpos-catalog-io-trigger{border:0;border-radius:999px;background:#0f766e;color:#fff;padding:10px 14px;font:700 13px inherit;box-shadow:0 5px 18px #0f172a30;cursor:pointer;z-index:9000}#smartpos-catalog-io-trigger:hover{background:#115e59}`;
    document.head.appendChild(style);
  }
  function openModal() { const m = $('#smartpos-catalog-io-modal'); if (m) { m.classList.add('open'); m.setAttribute('aria-hidden','false'); } }
  function closeModal() { const m = $('#smartpos-catalog-io-modal'); if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden','true'); } }
  function initUI() {
    if (!document.body || $('#smartpos-catalog-io-modal')) return;
    ensureStyles();
    const modal = document.createElement('div'); modal.id = 'smartpos-catalog-io-modal'; modal.setAttribute('aria-hidden','true');
    modal.innerHTML = `<div class="spio-card" role="dialog" aria-modal="true" aria-labelledby="spio-title"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding:18px 20px;border-bottom:1px solid #e2e8f0"><div><h2 id="spio-title" style="font-size:19px;font-weight:800;margin:0">นำเข้า / ส่งออกสินค้า</h2><p class="spio-muted" style="margin:4px 0 0">สินค้า • หลายขนาด • บาร์โค้ด • ทุน/ขาย • หน่วยแบ่งขาย • หมวดหมู่ • รูปภาพ</p></div><button type="button" class="spio-btn" data-spio-close aria-label="ปิด">✕</button></div><div style="padding:18px 20px;display:grid;gap:18px"><section style="border:1px solid #e2e8f0;border-radius:14px;padding:14px"><h3 style="font-weight:800;margin:0 0 10px">ส่งออกข้อมูล</h3><div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="spio-btn spio-primary" data-spio-export-json>JSON ครบชุด</button><button type="button" class="spio-btn" data-spio-export-csv>CSV / Excel</button><button type="button" class="spio-btn" data-spio-template>ดาวน์โหลดแม่แบบ</button></div><div style="display:grid;gap:7px;margin-top:12px"><label><input id="spio-embed-images" type="checkbox" checked> ฝังไฟล์รูปใน JSON (เหมาะสำหรับย้ายไปอีกร้าน)</label><label><input id="spio-export-stock" type="checkbox" checked> ส่งออกจำนวนสต็อกด้วย</label></div><p class="spio-muted" style="margin:9px 0 0">JSON เหมาะสำหรับสำรอง/ย้ายข้อมูลพร้อมรูป ส่วน CSV เปิดแก้ใน Excel ได้ รูปใน CSV จะอ้างอิง URL หรือชื่อไฟล์เท่านั้น</p></section><section style="border:1px solid #e2e8f0;border-radius:14px;padding:14px"><h3 style="font-weight:800;margin:0 0 10px">นำเข้าสินค้า</h3><label for="spio-import-file">ไฟล์สินค้า (.json หรือ .csv)</label><input id="spio-import-file" type="file" accept=".json,.csv,application/json,text/csv" style="margin-top:5px"><label for="spio-image-files" style="display:block;margin-top:12px">ไฟล์รูปสินค้าเพิ่มเติม (เลือกหลายไฟล์ได้)</label><input id="spio-image-files" type="file" accept="image/jpeg,image/png,image/webp" multiple style="margin-top:5px"><p class="spio-muted" style="margin:7px 0 0">ตั้งชื่อรูปให้ตรงกับ product_id, variant_id, barcode หรือ SKU เช่น 8850000000000.jpg หรือ P-123.jpg</p><div style="display:grid;gap:7px;margin-top:12px"><label><input id="spio-import-stock" type="checkbox"> นำเข้าสต็อกด้วย (ต้องมีสิทธิ์เจ้าของร้าน/ผู้จัดการ; ระบบจะบันทึกประวัติปรับสต็อก)</label><label><input id="spio-sync-cloud" type="checkbox" checked> ซิงค์รายการสินค้าไป Supabase หลังนำเข้า</label><label><input id="spio-valid-only" type="checkbox"> นำเข้าเฉพาะสินค้าที่ผ่านการตรวจสอบ และข้ามสินค้าที่มีข้อผิดพลาด</label></div><div id="spio-preview" class="spio-result" style="margin-top:12px">เลือกไฟล์เพื่อดูตัวอย่างและตรวจสอบก่อนนำเข้า</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button type="button" id="spio-import-go" class="spio-btn spio-primary" disabled>ตรวจสอบและนำเข้า</button><button type="button" id="spio-error-report" class="spio-btn" disabled>ดาวน์โหลดรายงานข้อผิดพลาด</button><button type="button" class="spio-btn" data-spio-close>ปิด</button></div></section><p class="spio-muted" style="margin:0">ความปลอดภัย: การนำเข้าเป็นแบบรวมข้อมูล ไม่ลบสินค้าที่ไม่มีในไฟล์โดยอัตโนมัติ สต็อกจะไม่ถูกเขียนทับเว้นแต่เลือกตัวเลือกด้านบน</p></div></div>`;
    document.body.appendChild(modal);
    const trigger = document.createElement('button'); trigger.id = 'smartpos-catalog-io-trigger'; trigger.type = 'button'; trigger.textContent = '⇅ นำเข้า/ส่งออกสินค้า'; trigger.title = 'นำเข้าและส่งออกข้อมูลสินค้า'; trigger.style.position = 'fixed'; trigger.style.right = '14px'; trigger.style.bottom = '18px'; trigger.style.fontFamily = 'inherit'; trigger.style.fontWeight = '700'; trigger.style.fontSize = '13px';
    document.body.appendChild(trigger);
    trigger.addEventListener('click', openModal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-spio-close]')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    $('[data-spio-export-json]', modal).addEventListener('click', async () => {
      try { const r = await exportJson({ embedImages: $('#spio-embed-images').checked, includeStock: $('#spio-export-stock').checked }); let msg = `ส่งออกแล้ว ${r.products} สินค้า • ฝังรูปได้ ${r.images} รูป`; if (r.imageErrors.length) msg += `\nรูปที่ฝังไม่ได้ ${r.imageErrors.length} รายการ (URL/Storage path ยังอยู่ในข้อมูล)\n` + r.imageErrors.slice(0, 10).join('\n'); notify('ส่งออก JSON สำเร็จ', msg); }
      catch (e) { notify('ส่งออกไม่สำเร็จ', e.message || String(e), true); }
    });
    $('[data-spio-export-csv]', modal).addEventListener('click', () => { try { const r = exportCsv({ includeStock: $('#spio-export-stock').checked }); toast(`ส่งออก CSV แล้ว ${r.products} สินค้า ${r.rows} แถว`); } catch (e) { notify('ส่งออกไม่สำเร็จ', e.message || String(e), true); } });
    $('[data-spio-template]', modal).addEventListener('click', exportTemplate);
    let selectedFile = null, parsedPreview = null;
    const importInput = $('#spio-import-file', modal), preview = $('#spio-preview', modal), go = $('#spio-import-go', modal);
    const validOnly = $('#spio-valid-only', modal), errorReport = $('#spio-error-report', modal);
    let importBusy = false;
    const updateImportButton = () => {
      const hasValid = !!parsedPreview && !parsedPreview.imported && (parsedPreview.kind === 'csv' ? parsedPreview.analysis.validProducts > 0 : parsedPreview.products.length > 0);
      const hasErrors = !!parsedPreview && parsedPreview.errors.length > 0;
      go.disabled = importBusy || !hasValid || (hasErrors && !validOnly.checked);
      errorReport.disabled = importBusy || !parsedPreview || !parsedPreview.errorRows?.length;
    };
    validOnly.addEventListener('change', updateImportButton);
    errorReport.addEventListener('click', () => downloadImportErrorReport(parsedPreview?.errorRows || []));
    importInput.addEventListener('change', async () => {
      selectedFile = importInput.files?.[0] || null; parsedPreview = null; updateImportButton();
      if (!selectedFile) { preview.textContent = 'เลือกไฟล์เพื่อดูตัวอย่างและตรวจสอบก่อนนำเข้า'; return; }
      try {
        const text = await selectedFile.text();
        if (/\.csv$/i.test(selectedFile.name) || selectedFile.type.includes('csv')) {
          const rows = parseCsv(text), analysis = analyzeCsvRows(rows);
          parsedPreview = { file: selectedFile, kind: 'csv', rows, products: analysis.products, errors: analysis.errors, errorRows: analysis.errorRows, analysis, sourceStoreId: clean(rows[0]?.source_store_id) };
        } else {
          const parsed = parseJsonCatalog(JSON.parse(text));
          const rowErrors = [], goodProducts = [], errorRows = [];
          parsed.products.forEach((raw, i) => {
            const localErrors = [], product = normalizeJsonProduct(raw, i + 1, localErrors);
            const validationErrors = product ? validateProducts([product]) : [];
            const productErrors = [...localErrors, ...validationErrors];
            if (productErrors.length || !product) {
              errorRows.push({ __row: i + 1, product_id: clean(raw?.id ?? raw?.product_id), product_name: clean(raw?.name ?? raw?.product_name), import_error: productErrors.join(' | ') || 'ข้อมูลสินค้าไม่ถูกต้อง', raw_json: JSON.stringify(raw) });
            } else goodProducts.push(product);
          });
          // Detect IDs, barcodes and SKUs duplicated across JSON products; mark every conflicting product.
          const keyMaps = [new Map(), new Map(), new Map()];
          goodProducts.forEach((p, i) => {
            const add = (map, key) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(i); };
            add(keyMaps[0], `product:${clean(p.id)}`);
            for (const v of list(p.variants)) {
              if (clean(v.barcode)) add(keyMaps[1], `barcode:${clean(v.barcode)}`);
              if (clean(v.sku)) add(keyMaps[2], `sku:${clean(v.sku).toLowerCase()}`);
            }
          });
          const badIndices = new Map();
          for (const [mapIndex, map] of keyMaps.entries()) for (const [key, indices] of map) if (indices.length > 1) {
            const kind = ['รหัสสินค้า','บาร์โค้ด','SKU'][mapIndex];
            indices.forEach(i => { if (!badIndices.has(i)) badIndices.set(i, new Set()); badIndices.get(i).add(`${kind} ซ้ำ (${key.split(':').slice(1).join(':')}) ใน JSON`); });
          }
          goodProducts.forEach((p, i) => {
            for (const message of existingCatalogConflicts([p])) {
              if (!badIndices.has(i)) badIndices.set(i, new Set());
              badIndices.get(i).add(message);
            }
          });
          const validProducts = goodProducts.filter((p, i) => !badIndices.has(i));
          for (const [i, messages] of badIndices) errorRows.push({ __row: i + 1, product_id: goodProducts[i].id, product_name: goodProducts[i].name, import_error: [...messages].join(' | '), raw_json: JSON.stringify(goodProducts[i]) });
          parsedPreview = { file: selectedFile, kind: 'json', products: validProducts, errors: errorRows.map(e => e.import_error), errorRows, categories: parsed.categories || [], sourceStoreId: parsed.sourceStoreId || '', original: parsed };
        }
        const count = parsedPreview.products.length, variants = parsedPreview.products.reduce((n,p) => n + list(p.variants).length, 0), fractions = parsedPreview.products.reduce((n,p) => n + list(p.variants).reduce((m,v) => m + list(v.fractions).length, 0), 0);
        const total = parsedPreview.kind === 'csv' ? parsedPreview.analysis.totalRows : (parsedPreview.original?.products?.length || count + parsedPreview.errorRows.length);
        preview.textContent = `ไฟล์: ${selectedFile.name}\nแถวข้อมูล: ${total}\nสินค้าที่ผ่าน: ${count} • รุ่น/ขนาด: ${variants} • หน่วยแบ่งขาย: ${fractions}\nสินค้าที่ข้ามเพราะมีข้อผิดพลาด: ${parsedPreview.kind === 'csv' ? parsedPreview.analysis.invalidProducts : parsedPreview.errorRows.length}\n${parsedPreview.errors.length ? `พบข้อผิดพลาด ${parsedPreview.errors.length} รายการ ตัวอย่าง:\n${parsedPreview.errors.slice(0, 12).join('\n')}\nใช้ “ดาวน์โหลดรายงานข้อผิดพลาด” เพื่อแก้ไฟล์แล้วนำเข้าซ้ำ` : 'ตรวจสอบผ่าน พร้อมนำเข้า'}${parsedPreview.kind === 'json' ? `\nรูปฝังในไฟล์: ${parsedPreview.products.filter(p => p.imageDataUrl).length} รูป` : ''}`;
      } catch (e) { preview.textContent = `อ่านไฟล์ไม่สำเร็จ: ${e.message || e}`; parsedPreview = null; }
      updateImportButton();
    });
    go.addEventListener('click', async () => {
      if (!selectedFile || !parsedPreview || go.disabled) return;
      importBusy = true; updateImportButton(); go.textContent = 'กำลังนำเข้า...';
      try {
        const parsed = { products: parsedPreview.products, categories: parsedPreview.categories || [], sourceStoreId: parsedPreview.sourceStoreId || '' };
        const result = await importCatalog(parsed, { imageFiles: $('#spio-image-files').files, importStock: $('#spio-import-stock').checked, syncCloud: $('#spio-sync-cloud').checked, onProgress: (done, total, name) => { preview.textContent = `กำลังนำเข้า ${done}/${total} สินค้า\n${name || ''}\nกรุณาอย่าปิดหน้าต่างนี้`; } });
        if (!result.ok) { preview.textContent = `นำเข้าไม่สำเร็จ:\n${(result.errors || []).join('\n')}`; notify('นำเข้าไม่สำเร็จ', (result.errors || []).join('\n'), true); return; }
        const lines = [`นำเข้าสำเร็จ ${result.products} สินค้า`, `เพิ่มหมวดหมู่ ${result.categories} รายการ`, `มีรูปใน Storage ${result.images} รายการ`, result.cloud?.synced ? 'ซิงค์สินค้าไป Supabase แล้ว' : (result.cloud?.note || 'บันทึกในเครื่องแล้ว')];
        if (result.cloud?.stockApplied) lines.push(`ตั้งสต็อกบนคลาวด์ ${result.cloud.stockApplied} รุ่น`);
        if (parsedPreview.errors.length) lines.push(`ข้ามรายการผิดพลาด ${parsedPreview.errorRows.length} แถว/รายการ โปรดดาวน์โหลดรายงานข้อผิดพลาดเพื่อแก้แล้วนำเข้าซ้ำ`);
        if (result.imageErrors?.length) lines.push(`ปัญหารูป ${result.imageErrors.length} รายการ:\n${result.imageErrors.slice(0, 10).join('\n')}`);
        preview.textContent = lines.join('\n'); notify('นำเข้าสินค้าเสร็จแล้ว', lines.join('\n'), !!result.imageErrors?.length);
        selectedFile = null; importInput.value = '';
        if (parsedPreview.errors.length) { parsedPreview.imported = true; preview.textContent += '\n\nยังเก็บรายงานข้อผิดพลาดไว้ให้ดาวน์โหลดด้านบน'; }
        else parsedPreview = null;
        go.disabled = true; go.textContent = 'ตรวจสอบและนำเข้า';
      } catch (e) { preview.textContent = `นำเข้าไม่สำเร็จ: ${e.message || e}`; notify('นำเข้าไม่สำเร็จ', e.message || String(e), true); }
      finally { importBusy = false; updateImportButton(); go.textContent = 'ตรวจสอบและนำเข้า'; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI, { once: true }); else initUI();
})();
