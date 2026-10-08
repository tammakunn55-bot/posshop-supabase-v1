// Service worker: ให้แอปเปิดได้เมื่อออฟไลน์ (หน้าแอป + ไลบรารีจาก CDN ที่ล็อกเวอร์ชันไว้)
// ไม่แคช API ของ Supabase / PromptPay — ข้อมูลธุรกรรมอยู่ใน localStorage + คิวซิงค์ของแอปอยู่แล้ว
const VERSION = 'pos-v10-1';
const CDN = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4'
];
const CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled([
      cache.add('./'),
      ...CDN.map(async (u) => { const r = await fetch(u, { mode: 'no-cors' }); await cache.put(u, r); })
    ]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN_HOSTS.includes(url.hostname)) {          // ไลบรารีล็อกเวอร์ชัน: cache-first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r;
    })));
    return;
  }
  if (url.origin === location.origin) {            // ตัวแอป: network-first (ได้เวอร์ชันล่าสุดเมื่อออนไลน์) แล้วถอยไปใช้แคช
    e.respondWith(fetch(req).then((r) => {
      const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
  }
});
