import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const errors = [];
const warnings = [];
const exists = (p) => fs.existsSync(path.join(root, p));

if (!exists('index.html')) errors.push('ไม่พบ index.html ที่ root ของ repository');

if (exists('index.html')) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  for (const ref of refs) {
    if (/^(?:https?:|data:|#|mailto:|javascript:)/i.test(ref)) continue;
    const clean = decodeURIComponent(ref.split(/[?#]/)[0]);
    if (!fs.existsSync(path.join(root, clean))) errors.push(`ไฟล์ที่ index.html อ้างถึงไม่มีอยู่: ${ref}`);
  }
  if (!/src=["']js\/app\.js["']/.test(html)) warnings.push('ไม่พบการโหลด js/app.js ใน index.html; ตรวจสอบ entry point ด้วยตนเอง');
}

const jsDirs = ['js', 'supabase-v4-upgrade'];
let checked = 0;
for (const dir of jsDirs) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(dir, name);
    try {
      execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe' });
      checked++;
    } catch (err) {
      errors.push(`JavaScript syntax error: ${file}\n${String(err.stderr || err.stdout || err.message)}`);
    }
  }
}

const app = exists('js/app.js') ? fs.readFileSync(path.join(root, 'js/app.js'), 'utf8') : '';
if (/SUPABASE_URL_DEFAULT\s*=\s*["']https:\/\//.test(app)) {
  warnings.push('js/app.js มี Supabase URL/anon key ค่าเริ่มต้นฝังอยู่ ตรวจว่าเป็นโปรเจกต์ของคุณและตั้งค่า RLS ก่อนเผยแพร่; ห้ามใช้ service_role key ฝั่งเว็บ');
}

console.log(`ตรวจ JavaScript ผ่าน ${checked} ไฟล์`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log('ผ่านการตรวจโครงสร้างไฟล์และไวยากรณ์เบื้องต้น');
