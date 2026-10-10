/* js/supabase-integration.js */
// ==========================================
// SUPABASE INTEGRATION (With Conflict Resolution, Force Sync & Granular Tables)
// ==========================================
// Requires the Supabase JS client loaded first via CDN in index.html:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>

// ⚠️ ไม่ควรใส่ Project URL / anon key จริงเป็นค่าเริ่มต้นตรงนี้ — ถ้ามีคนคัดลอกไฟล์นี้ไปใช้
// (fork repo, โคลนโค้ด ฯลฯ) โดยไม่รู้ตัวจะเชื่อมต่อกับฐานข้อมูลจริงของเจ้าของเดิมทันทีโดยไม่ได้ตั้งใจ
// ปล่อยว่างไว้ แล้วบังคับให้ตั้งค่าเองก่อนใช้งานครั้งแรกทุกเครื่อง/ทุกคนที่นำไฟล์นี้ไปใช้
const SUPABASE_URL_DEFAULT = "";
const SUPABASE_ANON_KEY_DEFAULT = "";
// SECURITY: Never place service_role, sb_secret, real passwords, customer data, sales data,
// backups, or uploaded documents in this source file. Public source may contain only the anon key.

const SUPABASE_URL_STORAGE_KEY = 'pos_supabase_url';
const SUPABASE_KEY_STORAGE_KEY = 'pos_supabase_anon_key';

function getAccountScopedKey(base, accountId = null) {
  const id = String(accountId || localStorage.getItem('POS_ACCOUNT_ID') || '').trim().toLowerCase();
  return id ? `${base}::${id}` : base;
}
function readFirstLocalStorage(keys) {
  for (const key of keys) {
    try {
      const value = String(localStorage.getItem(key) || '').trim();
      if (value) return value;
    } catch (_) {}
  }
  return '';
}
function getConfiguredSupabaseUrl(accountId = null) {
  const scopedKey = getAccountScopedKey(SUPABASE_URL_STORAGE_KEY, accountId);
  const scoped = readFirstLocalStorage([scopedKey]);
  if (scoped) return scoped.replace(/\/$/, '');
  // Backward compatibility: older Smart POS builds stored the same public
  // project config without an account suffix. Reuse it and migrate it to the
  // current account namespace instead of falsely reporting "cloud disconnected".
  const legacy = readFirstLocalStorage([
    SUPABASE_URL_STORAGE_KEY,
    'POS_SUPABASE_URL',
    'SUPABASE_URL',
    'supabase_url'
  ]);
  if (legacy && accountId) {
    try { localStorage.setItem(scopedKey, legacy.replace(/\/$/, '')); } catch (_) {}
  }
  return legacy.replace(/\/$/, '');
}
function getConfiguredSupabaseAnonKey(accountId = null) {
  const scopedKey = getAccountScopedKey(SUPABASE_KEY_STORAGE_KEY, accountId);
  const scoped = readFirstLocalStorage([scopedKey]);
  if (scoped) return scoped;
  const legacy = readFirstLocalStorage([
    SUPABASE_KEY_STORAGE_KEY,
    'POS_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_KEY',
    'supabase_anon_key'
  ]);
  if (legacy && accountId) {
    try { localStorage.setItem(scopedKey, legacy); } catch (_) {}
  }
  return legacy;
}
function setConfiguredSupabase(url, key, accountId = null) {
  const cleanUrl = String(url || '').trim().replace(/\/$/, '');
  const cleanKey = String(key || '').trim();
  localStorage.setItem(getAccountScopedKey(SUPABASE_URL_STORAGE_KEY, accountId), cleanUrl);
  localStorage.setItem(getAccountScopedKey(SUPABASE_KEY_STORAGE_KEY, accountId), cleanKey);
}

// v2.2: one Supabase project/database is one store.
function getStoreFingerprint(url) { try { return new URL(String(url||'')).hostname.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,40); } catch(e) { return ''; } }
function getCurrentStoreFingerprint() { return String(localStorage.getItem('POS_STORE_FINGERPRINT')||'').trim(); }

// Supabase Auth password is NEVER persisted locally.
// Reconnection relies on the normal Supabase Auth session; if the session expires,
// the user must authenticate again.

window.completeFirstTimeSetup = async function () {
  const storeName = document.getElementById('setup-store-name')?.value.trim() || '';
  const ownerEmail = document.getElementById('setup-owner-email')?.value.trim().toLowerCase() || '';
  const urlInput = document.getElementById('setup-supabase-url')?.value.trim() || '';
  const keyInput = document.getElementById('setup-supabase-key')?.value.trim() || '';
  const password = document.getElementById('setup-user-password')?.value || '';
  const passwordConfirm = document.getElementById('setup-user-password-confirm')?.value || '';

  if (!storeName) return alert('กรุณาระบุชื่อร้าน');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return alert('กรุณากรอกอีเมลเจ้าของร้านให้ถูกต้อง');
  if (password.length < 8) return alert('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (password !== passwordConfirm) return alert('รหัสผ่านยืนยันไม่ตรงกัน');

  let client = null;
  try {
    const url = String(urlInput || getConfiguredSupabaseUrl() || SUPABASE_URL_DEFAULT || '').trim().replace(/\/$/, '');
    const key = String(keyInput || getConfiguredSupabaseAnonKey() || SUPABASE_ANON_KEY_DEFAULT || '').trim();

    if (!url || !key) return alert('กรุณากรอก Supabase Project URL และ Publishable/anon key');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return alert('Supabase Project URL ไม่ถูกต้อง');
    if (/service_role|sb_secret|postgres(ql)?:\/\/|password\s*=/i.test(key)) return alert('ค่าที่กรอกมีลักษณะเป็น Secret/Database credential ซึ่งห้ามใช้ใน Frontend');

    // Runtime-only configuration: never written to source files or GitHub.
    setConfiguredSupabase(url, key, ownerEmail);
    localStorage.setItem('POS_ACCOUNT_ID', ownerEmail);

    client = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    _supabaseClient = client;

    const authResult = await client.auth.signUp({
      email: ownerEmail,
      password,
      options: {
        data: { username: ownerEmail, full_name: storeName + ' เจ้าของร้าน', store_name: storeName }
      }
    });

    if (authResult.error) {
      // If the account already exists, sign in rather than creating a duplicate.
      const signIn = await client.auth.signInWithPassword({ email: ownerEmail, password });
      if (signIn.error || !signIn.data?.user) {
        throw new Error('สร้าง/เข้าสู่ระบบ Supabase ไม่สำเร็จ: ' + (authResult.error.message || signIn.error?.message || 'ไม่ทราบสาเหตุ'));
      }
      authResult.data = signIn.data;
    }

    const user = authResult.data?.user;
    const session = authResult.data?.session;

    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + ownerEmail, ownerEmail);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', ownerEmail);
    if (user?.id) {
      localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + ownerEmail, user.id);
      localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', user.id);
    }

    if (!user) throw new Error('Supabase ไม่คืนข้อมูลผู้ใช้');

    // With email confirmation enabled Supabase may return a user without a session.
    // In that case store the pending store name and finish store creation after verification/login.
    let storeId = null;
    if (session) {
      const { data, error } = await client.rpc('create_store', { p_name: storeName, p_code: null });
      if (error) throw new Error('สร้างร้านบน Supabase ไม่สำเร็จ: ' + error.message);
      storeId = data;
    } else {
      localStorage.setItem('PENDING_STORE_NAME', storeName);
      localStorage.setItem('PENDING_OWNER_EMAIL', ownerEmail);
      alert('สร้างบัญชี Supabase แล้ว กรุณายืนยันอีเมลก่อน แล้วกลับมาเข้าสู่ระบบอีกครั้ง ระบบจะสร้างร้านให้อัตโนมัติ');
    }

    const accountId = ownerEmail;
    const freshDb = JSON.parse(JSON.stringify(DB_DEFAULT));
    freshDb.storeName = storeName;
    freshDb.storeId = storeId || '';
    freshDb.users = [{
      id: accountId,
      authUserId: user.id,
      name: storeName + ' เจ้าของร้าน',
      role: 'owner',
      email: ownerEmail,
      createdAt: new Date().toISOString()
    }];

    await localforage.removeItem(DB_KEY_BASE);
    await localforage.setItem(getAccountDbKey(accountId), freshDb);
    await localforage.setItem('POS_ACCOUNT_ID', accountId);
    await localforage.setItem('POS_FIRST_SETUP_DONE', true);

    localStorage.setItem('POS_ACCOUNT_ID', accountId);
    if (storeId) localStorage.setItem('POS_STORE_ID', storeId);
    setConfiguredSupabase(url, key, accountId);
    localStorage.removeItem(LAST_SYNCED_KEY);

    if (session && typeof window.finishFirstTimeSetupInMemory === 'function') {
      await window.finishFirstTimeSetupInMemory(accountId, ownerEmail);
      alert('สร้างร้าน "' + storeName + '" สำเร็จและเชื่อมต่อ Supabase แล้ว');
    } else if (typeof window.showLogin === 'function') {
      window.showLogin();
    }
  } catch (err) {
    console.error('First setup failed:', err);
    try { await client?.auth?.signOut?.(); } catch (_) {}
    alert('สร้างร้านไม่สำเร็จ: ' + (err?.message || err));
  }
};

// เชื่อมต่ออุปกรณ์เครื่องที่สอง (หรือเครื่องพนักงาน) เข้ากับร้านที่มีอยู่แล้วบนคลาวด์ แทนที่จะ
// สร้าง DB_DEFAULT ว่างๆ ทับ — ยืนยันตัวด้วยอีเมล/รหัสผ่านของ "เจ้าของร้าน" (คนเดียวที่ผูก
// Supabase Auth ไว้) หนึ่งครั้ง ดึง pos_state ฉบับเต็มมาเก็บเป็นฐานข้อมูลของเครื่องนี้ แล้วให้
// เครื่องนี้ล็อกอินด้วย PIN ของพนักงานแต่ละคนตามปกติในครั้งถัดๆ ไป (เหมือนเครื่องแรก)
window.ensureSupabaseAuthForCurrentAccount = async function(password = '', suppliedEmail = null) {
  try {
    const accountId = String(localStorage.getItem('POS_ACCOUNT_ID') || '').trim().toLowerCase();
    if (!accountId) return { ok: false, reason: 'missing_account' };
    const client = getSupabaseClient();
    if (!client) return { ok: false, reason: 'cloud_not_configured' };

    // IMPORTANT: if the owner is already authenticated, reuse the persisted
    // Supabase session. Never ask for the password or sign in again on every
    // POS start/action. Supabase Auth refreshes the session automatically.
    const existing = await client.auth.getSession();
    const existingUser = existing?.data?.session?.user || null;
    if (existingUser?.id) {
      const meta = existingUser.user_metadata || {};
      const rememberedAuthId = localStorage.getItem('POS_SUPABASE_AUTH_USER_ID::' + accountId) || localStorage.getItem('POS_SUPABASE_AUTH_USER_ID') || '';
      const sameAccount = !meta.username || String(meta.username).toLowerCase() === accountId;
      const sameRememberedUser = !rememberedAuthId || String(rememberedAuthId) === String(existingUser.id);
      if (sameAccount && sameRememberedUser) {
        localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, existingUser.id);
        localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', existingUser.id);
        if (existingUser.email) {
          localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, existingUser.email);
          localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', existingUser.email);
        }
        return { ok: true, user: existingUser, session: existing.data.session, reusedSession: true };
      }
    }

    // No usable remembered session: only now is a password required.
    if (!password) return { ok: false, reason: 'missing_credentials' };
    const email = String(suppliedEmail || localStorage.getItem('POS_SUPABASE_AUTH_EMAIL::' + accountId) || localStorage.getItem('POS_SUPABASE_AUTH_EMAIL') || '').trim().toLowerCase();
    if (!email) return { ok: false, reason: 'missing_email' };

    let result = await client.auth.signInWithPassword({ email, password });
    if (!result.error && result.data?.session) {
      const meta = result.data.user.user_metadata || {};
      if (meta.username && String(meta.username).toLowerCase() !== accountId) {
        await client.auth.signOut();
        return { ok: false, reason: 'บัญชี Supabase นี้ถูกผูกกับ User ID อื่น' };
      }
      localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, email);
      localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', email);
      localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, result.data.user.id);
      localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', result.data.user.id);
      return { ok: true, user: result.data.user, session: result.data.session };
    }

    // ถ้ายังไม่เคยสร้าง Auth ใน Project นี้ ให้สร้างครั้งแรก
    const signUp = await client.auth.signUp({
      email,
      password,
      options: { data: { username: accountId, store_name: db.storeName || '' } }
    });
    if (signUp.error) return { ok: false, reason: signUp.error.message };
    if (!signUp.data?.session || !signUp.data?.user) {
      return { ok: false, reason: 'email_confirmation_required' };
    }
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, email);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', email);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, signUp.data.user.id);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', signUp.data.user.id);
    return { ok: true, user: signUp.data.user, session: signUp.data.session };
  } catch (e) {
    console.error('Supabase Auth error:', e);
    return { ok: false, reason: e.message || String(e) };
  }
};


// ============================================================
// REMEMBERED SUPABASE SESSION
// Never stores a password. Supabase persists/refreshes the Auth
// session in the browser. On reload, restore the matching local
// POS user from the active Auth session.
// ============================================================
window.restoreRememberedSupabaseLogin = async function () {
  try {
    const ready = await window.ensureSupabaseClientReady({ requireSession:false });
    if (!ready.ok || !ready.client) return { ok:false, reason:ready.reason || 'cloud_not_configured' };
    const client = ready.client;
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session?.user) return { ok:false, reason:'no_session' };

    const authUser = sessionData.session.user;
    const rememberedId = String(localStorage.getItem('POS_LAST_LOGIN_USER_ID') || '').trim().toLowerCase();
    const users = Array.isArray(window.db?.users) ? window.db.users : [];
    let localUser = rememberedId
      ? users.find(u => String(u.id || '').toLowerCase() === rememberedId)
      : null;

    if (!localUser) {
      localUser = users.find(u =>
        (u.supabaseAuthUserId && String(u.supabaseAuthUserId) === String(authUser.id)) ||
        (u.email && String(u.email).toLowerCase() === String(authUser.email || '').toLowerCase())
      );
    }
    if (!localUser) return { ok:false, reason:'session_user_not_found' };

    if (localUser.supabaseAuthUserId &&
        String(localUser.supabaseAuthUserId) !== String(authUser.id)) {
      return { ok:false, reason:'session_user_mismatch' };
    }

    const store = typeof window.refreshStoreContext === 'function'
      ? await window.refreshStoreContext()
      : null;
    if (!store) return { ok:false, reason:'store_context_unavailable' };

    return {
      ok:true,
      user:localUser,
      store,
      session:sessionData.session
    };
  } catch (e) {
    console.warn('[Auth] remembered session restore failed:', e);
    return { ok:false, reason:e?.message || 'restore_failed' };
  }
};

window.refreshStoreContext = async function () {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('get_my_store');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.store_id) return null;
    localStorage.setItem('POS_STORE_ID', row.store_id);
    localStorage.setItem('POS_STORE_NAME', row.store_name || db.storeName || '');
    localStorage.setItem('POS_STORE_ROLE', row.role || 'staff');
    return row;
  } catch (e) {
    console.warn('Store context unavailable:', e);
    return null;
  }
};

window.ensureSupabaseAuthForMember = async function(email, password) {
  const client = getSupabaseClient();
  if (!email || !password) return { ok:false, reason:'missing_member_credentials' };
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data?.session) return { ok:false, reason: result.error?.message || 'member_auth_failed' };
  const store = await window.refreshStoreContext();
  if (!store) {
    await client.auth.signOut();
    return { ok:false, reason:'บัญชีสมาชิกยังไม่ได้รับสิทธิ์เข้าร้านนี้' };
  }
  return { ok:true, user:result.data.user, session:result.data.session, store };
};

window.provisionStoreMemberAuth = async function(email, password, role='staff') {
  if (!getConfiguredSupabaseUrl() || !getConfiguredSupabaseAnonKey()) return { ok:false, reason:'cloud_not_configured' };
  if (!email || !password) throw new Error('สมาชิก Cloud ต้องมีอีเมลและรหัสผ่านอย่างน้อย 8 ตัวอักษร');
  const ownerClient = getSupabaseClient();
  const { data: current } = await ownerClient.auth.getUser();
  if (!current?.user) throw new Error('ต้องเข้าสู่ระบบเจ้าของร้านก่อนเพิ่มสมาชิก');
  const ownerSession = (await ownerClient.auth.getSession()).data?.session;
  const temp = window.supabase.createClient(getConfiguredSupabaseUrl(), getConfiguredSupabaseAnonKey(), { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} });
  const signUp = await temp.auth.signUp({ email, password, options:{ data:{ display_name: email.split('@')[0] } } });
  if (signUp.error) throw signUp.error;
  const memberId = signUp.data?.user?.id;
  if (!memberId) throw new Error('Supabase ไม่คืนรหัสสมาชิก');
  const { error: addErr } = await ownerClient.rpc('add_store_member', { p_user_id: memberId, p_role: role === 'manager' ? 'manager' : 'staff' });
  if (addErr) throw addErr;
  // The temporary client never persists the member session; the owner session remains intact.
  return { ok:true, userId:memberId, email };
};

window.processSaleAtomicOnline = async function(payload) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('process_sale_atomic', { p_payload: payload });
  if (error) throw error;
  return data;
};



window.loadCodeConfigIntoForm = function () {
  ['customer', 'supplier', 'category'].forEach(type => {
    const cfg = db.codeConfig[type];
    document.getElementById(`codecfg-${type}-prefix`).value = cfg.prefix;
    document.getElementById(`codecfg-${type}-digits`).value = cfg.digits;
    document.getElementById(`codecfg-${type}-next`).value = db.counters[type];
  });
  window.updateCodeConfigPreview();
  ['customer', 'supplier', 'category'].forEach(type => {
    ['prefix', 'digits', 'next'].forEach(field => {
      document.getElementById(`codecfg-${type}-${field}`).oninput = window.updateCodeConfigPreview;
    });
  });
};

window.updateCodeConfigPreview = function () {
  const examples = ['customer', 'supplier', 'category'].map(type => {
    const prefix = document.getElementById(`codecfg-${type}-prefix`).value || '';
    const digits = parseInt(document.getElementById(`codecfg-${type}-digits`).value) || 1;
    const next = parseInt(document.getElementById(`codecfg-${type}-next`).value) || 1;
    return prefix + String(next).padStart(digits, '0');
  });
  document.getElementById('codecfg-preview').innerText = `ลูกค้า: ${examples[0]}  •  ซัพพลายเออร์: ${examples[1]}  •  หมวดหมู่: ${examples[2]}`;
};

window.saveCodeConfig = function () {
  ['customer', 'supplier', 'category'].forEach(type => {
    const prefix = document.getElementById(`codecfg-${type}-prefix`).value.trim();
    const digits = Math.max(1, parseInt(document.getElementById(`codecfg-${type}-digits`).value) || 1);
    const next = Math.max(1, parseInt(document.getElementById(`codecfg-${type}-next`).value) || 1);
    db.codeConfig[type] = { prefix, digits };
    db.counters[type] = next;
  });
  persist();
  showToast('บันทึกรูปแบบรหัสอัตโนมัติเรียบร้อย');
};

let _supabaseClient = null;
let _supabaseAuthSubscription = null;
let _supabaseBootPromise = null;

function getActiveAccountId() {
  return String(
    localStorage.getItem('POS_ACCOUNT_ID') ||
    localStorage.getItem('POS_STORE_ID') ||
    ''
  ).trim();
}

function resolveSupabaseConfig() {
  const accountId = getActiveAccountId();
  let url = getConfiguredSupabaseUrl(accountId);
  let key = getConfiguredSupabaseAnonKey(accountId);

  // Accept config already exposed by the host page/app shell, but never a secret key.
  if ((!url || !key) && window.SMARTPOS_SUPABASE_CONFIG) {
    url = url || String(window.SMARTPOS_SUPABASE_CONFIG.url || '').trim();
    key = key || String(window.SMARTPOS_SUPABASE_CONFIG.anonKey || '').trim();
  }
  if ((!url || !key) && window.__SMARTPOS_SUPABASE__) {
    url = url || String(window.__SMARTPOS_SUPABASE__.url || '').trim();
    key = key || String(window.__SMARTPOS_SUPABASE__.anonKey || '').trim();
  }

  if (!url || !key) return null;
  if (/service_role|sb_secret/i.test(key)) return null;
  if (!/^https:\/\/[^\s/]+\.supabase\.co(?:\/.*)?$/i.test(url)) return null;
  return { url: url.replace(/\/$/, ''), key, accountId };
}

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  const cfg = resolveSupabaseConfig();
  if (!cfg) return null;
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;

  _supabaseClient = window.supabase.createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce'
    }
  });

  if (!_supabaseAuthSubscription) {
    const result = _supabaseClient.auth.onAuthStateChange((event, session) => {
      window.POS_SUPABASE_SESSION = session || null;
      window.POS_SUPABASE_AUTH_STATE = event;
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        if (session?.user?.id) {
          const accountId = getActiveAccountId();
          localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', session.user.id);
          if (accountId) localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, session.user.id);
          if (session.user.email) {
            localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', session.user.email);
            if (accountId) localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, session.user.email);
          }
        }
      }
      if (event === 'SIGNED_OUT') {
        window.POS_SUPABASE_SESSION = null;
      }
      try { window.dispatchEvent(new CustomEvent('smartpos:supabase-auth', { detail: { event, session } })); } catch (_) {}
    });
    _supabaseAuthSubscription = result?.data?.subscription || null;
  }
  return _supabaseClient;
}
window.getSupabaseClient = getSupabaseClient;

window.ensureSupabaseClientReady = async function (options = {}) {
  const requireSession = options.requireSession !== false;
  if (_supabaseBootPromise) return _supabaseBootPromise;
  _supabaseBootPromise = (async () => {
    const client = getSupabaseClient();
    if (!client) return { ok:false, reason:'cloud_not_configured', client:null, session:null };
    try {
      const { data, error } = await client.auth.getSession();
      if (error) return { ok:false, reason:error.message || 'session_check_failed', client, session:null };
      const session = data?.session || null;
      window.POS_SUPABASE_SESSION = session;
      if (requireSession && !session) return { ok:false, reason:'not_authenticated', client, session:null };
      return { ok:true, client, session };
    } catch (e) {
      return { ok:false, reason:e?.message || 'client_not_ready', client, session:null };
    } finally {
      _supabaseBootPromise = null;
    }
  })();
  return _supabaseBootPromise;
};

window.getSupabaseSession = async function () {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    window.POS_SUPABASE_SESSION = data?.session || null;
    return data?.session || null;
  } catch (_) { return null; }
};

window.refreshSupabaseSession = async function () {
  const client = getSupabaseClient();
  if (!client) return { ok:false, reason:'cloud_not_configured' };
  try {
    const { data, error } = await client.auth.refreshSession();
    if (error) return { ok:false, reason:error.message || 'refresh_failed' };
    window.POS_SUPABASE_SESSION = data?.session || null;
    return { ok:true, session:data?.session || null };
  } catch (e) { return { ok:false, reason:e?.message || 'refresh_failed' }; }
};

// Boot once per page. This does NOT sign in, ask for a password, or contact a
// different project. It only restores the persisted Supabase session for the
// already configured store.
window.initSupabaseAuth = async function () {
  return window.ensureSupabaseClientReady({ requireSession:false });
};

// Initialize after the Supabase CDN is available and after localStorage is ready.
(function bootSupabaseAuth() {
  const run = () => { try { window.initSupabaseAuth(); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true });
  else run();
})();

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

            const ownerId = (await client.auth.getUser()).data?.user?.id;
            if (!ownerId) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
            const payload = unSyncedBills.map(b => ({
                id: b.id,
                owner_id: ownerId,
                time: new Date(b.time).toISOString(),
                total: b.total,
                method: b.method,
                customer_id: b.customerId === 'GENERAL' ? null : b.customerId,
                payload_json: b 
            }));

            const { error } = await client.from('bills').upsert(payload, { onConflict: 'id' });
            if (error) throw error;
            unSyncedBills.forEach(b => b.supabaseSynced = true);
            if (typeof window.persist === 'function') window.persist();
        }
        else if (domain === 'cash_ledger') {
            const unSyncedLedger = window.db.cashLedger.filter(tx => !tx.supabaseSynced);
            if (unSyncedLedger.length === 0) return true;

            const ownerId = (await client.auth.getUser()).data?.user?.id;
            if (!ownerId) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
            const payload = unSyncedLedger.map(tx => ({
                id: tx.id,
                owner_id: ownerId,
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
            if (typeof window.persist === 'function') window.persist();
        }
        else if (domain === 'shifts') {
             const unSyncedShifts = window.db.shifts.filter(s => !s.supabaseSynced);
             if (unSyncedShifts.length === 0) return true;
             
             const ownerId = (await client.auth.getUser()).data?.user?.id;
             if (!ownerId) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
             const payload = unSyncedShifts.map(s => ({
                 id: s.id,
                 owner_id: ownerId,
                 start_time: new Date(s.startTime).toISOString(),
                 end_time: s.endTime ? new Date(s.endTime).toISOString() : null,
                 cash_on_hand: s.cashOnHand,
                 payload_json: s
             }));
             const { error } = await client.from('shifts').upsert(payload, { onConflict: 'id' });
             if (error) throw error;
             unSyncedShifts.forEach(s => s.supabaseSynced = true);
             if (typeof window.persist === 'function') window.persist();
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
        const authUser = (await getSupabaseClient().auth.getUser()).data?.user;
        if (!authUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
        const owner_id = authUser.id;

        const categoryRows = db.categories.map(c => ({ owner_id, id: c.id, name: c.name, icon: c.icon, color: c.color }));
        if (categoryRows.length > 0) {
          const { error } = await getSupabaseClient().from('categories').upsert(categoryRows);
          if (error) throw new Error('categories: ' + error.message);
        }

        const productRows = products.map(p => ({
          owner_id,
          id: p.id,
          name: p.name,
          category_id: null,
          icon: p.image || '',
          image_url: p.imageStoragePath || null,
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
          if (nameToId[catName]) categoryLinkRows.push({ owner_id, product_id: p.id, category_id: nameToId[catName] });
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
            owner_id,
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
            owner_id,
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

// Resizes + re-encodes an image file before upload so phone-camera photos
// (often 3-8 MB each) don't balloon Storage usage. Non-image files (PDFs
// etc.) are returned untouched. Falls back to the original file if anything
// about compression fails, so an upload never breaks because of this step.
window.compressImageFile = function (file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif') {
      return resolve(file); // don't touch non-images or animated GIFs
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && file.size < 400 * 1024) {
        return resolve(file); // already small enough, skip re-encoding
      }
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        resolve(new File([blob], newName, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
};

window.uploadProductImageToSupabase = async function (file, productId) {
  if (!file) throw new Error('ไม่พบไฟล์รูป');
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type || '') || file.size > 5 * 1024 * 1024) {
    throw new Error('รูปสินค้าต้องเป็น JPG/PNG/WebP และมีขนาดไม่เกิน 5 MB');
  }

  // IMPORTANT: getSupabaseClient() intentionally returns null when the current
  // account has no saved cloud configuration. Never call .auth/.storage on null.
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('ยังไม่ได้เชื่อมต่อฐานข้อมูลร้านบนคลาวด์สำหรับบัญชีนี้ กรุณาเข้าสู่ระบบ/เชื่อมต่อร้านก่อนนำเข้ารูป');
  }

  try {
    const compressed = await window.compressImageFile(file);
    const ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError) throw new Error('ตรวจสอบผู้ใช้ Supabase ไม่สำเร็จ: ' + authError.message);
    const user = authData?.user;
    if (!user) throw new Error('ไม่มี Supabase Session ที่ใช้งานอยู่ กรุณาเข้าสู่ระบบร้านอีกครั้งก่อนนำเข้ารูป');

    const storeId = localStorage.getItem('POS_STORE_ID') || user.id;
    const safeProductId = String(productId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safeProductId) throw new Error('ไม่พบรหัสสินค้า');
    const randomId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    const path = `${storeId}/products/${safeProductId}-${randomId}.${ext}`;

    const { error: uploadError } = await client.storage
      .from('product-images')
      .upload(path, compressed, { upsert: false, contentType: compressed.type || undefined });
    if (uploadError) throw uploadError;

    // Signed URL is only for display; path is the durable value saved to the product.
    const { data, error } = await client.storage.from('product-images').createSignedUrl(path, 3600);
    if (error) throw error;
    return { url: data?.signedUrl || '', path };
  } catch (err) {
    console.error('Image upload error:', err);
    if (typeof showAlert === 'function') showAlert('อัปโหลดรูปไม่สำเร็จ', 'เกิดข้อผิดพลาด: ' + (err.message || err), true);
    throw err;
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
  const uploadResult = await window.uploadProductImageToSupabase(file, productId);
  const url = uploadResult?.url || null;

  if (label) label.innerText = originalLabel;
  event.target.value = '';

  if (url) {
    const pObj = db.products[productId];
    if (uploadResult?.path) window.__pendingProductImageStoragePath = uploadResult.path;
    if (pObj && uploadResult?.path) pObj.imageStoragePath = uploadResult.path;
    const urlInput = document.getElementById('p-image-url');
    if (urlInput) urlInput.value = url;
    if (typeof window.previewProductImageUrl === 'function') window.previewProductImageUrl();
    showToast('อัปโหลดรูปสำเร็จ');
  }
};

// ==========================================
// PRODUCT IMAGE CACHE
// เก็บ Blob ตาม storage path ถาวร; Signed URL ใช้เป็นเพียงช่องทางดาวน์โหลด
// ==========================================
const PRODUCT_IMAGE_CACHE_NAME='smartpos-product-images-v1';
function productImageCacheKey(path){const store=String(localStorage.getItem('POS_STORE_ID')||'local').trim().toLowerCase();return `https://smartpos.local/cache/${encodeURIComponent(store)}/${encodeURIComponent(String(path||''))}`;}
window.cacheProductImage=async function(path,signedUrl){try{if(!path||!signedUrl||!('caches'in window))return false;const r=await fetch(signedUrl,{cache:'no-store'});if(!r.ok)return false;const c=await caches.open(PRODUCT_IMAGE_CACHE_NAME);await c.put(productImageCacheKey(path),new Response(await r.blob(),{headers:{'Content-Type':r.headers.get('Content-Type')||'image/jpeg'}}));return true;}catch(_){return false;}};
window.getCachedProductImage=async function(path){try{if(!path||!('caches'in window))return null;const c=await caches.open(PRODUCT_IMAGE_CACHE_NAME),r=await c.match(productImageCacheKey(path));if(!r)return null;return URL.createObjectURL(await r.blob());}catch(_){return null;}};
window.clearProductImageCache=async function(){try{if('caches'in window)await caches.delete(PRODUCT_IMAGE_CACHE_NAME);}catch(_){}};

// ==========================================
// PRIVATE STORAGE URL REFRESH
// Signed URLs are never persisted as the security credential. Only storage paths are durable.
// ==========================================
window.__lastStorageUrlRefreshAt = 0;
window.refreshProductImageUrl = async function (productId, preferCache = true) {
  try {
    const p=db?.products?.[productId]; if(!p?.imageStoragePath)return false;
    if(preferCache&&window.getCachedProductImage){const cached=await window.getCachedProductImage(p.imageStoragePath);if(cached){p.imageUrl=cached;return true;}}
    const client=getSupabaseClient(); if(!client)return false;
    const {data,error}=await client.storage.from('product-images').createSignedUrl(p.imageStoragePath,3600);
    if(error||!data?.signedUrl)return false;
    p.imageUrl=data.signedUrl;
    await window.cacheProductImage?.(p.imageStoragePath,data.signedUrl);
    return true;
  } catch(e){console.warn('Product image URL refresh failed:',e);return false;}
};window.refreshPrivateStorageUrls = async function (force = false) {
  try {
    const products=Object.values(db.products||{}).filter(p=>p.imageStoragePath);
    const missing=[];
    for(const p of products){
      if(!force&&p.imageUrl)continue;
      const cached=await window.getCachedProductImage?.(p.imageStoragePath);
      if(cached)p.imageUrl=cached;else missing.push(p);
    }
    if(!missing.length)return true;
    const client=getSupabaseClient();if(!client)return false;
    const paths=missing.map(p=>p.imageStoragePath);
    if(typeof client.storage.from('product-images').createSignedUrls==='function'){
      for(let i=0;i<paths.length;i+=1000){
        const chunk=paths.slice(i,i+1000);
        const {data,error}=await client.storage.from('product-images').createSignedUrls(chunk,3600);
        if(!error&&Array.isArray(data))await Promise.all(data.map(async(r,j)=>{if(!r?.signedUrl)return;const p=missing[i+j];if(!p)return;p.imageUrl=r.signedUrl;await window.cacheProductImage?.(p.imageStoragePath,r.signedUrl);}));
      }
    }else{for(const p of missing)await window.refreshProductImageUrl(p.id,false);}
    if(window.persist)window.persist();return true;
  }catch(e){console.warn('Storage URL refresh skipped:',e);return false;}
};// ==========================================
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

// ==========================================
// SAFE MERGE ENGINE FOR SYNC CONFLICTS
// ==========================================
// Replaces "abort or Force Sync (overwrite the whole remote db)" with a
// per-record merge, so a conflict between two devices/staff sessions can no
// longer silently delete data the other side already saved. This matters even
// more now that staff can legitimately work "offline" on a device that hasn't
// re-authenticated to Supabase yet (see submitAccountLogin) — their changes
// need to merge cleanly once the owner reconnects, not get wiped.
//
// Merge rules per top-level key in `db` (see DB_DEFAULT above):
//  - Array-of-records keyed by `id` (bills, shifts, cashLedger, categories,
//    users, pendingSyncs, pos, documents): union by id. Identical content on
//    both sides -> keep one copy. Same id, DIFFERENT content -> keep BOTH;
//    the local record is kept under a renamed id (`<id>-conflict-<ts>`,
//    flagged `_mergeConflict:true` / `_originalId`) so nothing is ever
//    silently discarded.
//  - Dictionary-of-records keyed by object key (products, customers,
//    suppliers): same by-key union + rename-on-conflict rule.
//  - counters: take the MAX of local vs remote per counter, so an id either
//    device already issued is never reused after the merge.
//  - Everything else (storeName, settings, security/PIN state, promptPayId,
//    schemaVersion, codeConfig, currentShift, ...): singleton config, not
//    meaningfully mergeable field-by-field -> remote wins (it's the side
//    that triggered the conflict). Local's own copy is preserved in the
//    pre-merge backup snapshot taken in applyMergedStateAndPush below.
window.mergeDbStates = function (localDb, remoteDb) {
  const conflicts = [];
  const merged = {};

  const ARRAY_KEYED_COLLECTIONS = ['bills', 'shifts', 'cashLedger', 'categories', 'users', 'pendingSyncs', 'pos', 'documents'];
  const DICT_KEYED_COLLECTIONS = ['products', 'customers', 'suppliers'];

  function sameContent(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  // ⚠️ เวอร์ชันก่อนหน้าตรงนี้เคย "duplicate เป็นเรคคอร์ดใหม่" ทุกครั้งที่ id เดียวกันมีเนื้อหาต่าง
  // กัน — ฟังดูปลอดภัย แต่ในทางปฏิบัติ field อย่าง "สต็อกสินค้า" เปลี่ยนแทบทุกครั้งที่มีการขาย
  // พอ 2 เครื่อง sync ชนกันบ่อยๆ (เรื่องปกติเวลามีหลายเครื่องขายพร้อมกัน) สินค้า 1 รายการเดิม
  // จะถูกโคลนซ้ำไปเรื่อยๆ ทุกครั้งที่ conflict เกิด — สินค้าจริง ~2,000 รายการ กลายเป็นหลักหมื่น
  // รายการได้ในเวลาไม่นาน นี่คือสาเหตุของปัญหาที่เจอ แก้เป็น "remote wins" สำหรับ record เดิมที่
  // มีอยู่แล้วทั้งสองฝั่งแทน (ไม่สร้างซ้ำอีกต่อไป) ส่วน record ที่มีอยู่แค่ฝั่งเดียว (สินค้า/บิลใหม่ที่
  // เพิ่งสร้าง ยังไม่เคย sync) ยังคงถูก union เข้ามาตามปกติ ปลอดภัยเหมือนเดิม ไม่มีการลบข้อมูลจริง
  // ที่ต่างกันแค่ไม่ union สอง version เข้าด้วยกันแบบสร้างแถวใหม่อีกต่อไป
  function mergeArrayCollection(key, localArr, remoteArr) {
    localArr = Array.isArray(localArr) ? localArr : [];
    remoteArr = Array.isArray(remoteArr) ? remoteArr : [];
    const byId = new Map();
    remoteArr.forEach(rec => { if (rec && rec.id != null) byId.set(rec.id, rec); });
    localArr.forEach(rec => {
      if (!rec || rec.id == null) return; // skip malformed records rather than crash the merge
      if (!byId.has(rec.id)) { byId.set(rec.id, rec); return; } // only exists locally -> keep it (union)
      const remoteRec = byId.get(rec.id);
      if (sameContent(rec, remoteRec)) return; // identical both sides, nothing to do
      // มีอยู่ทั้งสองฝั่งแต่เนื้อหาต่างกัน -> ใช้ฝั่ง remote (ไม่ duplicate) แค่บันทึกไว้ให้ตรวจสอบ
      conflicts.push({ collection: key, id: rec.id, note: 'ใช้ข้อมูลฝั่ง remote (ค่าบางฟิลด์ เช่น สต็อก ต่างกันระหว่างสองเครื่อง)' });
    });
    return Array.from(byId.values());
  }

  function mergeDictCollection(key, localDict, remoteDict) {
    localDict = localDict && typeof localDict === 'object' ? localDict : {};
    remoteDict = remoteDict && typeof remoteDict === 'object' ? remoteDict : {};
    const out = { ...remoteDict };
    Object.keys(localDict).forEach(id => {
      const localRec = localDict[id];
      if (!(id in out)) { out[id] = localRec; return; } // only exists locally -> keep it (union)
      if (sameContent(localRec, out[id])) return;
      conflicts.push({ collection: key, id, note: 'ใช้ข้อมูลฝั่ง remote (ค่าบางฟิลด์ เช่น สต็อก ต่างกันระหว่างสองเครื่อง)' });
      // out[id] คือฝั่ง remote อยู่แล้ว ไม่ต้องทำอะไรเพิ่ม (ไม่ทับด้วย localRec, ไม่สร้างซ้ำ)
    });
    return out;
  }

  const allKeys = new Set([...Object.keys(localDb || {}), ...Object.keys(remoteDb || {})]);
  allKeys.forEach(key => {
    const localVal = localDb ? localDb[key] : undefined;
    const remoteVal = remoteDb ? remoteDb[key] : undefined;

    if (ARRAY_KEYED_COLLECTIONS.includes(key)) {
      merged[key] = mergeArrayCollection(key, localVal, remoteVal);
    } else if (DICT_KEYED_COLLECTIONS.includes(key)) {
      merged[key] = mergeDictCollection(key, localVal, remoteVal);
    } else if (key === 'counters') {
      const localCounters = localVal || {};
      const remoteCounters = remoteVal || {};
      const counterKeys = new Set([...Object.keys(localCounters), ...Object.keys(remoteCounters)]);
      const mergedCounters = {};
      counterKeys.forEach(ck => {
        const lv = localCounters[ck], rv = remoteCounters[ck];
        if (typeof lv === 'number' && typeof rv === 'number') {
          mergedCounters[ck] = Math.max(lv, rv);
        } else {
          mergedCounters[ck] = (rv !== undefined) ? rv : lv; // e.g. lastBillDate string -> remote wins
        }
      });
      merged[key] = mergedCounters;
    } else {
      merged[key] = (remoteVal !== undefined) ? remoteVal : localVal;
    }
  });

  return { merged, conflicts };
};

// Applies a merged db locally (with a safety backup first), persists it, then
// pushes it up as the new authoritative remote state. If anything throws at
// any point, the merge attempt simply fails and the caller falls back to the
// old manual Force Sync flow — the original local db is never left corrupted.
window.applyMergedStateAndPush = async function (mergedDb, conflicts) {
  try {
    const pf = window.__pushFailState || {};
    const skipBackupDownload = pf.lastBackupAt && (Date.now() - pf.lastBackupAt < 5 * 60 * 1000);
    // ถ้าเพิ่งดาวน์โหลด backup ไปเมื่อไม่ถึง 5 นาทีที่แล้ว (เช่นกำลังวน retry ซ้ำๆ จากปัญหาเดิม)
    // ไม่ต้องเด้งหน้าต่างดาวน์โหลดไฟล์ซ้ำรัวๆ ให้รำคาญ — in-app snapshot ยังทำทุกครั้งอยู่ดี
    // (เบากว่า ไม่รบกวนผู้ใช้)
    if (!skipBackupDownload && typeof window.downloadJSONFile === 'function') {
      window.downloadJSONFile(db, 'PreMerge_Safety');
      if (window.__pushFailState) window.__pushFailState.lastBackupAt = Date.now();
    }
    if (typeof window.saveInAppBackupSnapshot === 'function') {
      await window.saveInAppBackupSnapshot();
    }

    window.db = mergedDb;
    if (typeof db !== 'undefined') { db = window.db; }

    if (typeof window.persist === 'function') window.persist();
    if (typeof renderAll === 'function') renderAll();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();

    if (conflicts && conflicts.length > 0) {
      try { localStorage.setItem('pos_last_merge_conflicts', JSON.stringify({ time: new Date().toISOString(), conflicts })); } catch (e) {}
      if (typeof window.logSystemError === 'function') {
        window.logSystemError('SYNC_MERGE_CONFLICTS', `พบ ${conflicts.length} รายการที่ค่าบางฟิลด์ต่างกันระหว่างสองเครื่อง (ใช้ค่าฝั่ง remote)`, JSON.stringify(conflicts).slice(0, 1000));
      }
      // ไม่ต้องรบกวนผู้ใช้ด้วย alert ทุกครั้งที่เจอความต่างเล็กๆ (เช่น สต็อกไม่ตรงกันเพราะขายคนละ
      // รอบ) เพราะเกิดขึ้นเป็นปกติเวลามีหลายเครื่องขายพร้อมกัน — log ไว้เงียบๆ ให้ตรวจสอบทีหลังพอ
      // (ดูได้ที่ 🚨 บันทึกข้อผิดพลาดของระบบ หรือ localStorage key 'pos_last_merge_conflicts')
    }

    const pushed = await window.pushFullStateToSupabaseSafe(true);
    return pushed;
  } catch (err) {
    console.error("[Merge Engine] Failed to apply merged state:", err);
    if (typeof window.logSystemError === 'function') {
      window.logSystemError('MERGE_APPLY_FAILED', err.message, err.stack);
    }
    return false;
  }
};

// Safe Push Function with Optimistic Concurrency Control (OCC)
// ==========================================
// PUSH FAILURE BACKOFF (กันลูปยิงซ้ำไม่หยุด)
// ==========================================
// ปัญหาที่เจอ: ถ้า push ล้มเหลว (เช่น "TypeError: Load failed" ตอนข้อมูลก้อนใหญ่เกินไป)
// applyMergedStateAndPush จะเรียก persist() ซึ่งไปตั้ง debounce timer ให้ push รอบใหม่อัตโนมัติ
// อีก 2.5 วิ — ถ้าสาเหตุที่แท้จริงยังไม่หาย (เช่น payload ใหญ่เกิน) รอบใหม่ก็จะล้มเหลวซ้ำ แล้ว
// เรียก persist() อีก วนแบบนี้ไม่จบ ผลคือ error log/หน้าต่างดาวน์โหลด backup/popup "Data Conflict"
// เด้งรัวๆ ทุก 2-3 วินาทีไม่หยุดตามที่เจอในรายงานปัญหา
// ทางแก้: ใส่ cooldown แบบ exponential backoff หลัง push ล้มเหลว และจำกัดไม่ให้ backup/dialog
// เด้งซ้ำถี่เกินไปในช่วง cooldown เดียวกัน
window.__pushFailState = { failCount: 0, cooldownUntil: 0, lastDialogAt: 0, lastBackupAt: 0 };

window.pushFullStateToSupabaseSafe = async function (force = false) {
  const pf = window.__pushFailState;
  if (!force && Date.now() < pf.cooldownUntil) {
    // ยังอยู่ในช่วง cooldown จากความล้มเหลวรอบก่อน ข้ามเงียบๆ ไม่ยิง network ซ้ำ ไม่ log ซ้ำ
    return false;
  }
  try {
    if (!localStorage.getItem('POS_ACCOUNT_ID') || !getConfiguredSupabaseUrl() || !getConfiguredSupabaseAnonKey()) return false;
    const client = getSupabaseClient();
    if (!client) return false;

    // เช็ค session ก่อนเสมอ (อ่านจากหน่วยความจำ/localStorage ไม่ยิง network) — ถ้ายังไม่มี
    // session เลย (เช่น พนักงานทำงานแบบออฟไลน์ตามที่ระบบอนุญาตไว้ตอน login) ให้ออกจากฟังก์ชัน
    // เงียบๆ ทันที ไม่ยิง network เปล่าประโยชน์ (ฟังก์ชันนี้ถูกเรียกทุกครั้งที่มีการบันทึกข้อมูล
    // ผ่าน persist() debounce 2.5 วิ ถ้าไม่เช็คก่อน จะยิง request ไปเช็ค updated_at ทุกครั้งทั้งที่
    // รู้อยู่แล้วว่าไม่มี session จะ push ไม่ได้อยู่ดี) และไม่ log เป็น error เพราะสถานะนี้ไม่ใช่
    // ข้อผิดพลาด เป็นสถานะที่ตั้งใจให้เกิดได้ตามปกติ — เดิมเคย log 'PUSH_FAILED' ทุกครั้งที่พนักงาน
    // ออฟไลน์บันทึกอะไรสักอย่าง ทำให้ error log เต็มไปด้วยข้อความที่ไม่ใช่ error จริง จน error จริงๆ
    // ที่ควรเห็นถูกกลบหายไป
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) {
      updateSyncStatusBadge('offline', null);
      return false;
    }

    // เช็คขนาดข้อมูลก่อน push เสมอ — ระบบ full-state sync ส่งฐานข้อมูลทั้งก้อนทุกครั้ง ถ้าร้าน
    // มีสินค้า/รูปเยอะมาก (เช่นหลายพันรายการ) payload อาจใหญ่จนเบราว์เซอร์/เน็ตมือถือส่งไม่สำเร็จ
    // (fetch ล้มเหลวแบบ "TypeError: Load failed") ถ้าไม่เช็คก่อน ระบบจะพยายามซ้ำไม่รู้จบ
    let payloadSizeMB = 0;
    try { payloadSizeMB = new Blob([JSON.stringify(db)]).size / (1024 * 1024); } catch (e) {}
    if (payloadSizeMB > 8) {
      pf.failCount++;
      pf.cooldownUntil = Date.now() + 10 * 60 * 1000; // ข้อมูลใหญ่เกินไป ไม่มีประโยชน์จะลองถี่ๆ รอ 10 นาที
      if (typeof window.logSystemError === 'function') {
        window.logSystemError('PUSH_PAYLOAD_TOO_LARGE', `ขนาดข้อมูล ~${payloadSizeMB.toFixed(1)}MB ใหญ่เกินกว่าจะ sync แบบ full-state ได้อย่างเสถียร`);
      }
      if (Date.now() - pf.lastDialogAt > 5 * 60 * 1000 && typeof window.showAlert === 'function') {
        pf.lastDialogAt = Date.now();
        window.showAlert(
          "⚠️ ข้อมูลใหญ่เกินกว่าจะซิงค์ได้",
          `ฐานข้อมูลตอนนี้มีขนาดประมาณ ${payloadSizeMB.toFixed(1)} MB ใหญ่เกินกว่าระบบซิงค์แบบปัจจุบันจะส่งได้เสถียร มักเกิดจากมีสินค้าซ้ำซ้อนสะสมอยู่มาก\n\nแนะนำ: ไปที่หน้าคลังสินค้า กด "🧬 ล้างสินค้าซ้ำ" ก่อน แล้วลองซิงค์ใหม่อีกครั้ง`,
          true
        );
      }
      return false;
    }

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
          console.warn("[Conflict Engine] Supabase has newer state. Attempting automatic per-record merge instead of a blind overwrite.");

          if (typeof window.logSystemError === 'function') {
            window.logSystemError('SYNC_CONFLICT', `Remote updated at ${remoteData.updated_at}, local known was ${lastKnownSync}`);
          }

          updateSyncStatusBadge('offline', null);

          // Try to resolve automatically via the merge engine first. This can only
          // ADD data (union of both sides, conflicting records kept as flagged
          // duplicates) — it never deletes anything either side already had, so
          // it's safe to attempt without asking. If fetching/merging fails for any
          // reason (including the remote row belonging to a different Supabase
          // Auth account, which must never be merged in), fall through to the
          // original manual Force-Sync-or-abort dialog.
          try {
            const { data: authCheck } = await client.auth.getUser();
            const { data: fullRemote, error: fullFetchErr } = await client
              .from('pos_state')
              .select('data, updated_at, owner_id')
              .eq('id', POS_STATE_ROW_ID)
              .maybeSingle();

            if (fullFetchErr || !fullRemote || !fullRemote.data) throw new Error('ไม่สามารถดึงข้อมูลฉบับเต็มจาก Supabase เพื่อนำมารวมได้');
            if (fullRemote.owner_id && authCheck?.user?.id && fullRemote.owner_id !== authCheck.user.id) {
              throw new Error('ข้อมูลใน Supabase เป็นของบัญชีอื่น ไม่สามารถรวมข้อมูลอัตโนมัติได้');
            }

            const { merged, conflicts } = window.mergeDbStates(db, fullRemote.data);
            const pushed = await window.applyMergedStateAndPush(merged, conflicts);
            if (pushed) return true;
            throw new Error('รวมข้อมูลสำเร็จแต่ push ขึ้น Supabase ไม่สำเร็จ');
          } catch (mergeErr) {
            console.error("[Conflict Engine] Automatic merge failed, falling back to manual Force Sync prompt:", mergeErr);
            if (typeof window.logSystemError === 'function') {
              window.logSystemError('SYNC_MERGE_FAILED', mergeErr.message, mergeErr.stack);
            }
          }

          if (Date.now() - pf.lastDialogAt < 60 * 1000) return false;
          pf.lastDialogAt = Date.now();
          if (typeof window.showAlert === 'function') {
            window.showAlert(
              "⚠️ พบข้อมูลขัดแย้ง",
              "ระบบรวมข้อมูลอัตโนมัติไม่สำเร็จ จึงหยุดการส่งข้อมูลเพื่อป้องกันการเขียนทับข้อมูลของอีกเครื่อง กรุณาตรวจสอบการเชื่อมต่อแล้วลองทำรายการใหม่",
              true
            );
          }
          return false;
        }
      }
    }

    const { data: authData } = await client.auth.getUser();
    const authUserId = authData?.user?.id || null;
    if (!authUserId) throw new Error('ยังไม่มี Supabase Auth session จึงไม่อนุญาตให้ซิงค์ข้อมูล');

    const stateForRemote = JSON.parse(JSON.stringify(db));
    Object.values(stateForRemote.products || {}).forEach(p => {
      if (p.imageStoragePath) p.imageUrl = '';
    });
    (stateForRemote.documents || []).forEach(d => {
      if (d.fileStoragePath) d.fileUrl = '';
    });

    const { error: upsertErr } = await client
      .from('pos_state')
      .upsert({ id: POS_STATE_ROW_ID, owner_id: authUserId, updated_by: authUserId, data: stateForRemote, updated_at: nowIso }, { onConflict: 'id' });

    if (upsertErr) throw upsertErr;

    localStorage.setItem(LAST_SYNCED_KEY, nowIso);
    updateSyncStatusBadge('synced', nowIso);
    pf.failCount = 0;
    pf.cooldownUntil = 0;
    return true;
  } catch (err) {
    console.error("[Conflict Engine] Push failed:", err);
    updateSyncStatusBadge('offline', null);
    pf.failCount = Math.min(pf.failCount + 1, 6);
    pf.cooldownUntil = Date.now() + Math.min(10 * Math.pow(2, pf.failCount), 300) * 1000; // 10s, 20s, 40s... สูงสุด 5 นาที
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
    const { data: authData } = await client.auth.getUser();
    if (!authData?.user) {
      updateSyncStatusBadge('never', null);
      return;
    }

    const result = await withTimeout(
      client.from('pos_state').select('data, updated_at, owner_id').eq('id', POS_STATE_ROW_ID).maybeSingle(),
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

    const { data: currentAuth } = await client.auth.getUser();
    if (data.owner_id && currentAuth?.user?.id && data.owner_id !== currentAuth.user.id) {
      throw new Error('ข้อมูลในฐานข้อมูลนี้เป็นของบัญชี Supabase อื่น');
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
    await window.refreshPrivateStorageUrls(true);

    if (typeof renderAll === 'function') renderAll();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();
    if (typeof checkStorageQuota === 'function') checkStorageQuota();

    // หมายเหตุสำคัญ: ตรงนี้เคยมีโค้ดที่พยายาม "auto-unlock" หน้าจอ PIN โดยหา user ใน db.users
    // ที่ id ตรงกับ POS_ACCOUNT_ID แล้วเซ็ต currentUserId/currentUserName ทับ — เป็นโค้ดตกค้างจาก
    // สถาปัตยกรรมเก่าที่ POS_ACCOUNT_ID เคยหมายถึง "พนักงานที่ login อยู่ตอนนี้" (ก่อนจะแก้เป็น
    // หมายถึง "ร้าน/บัญชีของเครื่องนี้" ซึ่งปกติคือ id ของเจ้าของร้าน) ผลคือทุกครั้งที่ฟังก์ชันนี้ถูก
    // เรียกหลัง login สำเร็จ (จุดเรียกเดียวคือใน submitAccountLogin หลังยืนยัน PIN ถูกต้องแล้ว)
    // มันจะเงียบๆ สลับตัวตนที่ใช้บันทึกลง audit log/ใบเสร็จกลับไปเป็น "เจ้าของร้าน" เสมอ ไม่ว่า
    // พนักงานคนไหนเพิ่ง login จริงก็ตาม — ทำให้ระบบบันทึกผิดคนว่าใครทำรายการขาย/เปิดกะ ฯลฯ ตัด
    // ออกทั้งบล็อกเพราะไม่จำเป็น (หน้าจอ PIN ถูกซ่อนและ currentUserId ถูกตั้งค่าถูกต้องแล้วใน
    // submitAccountLogin ก่อนจะเรียกฟังก์ชันนี้เสมอ)
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


window.addEventListener('DOMContentLoaded', async () => {
  try {
    const hasAccount = !!localStorage.getItem('POS_ACCOUNT_ID');
    const hasSupabaseConfig = !!(getConfiguredSupabaseUrl() && getConfiguredSupabaseAnonKey());
    // ห้ามดึงข้อมูล remote ตอน startup ก่อน Login/Auth สำเร็จ
    if (hasAccount && hasSupabaseConfig) updateSyncStatusBadge('never', null);
    else updateSyncStatusBadge('never', null);
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
    
    // Strict append-only insert; actor identity comes from Supabase Auth, not browser payload.
    const authUser = (await getSupabaseClient().auth.getUser()).data?.user;
    getSupabaseClient().from('audit_log').insert([{
      id: entry.id,
      owner_id: authUser?.id || null,
      created_by: authUser?.id || null,
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

window.signOutSupabaseOnly=async function(){try{if(_supabaseClient)await _supabaseClient.auth.signOut();}catch(_){} _supabaseClient=null; _supabaseAuthSubscription=null; window.POS_SUPABASE_SESSION=null; window.POS_SUPABASE_AUTH_STATE='SIGNED_OUT';};
