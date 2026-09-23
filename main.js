const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { createStore } = require('./storage');
const { createManager, systemMachineId } = require('./license');
const { execFileSync } = require('child_process');

let win;

// ملف البيانات داخل مجلد بيانات المستخدم — يبقى محفوظاً بعد إغلاق البرنامج
const dbFile = () => path.join(app.getPath('userData'), 'data.json');

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: 'إدارة العقارات والعملاء',
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile('index.html');
  // منع فتح نوافذ جديدة داخل البرنامج
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- التخزين ----------
let _store;
const store = () => (_store = _store || createStore(app.getPath('userData')));
let knownCount = 0; // عدد العقارات المحفوظ حالياً (لمنع تجاوز حد النسخة التجريبية)
ipcMain.handle('db:load', async () => {
  try {
    const data = await store().load();
    knownCount = data && Array.isArray(data.records) ? data.records.length : 0;
    return data;
  } catch (e) {
    return null;
  }
});

// ---------- التفعيل ----------
// نسخ متعددة لبيانات الفترة التجريبية في أماكن مختلفة، فلا تُعاد الفترة بمجرد حذف مجلد البيانات.
// على ماك، يُحفظ مفتاح التفعيل أيضاً في سلسلة المفاتيح (Keychain) — مكان مستقل عن ملفات البرنامج
// تماماً، فحذف البرنامج (أو حتى بياناته) وإعادة تثبيته يستعيد التفعيل تلقائياً دون إعادة إدخال المفتاح.
const KC_SERVICE = 'com.ibrahim.realestatemanager.license';
function macKeystore() {
  if (process.platform !== 'darwin') return null;
  const account = (os.userInfo().username || 'user').replace(/[^\w.-]/g, '_');
  return {
    get: () => {
      try {
        const out = execFileSync('security', ['find-generic-password', '-a', account, '-s', KC_SERVICE, '-w'], { encoding: 'utf8', timeout: 5000 });
        return out.trim() || null;
      } catch (e) {
        return null; // لا يوجد مفتاح محفوظ، أو سلسلة المفاتيح غير متاحة
      }
    },
    set: (key) => {
      try {
        execFileSync('security', ['add-generic-password', '-a', account, '-s', KC_SERVICE, '-w', key, '-U'], { timeout: 5000 });
      } catch (e) {}
    }
  };
}
let _lic;
const lic = () =>
  (_lic =
    _lic ||
    createManager({
      files: [
        path.join(app.getPath('userData'), 'license.dat'),
        path.join(app.getPath('appData'), '.rem-cache.dat'),
        path.join(os.homedir(), '.rem-cache.dat')
      ],
      machineId: systemMachineId(),
      keystore: macKeystore()
    }));
ipcMain.handle('license:status', () => lic().status());
ipcMain.handle('license:activate', (_e, key) => lic().activate(String(key || '')));

// يُرجع كائن رفض إن لم يُسمح بالحفظ (البرنامج مقفل، أو تجاوز حدّ النسخة التجريبية)
function checkSave(recordCount) {
  const st = lic().status();
  if (st.state === 'expired') return { ok: false, locked: true, reason: st.reason };
  if (st.state === 'trial' && recordCount > st.maxRecords && recordCount > knownCount) {
    return { ok: false, limit: true, max: st.maxRecords };
  }
  return null;
}

// ---------- النسخ الاحتياطي التلقائي (بعد كل عملية حفظ) ----------
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) {}
  const b = c.backup || {};
  return { enabled: b.enabled !== false, dir: b.dir || null, keep: Math.min(200, Math.max(5, Number(b.keep) || 20)) };
}
function saveCfg(b) {
  fs.writeFileSync(cfgFile(), JSON.stringify({ backup: b }), 'utf8');
}
const backupDir = (cfg) => (cfg || loadCfg()).dir || path.join(app.getPath('userData'), 'backups');
const BACKUP_NAME = /^backup-[\d_-]+\.json$/;
let lastHash = '';

async function autoBackup(json) {
  const cfg = loadCfg();
  if (!cfg.enabled) return;
  const hash = crypto.createHash('sha1').update(json).digest('hex');
  if (hash === lastHash) return; // لا تغيير عن آخر نسخة
  const dir = backupDir(cfg);
  await fs.promises.mkdir(dir, { recursive: true });
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const name = `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}.json`;
  await fs.promises.writeFile(path.join(dir, name), json, 'utf8');
  lastHash = hash;
  // الاحتفاظ بآخر N نسخة فقط
  const files = (await fs.promises.readdir(dir)).filter((f) => BACKUP_NAME.test(f)).sort().reverse();
  for (const f of files.slice(cfg.keep)) await fs.promises.unlink(path.join(dir, f)).catch(() => {});
}

// النسخ الاحتياطي الكامل (مع الصور) لا يُنشأ عند كل حفظ حتى لا يثقل البرنامج:
// أول نسخة فوراً، ثم كحد أقصى مرة كل بضع دقائق، وتُنشأ نسخة أخيرة عند إغلاق البرنامج.
const BACKUP_MIN_GAP = 3 * 60 * 1000;
let lastBackupAt = 0;
let backupTimer = null;
let backupPending = false;
let lastBackupError = null;

async function runBackup() {
  backupTimer = null;
  backupPending = false;
  try {
    const json = await store().exportFull();
    if (json) await autoBackup(json);
    lastBackupError = null;
  } catch (e) {
    lastBackupError = String(e.message || e);
  }
  lastBackupAt = Date.now();
}
function scheduleBackup(now) {
  backupPending = true;
  if (backupTimer && !now) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(runBackup, now ? 0 : Math.max(0, lastBackupAt + BACKUP_MIN_GAP - Date.now()));
}

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !backupPending) return;
  e.preventDefault();
  quitting = true;
  clearTimeout(backupTimer);
  Promise.race([runBackup(), new Promise((r) => setTimeout(r, 10000))]).finally(() => app.quit());
});

// حفظ جزئي: بيانات العقارات الخفيفة + صور العقارات التي تغيّرت فقط
ipcMain.handle('db:savePart', async (_e, payload) => {
  const denied = checkSave((payload.records || []).length);
  if (denied) return denied;
  await store().save(payload);
  knownCount = (payload.records || []).length;
  scheduleBackup(!!payload.forceBackup);
  return { ok: true, backupError: lastBackupError };
});

// حفظ كامل (احتياطي للتوافق)
ipcMain.handle('db:save', async (_e, data) => {
  const denied = checkSave((data.records || []).length);
  if (denied) return denied;
  const photos = {};
  (data.records || []).forEach((r) => {
    photos[r.id] = Array.isArray(r.photos) && r.photos.length ? r.photos : r.photo ? [r.photo] : [];
  });
  await store().save({ records: data.records || [], areas: data.areas, settings: data.settings, photos });
  knownCount = (data.records || []).length;
  scheduleBackup(false);
  return { ok: true, backupError: lastBackupError };
});

ipcMain.handle('backup:config:get', () => {
  const cfg = loadCfg();
  return { enabled: cfg.enabled, dir: backupDir(cfg), keep: cfg.keep };
});
ipcMain.handle('backup:config:set', (_e, patch) => {
  const cfg = Object.assign(loadCfg(), patch || {});
  cfg.keep = Math.min(200, Math.max(5, Number(cfg.keep) || 20));
  saveCfg(cfg);
  lastHash = ''; // بعد تغيير الإعدادات تُنشأ نسخة جديدة عند الحفظ التالي
  return true;
});
ipcMain.handle('backup:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'اختيار مجلد النسخ الاحتياطي', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('backup:list', async () => {
  const dir = backupDir();
  try {
    const files = (await fs.promises.readdir(dir)).filter((f) => BACKUP_NAME.test(f)).sort().reverse();
    const out = [];
    for (const name of files.slice(0, 50)) {
      const st = await fs.promises.stat(path.join(dir, name));
      out.push({ name, mtime: st.mtimeMs, size: st.size });
    }
    return out;
  } catch (e) {
    return [];
  }
});
ipcMain.handle('backup:restore', (_e, name) => {
  if (!BACKUP_NAME.test(String(name))) return null;
  try { return fs.readFileSync(path.join(backupDir(), name), 'utf8'); } catch (e) { return null; }
});
ipcMain.handle('backup:openDir', async () => {
  const dir = backupDir();
  await fs.promises.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});

// ---------- روابط خارجية (واتساب / الخرائط) ----------
ipcMain.handle('open:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// ---------- نسخ صورة إلى الحافظة (للصقها في واتساب) ----------
ipcMain.handle('clipboard:image', (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) return false;
  clipboard.writeImage(img);
  return true;
});

// ---------- سحب وإفلات الصور إلى واتساب ----------
// تُكتب صور العقار كملفات مؤقتة (photo-01.jpg ...) ثم تُسحب من نافذة البرنامج كملفات حقيقية إلى المحادثة.
const shareRoot = () => path.join(app.getPath('temp'), 'RealEstateManager-share');
let dragFiles = [];
let dragIcon = null;
let prepToken = 0;

function cleanShare(all) {
  try {
    const root = shareRoot();
    if (!fs.existsSync(root)) return;
    if (all) return fs.rmSync(root, { recursive: true, force: true });
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d);
      if (Date.now() - fs.statSync(p).mtimeMs > 60 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (e) {}
}
app.on('will-quit', () => cleanShare(true));

ipcMain.handle('share:prepare', async (_e, photos) => {
  const token = ++prepToken;
  dragFiles = [];
  dragIcon = null;
  if (!Array.isArray(photos) || !photos.length) return 0;
  try {
    cleanShare(false);
    const dir = path.join(shareRoot(), String(Date.now()));
    await fs.promises.mkdir(dir, { recursive: true });
    const out = [];
    for (let i = 0; i < photos.length; i++) {
      const src = String(photos[i] || '');
      const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/i.exec(src);
      let buf;
      let ext;
      if (m) {
        buf = Buffer.from(m[2], 'base64');
        ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
      } else {
        const img = nativeImage.createFromDataURL(src);
        if (img.isEmpty()) { out.push(null); continue; }
        buf = img.toJPEG(92);
        ext = 'jpg';
      }
      const file = path.join(dir, `photo-${String(i + 1).padStart(2, '0')}.${ext}`);
      await fs.promises.writeFile(file, buf);
      out.push(file);
    }
    if (token !== prepToken) return 0; // طلب أحدث حلّ محلّ هذا
    dragFiles = out;
    const first = out.find(Boolean);
    if (first) {
      const ic = nativeImage.createFromPath(first);
      dragIcon = ic.isEmpty() ? null : ic.resize({ width: 64 });
    }
    return out.filter(Boolean).length;
  } catch (e) {
    return 0;
  }
});

ipcMain.on('share:startDrag', (e, idx) => {
  const files = (Array.isArray(idx) ? idx : [])
    .filter((i) => Number.isInteger(i))
    .map((i) => dragFiles[i])
    .filter(Boolean);
  if (!files.length || !dragIcon) return;
  try {
    e.sender.startDrag({ file: files[0], files, icon: dragIcon });
  } catch (err) {}
});

// ---------- الطباعة ----------
ipcMain.handle('print', (_e, pageSize) => {
  return new Promise((resolve) => {
    win.webContents.print(
      { silent: false, printBackground: true, pageSize: pageSize || 'A4', margins: { marginType: 'none' } },
      (success, reason) => resolve({ success, reason })
    );
  });
});

// ---------- تصدير Excel و PDF ----------
const safeName = (n, ext) => {
  const base = path.basename(String(n || '')).replace(/[\\/:*?"<>|]/g, '-').trim();
  return base || 'export.' + ext;
};

ipcMain.handle('export:xlsx', async (_e, bytes, name) => {
  try {
    const r = await dialog.showSaveDialog(win, {
      title: 'حفظ ملف Excel',
      defaultPath: safeName(name, 'xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// الـ PDF: تُعرض الصفحة في نافذة مخفية (بدون JavaScript) ثم تُحوَّل بـ printToPDF المدمج في Electron
ipcMain.handle('export:pdf', async (_e, html, name) => {
  let pdfWin = null;
  try {
    const r = await dialog.showSaveDialog(win, {
      title: 'حفظ ملف PDF',
      defaultPath: safeName(name, 'pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };

    const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
    const doc =
      '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>' + css +
      '\n@page{size:A4;margin:14mm}' +
      '\nhtml,body{background:#fff;height:auto}' +
      '\n.sheet{box-shadow:none;width:auto;min-height:0;padding:0;font-size:14px}' +
      '</style></head><body><div class="sheet">' + String(html) + '</div></body></html>';

    pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
    });
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc));
    const pdf = await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
    await fs.promises.writeFile(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.destroy();
  }
});

// ---------- النسخ الاحتياطي ----------
ipcMain.handle('backup:export', async (_e, json) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'حفظ نسخة احتياطية',
    defaultPath: 'نسخة-العقارات.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, json, 'utf8');
  return true;
});

ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'استيراد نسخة احتياطية',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});
