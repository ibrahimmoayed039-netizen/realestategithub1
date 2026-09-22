'use strict';
// نظام التفعيل
//  • بدون تفعيل: فترة تجريبية مدتها TRIAL_DAYS أيام وبحد أقصى TRIAL_MAX_RECORDS عقارات.
//  • التفعيل: مفتاح موقَّع بتوقيع ECDSA (P-256) ومربوط برقم الجهاز، يُصدره المطوّر من «صفحة التفعيلات».
//  • البرنامج يحمل المفتاح العام فقط (للتحقق)؛ المفتاح الخاص (للتوقيع) لا يوجد إلا في صفحة التفعيلات عند المطوّر.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TRIAL_DAYS = 3;
const TRIAL_MAX_RECORDS = 5;
const DAY = 24 * 60 * 60 * 1000;

const PUBLIC_KEY_JWK = {
  "kty": "EC",
  "x": "l1CVsHwGCaQvTiqBk3s9OWLkfICBfzY6cAkH5qLxwR0",
  "y": "In-4H94bxFLst-aQTdATKMbMSks8sZ7inawOG0SNhuY",
  "crv": "P-256"
};
const HMAC_SECRET = '8b72ba983bc471b447c1562dbd3f09b5e6f7bbb832e0680b'; // لكشف العبث بملفات الفترة التجريبية

const normId = (s) => String(s || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
const fmtId = (h) => (h.match(/.{1,4}/g) || []).join('-');

// ---------- رقم الجهاز ----------
function rawMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const v = fs.readFileSync(f, 'utf8').trim();
          if (v) return v;
        } catch (e) {}
      }
    }
  } catch (e) {}
  // احتياطي إن تعذّر ما سبق
  let mac = '';
  try {
    const nets = os.networkInterfaces();
    mac = Object.keys(nets).sort().map((k) => nets[k].filter((n) => !n.internal && n.mac && n.mac !== '00:00:00:00:00:00').map((n) => n.mac)).flat().sort()[0] || '';
  } catch (e) {}
  return [os.hostname(), os.platform(), (os.cpus()[0] || {}).model || '', mac].join('|');
}
let _mid = null;
function systemMachineId() {
  if (!_mid) _mid = fmtId(crypto.createHash('sha256').update('rem-v1|' + rawMachineId()).digest('hex').slice(0, 16).toUpperCase());
  return _mid;
}

// ---------- التحقق من مفتاح التفعيل ----------
const endOfDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T23:59:59').getTime() : NaN);
const INVALID = { ok: false, error: 'مفتاح التفعيل غير صالح' };

function verifyKey(key, machineId, now) {
  const parts = String(key || '').replace(/\s+/g, '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return INVALID;
  let payload, sig, info;
  try {
    payload = Buffer.from(parts[0], 'base64url');
    sig = Buffer.from(parts[1], 'base64url');
    info = JSON.parse(payload.toString('utf8'));
  } catch (e) {
    return INVALID;
  }
  let good = false;
  try {
    good = crypto.verify('sha256', payload, { key: crypto.createPublicKey({ key: PUBLIC_KEY_JWK, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, sig);
  } catch (e) {}
  if (!good || !info || info.v !== 1) return INVALID;
  if (normId(info.m) !== normId(machineId)) return { ok: false, error: 'هذا المفتاح مخصص لجهاز آخر' };
  const res = { ok: true, customer: String(info.n || ''), expires: info.e || null };
  if (info.e) {
    const end = endOfDay(info.e);
    if (!isFinite(end)) return INVALID;
    if (now > end) return { ok: false, expired: true, customer: res.customer, expires: res.expires, error: 'انتهت صلاحية مفتاح التفعيل' };
  }
  return res;
}

// ---------- ملفات الفترة التجريبية (عدة نسخ في أماكن مختلفة) ----------
const sign = (d) => crypto.createHmac('sha256', HMAC_SECRET).update(d).digest('hex');
function readCopy(f) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return null; } // غير موجود
  try {
    const o = JSON.parse(txt);
    if (o && typeof o.d === 'string' && o.s === sign(o.d)) {
      const v = JSON.parse(Buffer.from(o.d, 'base64').toString('utf8'));
      if (Number.isFinite(v.i) && Number.isFinite(v.l)) return { ok: true, v };
    }
  } catch (e) {}
  return { ok: false };
}
function writeCopy(f, v) {
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const d = Buffer.from(JSON.stringify(v)).toString('base64');
    fs.writeFileSync(f, JSON.stringify({ d, s: sign(d) }));
  } catch (e) {}
}

function createManager({ files, machineId, now = Date.now }) {
  let mem = null;
  let lastWrite = 0;

  const persist = () => {
    files.forEach((f) => writeCopy(f, { i: mem.i, l: mem.l, k: mem.k || null }));
    lastWrite = mem.l;
  };

  function load() {
    const copies = files.map(readCopy);
    const existing = copies.filter(Boolean);
    const valid = copies.filter((c) => c && c.ok).map((c) => c.v);
    const t = now();
    if (!existing.length) {
      mem = { i: t, l: t, k: null };
      persist();
    } else if (!valid.length) {
      mem = { tampered: true, i: 0, l: t, k: null }; // كل النسخ تالفة/معدَّلة
    } else {
      mem = { i: Math.min(...valid.map((v) => v.i)), l: Math.max(...valid.map((v) => v.l)), k: valid.map((v) => v.k).find(Boolean) || null };
    }
  }

  function status() {
    if (!mem) load();
    const eff = Math.max(now(), mem.l); // الوقت لا يرجع للخلف: تغيير ساعة الجهاز لا يمدّد الفترة
    if (eff - lastWrite >= 60000 && !mem.tampered) {
      mem.l = eff;
      persist();
    }
    const base = { machineId, trialDays: TRIAL_DAYS, maxRecords: null, customer: '', expires: null, msLeft: null, reason: null };
    if (mem.k) {
      const v = verifyKey(mem.k, machineId, eff);
      if (v.ok) return { ...base, state: 'active', customer: v.customer, expires: v.expires };
      if (v.expired) return { ...base, state: 'expired', reason: 'license-expired', customer: v.customer, expires: v.expires };
    }
    if (mem.tampered) return { ...base, state: 'expired', reason: 'tampered' };
    const left = mem.i + TRIAL_DAYS * DAY - eff;
    if (left > 0) return { ...base, state: 'trial', maxRecords: TRIAL_MAX_RECORDS, msLeft: left };
    return { ...base, state: 'expired', reason: 'trial-ended' };
  }

  function activate(key) {
    if (!mem) load();
    const eff = Math.max(now(), mem.l);
    const v = verifyKey(key, machineId, eff);
    if (!v.ok) return { ok: false, error: v.error };
    mem = { i: mem.tampered ? 0 : mem.i, l: eff, k: String(key).replace(/\s+/g, '') };
    persist();
    return { ok: true, status: status() };
  }

  return { status, activate };
}

module.exports = { createManager, verifyKey, systemMachineId, normId, TRIAL_DAYS, TRIAL_MAX_RECORDS, PUBLIC_KEY_JWK };
