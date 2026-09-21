'use strict';

const FACADES = ['شمال', 'جنوب', 'شرق', 'غرب', 'شمال شرق', 'شمال غرب', 'جنوب شرق', 'جنوب غرب'];

const MAX_PHOTOS = 10;
const TYPES = ['بيت', 'شقة', 'أرض', 'محل', 'عمارة', 'مكتب'];
const LAND = 'أرض'; // لا تظهر له الغرف والحمامات والطوابق
const LAND_TYPES = ['سكنية', 'تجارية', 'زراعية', 'صناعية', 'سكنية تجارية']; // نوع القطعة (للأراضي فقط)
const STATUSES = ['للبيع', 'للإيجار', 'محجوز', 'مباع', 'مؤجر'];
const SOLD = 'مباع'; // الحالة التي تُحسب كـ «مباع» في الإحصائيات (المؤجر لا يُحسب)
const STATUS_CLASS = { 'للبيع': 'st-sale', 'للإيجار': 'st-rent', 'محجوز': 'st-reserved', 'مباع': 'st-sold', 'مؤجر': 'st-sold' };
const COUNTRY_CODE = '964'; // مفتاح الدولة ثابت

const DEFAULT_TPL =
  'السلام عليكم {الاسم}،\n' +
  'تفاصيل العقار:\n' +
  'النوع: {النوع}\n' +
  'المنطقة: {المنطقة}\n' +
  'رقم المقاطعة: {المقاطعة}\n' +
  'المساحة: {المساحة} م²\n' +
  'الواجهة: {الواجهة}\n' +
  'سنة البناء: {السنة}\n' +
  'السعر: {السعر}\n' +
  'الموقع: {الموقع}\n\n' +
  '{المكتب}';

// القالب الافتراضي قبل إضافة «رقم المقاطعة»: إن وُجد محفوظاً كما هو (لم يعدّله المستخدم) يُرقّى إلى الجديد
const LEGACY_TPL = DEFAULT_TPL.replace('رقم المقاطعة: {المقاطعة}\n', '');
const upgradeSettings = (st) => (st && st.tpl === LEGACY_TPL ? Object.assign({}, st, { tpl: DEFAULT_TPL }) : st);

let db = {
  records: [],
  areas: [],
  settings: { office: '', officePhone: '', tpl: DEFAULT_TPL }
};
let currentPhotos = [];
let waRec = null;
let preview = { type: 'one', id: null };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toLatin = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

// الصور تُرسل للحفظ فقط للعقارات التي تغيّرت صورها، أما باقي البيانات فخفيفة — فلا يتباطأ البرنامج مع كثرة الصور
const dirtyPhotos = new Set();
const lite = (r) => {
  const { photos, photo, ...rest } = r;
  return rest;
};
async function persist(opts = {}) {
  let r;
  if (typeof window.api.savePart === 'function') {
    const ids = [...dirtyPhotos];
    dirtyPhotos.clear();
    const photos = {};
    ids.forEach((id) => {
      const rec = db.records.find((x) => x.id === id);
      if (rec) photos[id] = photosOf(rec);
    });
    try {
      r = await window.api.savePart({ records: db.records.map(lite), areas: db.areas, settings: db.settings, photos, forceBackup: !!opts.forceBackup });
    } catch (err) {
      ids.forEach((id) => dirtyPhotos.add(id));
      throw err;
    }
  } else {
    r = await window.api.save(db);
  }
  if (r && r.backupError) toast('تعذّر النسخ الاحتياطي التلقائي — تحقق من مجلد النسخ في الإعدادات');
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

// ---------- التبويبات ----------
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'print') fillPrintSelect();
  if (name === 'stats') renderStats();
  if (name === 'print' || name === 'settings') refreshAreas();
  if (name === 'settings') refreshBackups();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
$('#btnAboutWa').addEventListener('click', () => window.api.openExternal('https://wa.me/9647736970504'));

// ---------- الصور ----------
const photosOf = (r) => (Array.isArray(r.photos) && r.photos.length ? r.photos : r.photo ? [r.photo] : []);

// ---------- السعر والحالة ----------
function fmtPrice(r) {
  const n = Number(r.price);
  if (!r.price || !isFinite(n)) return '';
  return n.toLocaleString('en-US') + ' ' + (r.currency === 'USD' ? 'دولار' : 'دينار');
}
const badge = (r) => (r.status ? `<span class="badge ${STATUS_CLASS[r.status] || ''}">${esc(r.status)}</span>` : '');

// ---------- الموقع ----------
function mapUrl(loc) {
  const v = toLatin(loc).trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)) {
    return 'https://www.google.com/maps?q=' + encodeURIComponent(v.replace(/\s+/g, ''));
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v);
}

// ---------- واتساب ----------
function normPhone(p) {
  let d = toLatin(p).replace(/\D/g, '');
  if (!d) return '';
  const cc = COUNTRY_CODE;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (d.length <= 10) d = cc + d;
  return d;
}

function fillTemplate(r) {
  const map = {
    '{الاسم}': r.clientName,
    '{المنطقة}': r.area,
    '{المقاطعة}': r.district,
    '{المساحة}': r.size,
    '{النزال}': r.depth,
    '{الواجهة}': r.facade,
    '{السنة}': r.year,
    '{النوع}': r.type,
    '{نوع القطعة}': r.landType,
    '{الغرف}': r.rooms,
    '{السعر}': fmtPrice(r),
    '{الحالة}': r.status,
    '{الموقع}': mapUrl(r.location),
    '{المكتب}': db.settings.office
  };
  let t = db.settings.tpl || DEFAULT_TPL;
  for (const k in map) t = t.split(k).join(map[k] || '-');
  return t.trim();
}

function openWa(r) {
  waRec = r;
  $('#wa-phone').value = r.phone || '';
  $('#wa-text').value = fillTemplate(r);
  const ph = photosOf(r);
  $('#wa-photos-box').hidden = !ph.length;
  $('#wa-photos').innerHTML = ph.map((p, i) => `<div class="g-item pick" data-i="${i}" style="background-image:url('${p}')"></div>`).join('');
  $('#waModal').hidden = false;
}
$('#wa-close').addEventListener('click', () => ($('#waModal').hidden = true));
$('#wa-open').addEventListener('click', () => {
  const phone = normPhone($('#wa-phone').value);
  if (!phone) return toast('أدخل رقم الجوال');
  window.api.openExternal('https://wa.me/' + phone + '?text=' + encodeURIComponent($('#wa-text').value));
});
$('#wa-photos').addEventListener('click', async (e) => {
  const it = e.target.closest('.pick');
  if (!it || !waRec) return;
  const p = photosOf(waRec)[Number(it.dataset.i)];
  const ok = p ? await window.api.copyImage(p) : false;
  toast(ok ? 'تم نسخ الصورة — الصقها في المحادثة' : 'تعذّر نسخ الصورة');
});

// ---------- المناطق المحفوظة ----------
const NO_AREA = 'بدون منطقة';
const cleanArea = (v) => String(v || '').replace(/\s+/g, ' ').trim();
function addArea(name) {
  if (name && !db.areas.includes(name)) db.areas.push(name);
}
function refreshAreas() {
  const counts = {};
  db.records.forEach((r) => { if (r.area) counts[r.area] = (counts[r.area] || 0) + 1; });
  db.areas = [...new Set([...(db.areas || []), ...Object.keys(counts)])].sort((a, b) => a.localeCompare(b, 'ar'));
  $('#areaList').innerHTML = db.areas.map((a) => `<option value="${esc(a)}"></option>`).join('');
  const fill = (sel) => {
    const el = $(sel);
    const cur = el.value;
    el.innerHTML =
      '<option value="">كل المناطق</option>' +
      db.areas.map((a) => `<option value="${esc(a)}">${esc(a)}${counts[a] ? ' (' + counts[a] + ')' : ''}</option>`).join('');
    el.value = db.areas.includes(cur) ? cur : '';
  };
  fill('#areaFilter');
  fill('#printArea');
  $('#areaChips').innerHTML = db.areas.length
    ? db.areas
        .map((a) => `<span class="chip">${esc(a)} <b>${counts[a] || 0}</b>${counts[a] ? '' : `<button data-area="${esc(a)}" title="حذف المنطقة">×</button>`}</span>`)
        .join('')
    : '<span class="hint">لا توجد مناطق محفوظة بعد.</span>';
}
$('#areaFilter').addEventListener('change', renderList);
$('#statusFilter').addEventListener('change', renderList);
$('#typeFilter').addEventListener('change', renderList);
$('#areaChips').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-area]');
  if (!b) return;
  db.areas = db.areas.filter((a) => a !== b.dataset.area);
  await persist();
  refreshAreas();
});
$('#btnAddArea').addEventListener('click', async () => {
  const v = cleanArea($('#newArea').value);
  if (!v) return;
  addArea(v);
  $('#newArea').value = '';
  await persist();
  refreshAreas();
  toast('تمت إضافة المنطقة');
});

// ---------- النموذج ----------
const FIELDS = ['clientName', 'phone', 'area', 'district', 'size', 'depth', 'year', 'rooms', 'baths', 'floors', 'price', 'location', 'notes'];

function toggleHouseFields() {
  const isLand = $('#f-type').value === LAND;
  $$('.house-only').forEach((el) => (el.hidden = isLand));
  $$('.land-only').forEach((el) => (el.hidden = !isLand));
}
$('#f-type').addEventListener('change', toggleHouseFields);

function initFacades() {
  $('#a-facade').innerHTML = '<option value="">كل الواجهات</option>' + FACADES.map((f) => `<option>${f}</option>`).join('');
  $('#f-type').innerHTML = '<option value="">— اختر —</option>' + TYPES.map((x) => `<option>${x}</option>`).join('');
  $('#f-landType').innerHTML = '<option value="">— اختر —</option>' + LAND_TYPES.map((x) => `<option>${x}</option>`).join('');
  $('#typeFilter').innerHTML = '<option value="">كل الأنواع</option>' + TYPES.map((x) => `<option>${x}</option>`).join('');
  $('#f-status').innerHTML = STATUSES.map((x) => `<option>${x}</option>`).join('');
  $('#statusFilter').innerHTML = '<option value="">كل الحالات</option>' + STATUSES.map((x) => `<option>${x}</option>`).join('');
  $('#f-facade').innerHTML =
    '<option value="">— اختر —</option>' + FACADES.map((f) => `<option>${f}</option>`).join('');
}

function renderGallery() {
  $('#gallery').innerHTML = currentPhotos.length
    ? currentPhotos
        .map(
          (p, i) => `<div class="g-item" style="background-image:url('${p}')">
            ${i === 0 ? '<span class="g-main">الرئيسية</span>' : `<button type="button" class="g-set" data-main="${i}" title="جعلها الصورة الرئيسية">★</button>`}
            <button type="button" class="g-del" data-del="${i}" title="حذف الصورة">×</button>
          </div>`
        )
        .join('')
    : '<div class="g-empty">لا توجد صور</div>';
}
$('#gallery').addEventListener('click', (e) => {
  const d = e.target.closest('[data-del]');
  const m = e.target.closest('[data-main]');
  if (d) currentPhotos.splice(Number(d.dataset.del), 1);
  else if (m) currentPhotos.unshift(currentPhotos.splice(Number(m.dataset.main), 1)[0]);
  else return;
  renderGallery();
});

function resetForm() {
  $('#f-id').value = '';
  FIELDS.forEach((k) => ($('#f-' + k).value = ''));
  $('#f-facade').value = '';
  $('#f-status').value = 'للبيع';
  $('#f-currency').value = 'IQD';
  $('#f-type').value = '';
  $('#f-landType').value = '';
  toggleHouseFields();
  $('#f-photo').value = '';
  currentPhotos = [];
  renderGallery();
  $('#formTitle').textContent = 'إضافة عقار جديد';
}

function editRecord(id) {
  const r = db.records.find((x) => x.id === id);
  if (!r) return;
  resetForm();
  $('#f-id').value = r.id;
  FIELDS.forEach((k) => ($('#f-' + k).value = r[k] || ''));
  $('#f-facade').value = r.facade || '';
  $('#f-status').value = r.status || 'للبيع';
  $('#f-currency').value = r.currency || 'IQD';
  $('#f-type').value = r.type || '';
  $('#f-landType').value = r.landType || '';
  toggleHouseFields();
  currentPhotos = photosOf(r).slice();
  renderGallery();
  $('#formTitle').textContent = 'تعديل العقار';
  showTab('form');
}

// صورة مصغّرة صغيرة الحجم للقائمة (بدل تحميل الصور الكاملة لكل بطاقة)
function makeThumb(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve('');
    img.onload = () => {
      const ratio = Math.min(1, 260 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * ratio));
      c.height = Math.max(1, Math.round(img.height * ratio));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  });
}
// إنشاء المصغّرات للعقارات القديمة تدريجياً في الخلفية دون تجميد الواجهة
async function backfillThumbs() {
  const todo = db.records.filter((r) => !r.thumb && photosOf(r).length);
  if (!todo.length) return;
  for (const r of todo) {
    r.thumb = await makeThumb(photosOf(r)[0]);
    await new Promise((res) => setTimeout(res, 25));
  }
  renderList();
  await persist();
}

function compress(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onerror = () => resolve(null);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        // تصغير الصورة للحفاظ على حجم الملف
        const ratio = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
$('#f-photo').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    if (currentPhotos.length >= MAX_PHOTOS) {
      toast('الحد الأقصى ' + MAX_PHOTOS + ' صور');
      break;
    }
    const d = await compress(f);
    if (d) currentPhotos.push(d);
  }
  renderGallery();
});
$('#btnTestMap').addEventListener('click', () => {
  const u = mapUrl($('#f-location').value);
  if (!u) return toast('أدخل الموقع أولاً');
  window.api.openExternal(u);
});
$('#btnCancelForm').addEventListener('click', () => {
  resetForm();
  showTab('list');
});

$('#recForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#f-id').value;
  const old = db.records.find((x) => x.id === id);
  const rec = {
    id: id || String(Date.now()),
    createdAt: old ? old.createdAt : new Date().toISOString(),
    facade: $('#f-facade').value,
    type: $('#f-type').value,
    landType: $('#f-type').value === LAND ? $('#f-landType').value : '',
    status: $('#f-status').value,
    currency: $('#f-currency').value,
    photos: currentPhotos.slice()
  };
  rec.thumb = !currentPhotos[0] ? '' : old && old.thumb && photosOf(old)[0] === currentPhotos[0] ? old.thumb : await makeThumb(currentPhotos[0]);
  if (!old || JSON.stringify(photosOf(old)) !== JSON.stringify(currentPhotos)) dirtyPhotos.add(rec.id);
  const numeric = ['phone', 'district', 'size', 'depth', 'year', 'rooms', 'baths', 'floors']; // تُحوَّل الأرقام العربية إلى لاتينية
  FIELDS.forEach((k) => {
    const v = $('#f-' + k).value.trim();
    rec[k] = numeric.includes(k) ? toLatin(v) : v;
  });
  rec.price = toLatin(rec.price).replace(/[^\d.]/g, '');
  if (rec.type === LAND) { rec.rooms = ''; rec.baths = ''; rec.floors = ''; }
  rec.area = cleanArea(rec.area);
  addArea(rec.area);
  if (old) db.records[db.records.indexOf(old)] = rec;
  else db.records.unshift(rec);
  await persist();
  refreshAreas();
  resetForm();
  renderList();
  showTab('list');
  toast('تم الحفظ');
});

// ---------- القائمة ----------
function card(r) {
  const ph = photosOf(r);
  const thumb = ph.length
    ? `<div class="thumb" style="background-image:url('${r.thumb || ph[0]}')">${ph.length > 1 ? `<span class="thumb-n">${ph.length} صور</span>` : ''}</div>`
    : `<div class="thumb">بدون صورة</div>`;
  const meta = [
    r.type && `<span>النوع: <b>${esc(r.type)}</b></span>`,
    r.landType && `<span>نوع القطعة: <b>${esc(r.landType)}</b></span>`,
    r.area && `<span>المنطقة: <b>${esc(r.area)}</b></span>`,
    r.district && `<span>رقم المقاطعة: <b>${esc(r.district)}</b></span>`,
    r.size && `<span>المساحة: <b>${esc(r.size)} م²</b></span>`,
    r.depth && `<span>النزال: <b>${esc(r.depth)} م</b></span>`,
    r.facade && `<span>الواجهة: <b>${esc(r.facade)}</b></span>`,
    r.year && `<span>سنة البناء: <b>${esc(r.year)}</b></span>`,
    r.rooms && `<span>الغرف: <b>${esc(r.rooms)}</b></span>`,
    r.baths && `<span>الحمامات: <b>${esc(r.baths)}</b></span>`,
    r.floors && `<span>الطوابق: <b>${esc(r.floors)}</b></span>`,
    r.price && `<span>السعر: <b>${esc(fmtPrice(r))}</b></span>`,
    r.phone && `<span>الجوال: <b>${esc(r.phone)}</b></span>`
  ]
    .filter(Boolean)
    .join('');
  return `<article class="item">
    ${thumb}
    <div><h3>${esc(r.clientName)}${badge(r)}</h3><div class="meta">${meta}</div></div>
    <div class="item-actions">
      <button class="btn wa small" data-a="wa" data-id="${r.id}">واتساب</button>
      ${r.location ? `<button class="btn ghost small" data-a="map" data-id="${r.id}">الموقع</button>` : ''}
      <button class="btn ghost small" data-a="print" data-id="${r.id}">طباعة</button>
      <button class="btn ghost small" data-a="edit" data-id="${r.id}">تعديل</button>
      <button class="btn danger small" data-a="del" data-id="${r.id}">حذف</button>
    </div>
  </article>`;
}

// ---------- التصفية المتقدمة ----------
const num = (v) => {
  const n = parseFloat(toLatin(v).replace(/[^\d.]/g, ''));
  return isNaN(n) ? null : n;
};
function getAdv() {
  const g = (id) => num($('#a-' + id).value);
  return {
    facade: $('#a-facade').value,
    sizeMin: g('sizeMin'), sizeMax: g('sizeMax'),
    yearMin: g('yearMin'), yearMax: g('yearMax'),
    priceMin: g('priceMin'), priceMax: g('priceMax'),
    currency: $('#a-currency').value,
    rooms: g('rooms'), baths: g('baths')
  };
}
function advActive(a) {
  return (
    (a.facade ? 1 : 0) +
    (a.sizeMin !== null || a.sizeMax !== null ? 1 : 0) +
    (a.yearMin !== null || a.yearMax !== null ? 1 : 0) +
    (a.priceMin !== null || a.priceMax !== null ? 1 : 0) +
    (a.rooms !== null ? 1 : 0) +
    (a.baths !== null ? 1 : 0)
  );
}
function inRange(v, min, max) {
  if (min === null && max === null) return true;
  const n = num(v);
  if (n === null) return false;
  return (min === null || n >= min) && (max === null || n <= max);
}
function matchAdv(r, a) {
  if (a.facade && r.facade !== a.facade) return false;
  if (!inRange(r.size, a.sizeMin, a.sizeMax)) return false;
  if (!inRange(r.year, a.yearMin, a.yearMax)) return false;
  if (a.priceMin !== null || a.priceMax !== null) {
    if ((r.currency || 'IQD') !== a.currency) return false;
    if (!inRange(r.price, a.priceMin, a.priceMax)) return false;
  }
  if (a.rooms !== null) { const n = num(r.rooms); if (n === null || n < a.rooms) return false; }
  if (a.baths !== null) { const n = num(r.baths); if (n === null || n < a.baths) return false; }
  return true;
}
let lastIds = [];
const PAGE = 40; // عدد البطاقات المعروضة في كل دفعة
let listLimit = PAGE;
let listSig = '';
let moreObs;

function renderList() {
  const q = toLatin($('#search').value).trim().toLowerCase();
  const af = $('#areaFilter').value;
  const sf = $('#statusFilter').value;
  const tf = $('#typeFilter').value;
  const adv = getAdv();
  const rows = db.records.filter(
    (r) => (!af || r.area === af) && (!sf || r.status === sf) && (!tf || r.type === tf) && matchAdv(r, adv) && toLatin([r.clientName, r.area, r.district, r.phone].join(' ')).toLowerCase().includes(q)
  );
  const advN = advActive(adv);
  const filtered = !!(af || sf || tf || q || advN);
  lastIds = rows.map((r) => r.id);
  const sig = [q, af, sf, tf, JSON.stringify(adv)].join('|');
  if (sig !== listSig) { listSig = sig; listLimit = PAGE; } // تغيّر البحث/الفلتر: ابدأ من أول القائمة
  $('#count').textContent = filtered ? `${rows.length} من ${db.records.length} عقار` : rows.length + ' عقار';
  $('#advCount').hidden = !advN;
  $('#advCount').textContent = advN;
  $('#btnClearAll').hidden = !filtered;
  if (!rows.length) {
    $('#list').innerHTML = `<div class="empty">${db.records.length ? 'لا توجد نتائج مطابقة' : 'لم تضف أي عقار بعد. افتح تبويب «إضافة عقار» للبدء.'}</div>`;
    return;
  }
  const parts = [];
  let shown = 0;
  const emit = (arr) => {
    for (const r of arr) {
      if (shown >= listLimit) return;
      parts.push(card(r));
      shown++;
    }
  };
  if (af) {
    emit(rows);
  } else {
    // عرض مجمّع حسب المنطقة
    const groups = {};
    rows.forEach((r) => { (groups[r.area || NO_AREA] = groups[r.area || NO_AREA] || []).push(r); });
    const keys = Object.keys(groups).sort((a, b) => (a === NO_AREA ? 1 : b === NO_AREA ? -1 : a.localeCompare(b, 'ar')));
    for (const k of keys) {
      if (shown >= listLimit) break;
      parts.push(`<h3 class="group-title"><span>${esc(k)}</span><span>${groups[k].length}</span></h3>`);
      emit(groups[k]);
    }
  }
  if (shown < rows.length) parts.push(`<div class="more"><button type="button" class="btn ghost" id="btnMore">عرض المزيد (${rows.length - shown})</button></div>`);
  $('#list').innerHTML = parts.join('');
  watchMore();
}
function showMore() {
  listLimit += PAGE;
  renderList();
}
// تحميل الدفعة التالية تلقائياً عند الاقتراب من نهاية القائمة
function watchMore() {
  if (moreObs) moreObs.disconnect();
  const b = $('#btnMore');
  if (!b || !('IntersectionObserver' in window)) return;
  moreObs = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) showMore(); }, { rootMargin: '600px' });
  moreObs.observe(b);
}
$('#list').addEventListener('click', (e) => { if (e.target.closest('#btnMore')) showMore(); });
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 200); });
$('#btnAdv').addEventListener('click', () => ($('#advPanel').hidden = !$('#advPanel').hidden));
$$('#advPanel input, #advPanel select').forEach((el) => {
  el.addEventListener('input', renderList);
  el.addEventListener('change', renderList);
});
$('#btnClearAll').addEventListener('click', () => {
  ['#areaFilter', '#statusFilter', '#typeFilter', '#search', '#a-facade'].forEach((id) => ($(id).value = ''));
  $$('#advPanel input').forEach((el) => (el.value = ''));
  $('#a-currency').value = 'IQD';
  renderList();
});
$('#btnPrintResults').addEventListener('click', () => {
  if (!lastIds.length) return toast('لا توجد نتائج للطباعة');
  openPreview('all', null, '', lastIds);
});

$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const r = db.records.find((x) => x.id === b.dataset.id);
  if (!r) return;
  switch (b.dataset.a) {
    case 'wa': openWa(r); break;
    case 'map': window.api.openExternal(mapUrl(r.location)); break;
    case 'print': openPreview('one', r.id); break;
    case 'edit': editRecord(r.id); break;
    case 'del':
      if (confirm('حذف عقار «' + r.clientName + '»؟ لا يمكن التراجع.')) {
        db.records = db.records.filter((x) => x.id !== r.id);
        await persist();
        refreshAreas();
        renderList();
        toast('تم الحذف');
      }
      break;
  }
});

// ---------- الطباعة والمعاينة ----------
function fillPrintSelect() {
  $('#printRecord').innerHTML = db.records.length
    ? db.records.map((r) => `<option value="${r.id}">${esc(r.clientName)}${r.area ? ' — ' + esc(r.area) : ''}</option>`).join('')
    : '<option value="">لا توجد عقارات</option>';
}
$('#btnPrintOne').addEventListener('click', () => {
  const id = $('#printRecord').value;
  if (!id) return toast('لا يوجد عقار للطباعة');
  openPreview('one', id);
});
$('#btnPrintAll').addEventListener('click', () => {
  const area = $('#printArea').value;
  if (!db.records.some((r) => !area || r.area === area)) return toast('لا توجد عقارات للطباعة');
  openPreview('all', null, area);
});

function sheetHead(title) {
  const s = db.settings;
  return `<div class="sh-head">
      <div class="sh-office">${esc(s.office || 'مكتب العقارات')}</div>
      ${s.officePhone ? `<div>${esc(s.officePhone)}</div>` : ''}
    </div>
    <div class="sh-title">${title}</div>`;
}

function sheetHTML() {
  const date = new Date().toLocaleDateString('ar-u-ca-gregory-nu-latn');
  if (preview.type === 'all') {
    const list = db.records
      .filter((r) => (preview.ids ? preview.ids.includes(r.id) : !preview.area || r.area === preview.area))
      .sort((a, b) => (a.area ? 0 : 1) - (b.area ? 0 : 1) || (a.area || '').localeCompare(b.area || '', 'ar'));
    const rows = list
      .map(
        (r, i) => `<tr><td>${i + 1}</td><td>${esc(r.clientName)}</td><td>${esc(r.area)}</td><td>${esc(r.district)}</td><td>${esc(r.type)}${r.landType ? ' — ' + esc(r.landType) : ''}</td>
          <td>${esc(r.size)}</td><td>${esc(r.facade)}</td><td>${esc(r.year)}</td><td>${esc(r.phone)}</td><td>${esc(fmtPrice(r))}</td><td>${esc(r.status)}</td></tr>`
      )
      .join('');
    return `${sheetHead('قائمة العقارات' + (preview.ids ? ' (نتائج التصفية)' : preview.area ? ' — ' + esc(preview.area) : ''))}
      <table class="sh-list"><thead><tr><th>#</th><th>العميل</th><th>المنطقة</th><th>المقاطعة</th><th>النوع</th><th>المساحة</th><th>الواجهة</th><th>السنة</th><th>الجوال</th><th>السعر</th><th>الحالة</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="sh-foot">${date}</div>`;
  }
  const r = db.records.find((x) => x.id === preview.id);
  if (!r) return '';
  const row = (k, v) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
  return `${sheetHead('بطاقة عقار')}
    ${photosOf(r)[0] ? `<img class="sh-photo" src="${photosOf(r)[0]}">` : ''}
    ${photosOf(r).length > 1 ? `<div class="sh-gallery">${photosOf(r).slice(1).map((p) => `<img src="${p}">`).join('')}</div>` : ''}
    <table><tbody>
      ${row('العميل', r.clientName)}
      ${row('الجوال', r.phone)}
      ${row('نوع العقار', r.type)}
      ${row('نوع القطعة', r.landType)}
      ${row('المنطقة', r.area)}
      ${row('رقم المقاطعة', r.district)}
      ${row('المساحة', r.size ? r.size + ' م²' : '')}
      ${row('النزال (العمق)', r.depth ? r.depth + ' م' : '')}
      ${row('الواجهة', r.facade)}
      ${row('سنة البناء', r.year)}
      ${row('عدد الغرف', r.rooms)}
      ${row('عدد الحمامات', r.baths)}
      ${row('عدد الطوابق', r.floors)}
      ${row('السعر', fmtPrice(r))}
      ${row('الحالة', r.status)}
      ${r.location ? `<tr><th>الموقع</th><td class="sh-url">${esc(mapUrl(r.location))}</td></tr>` : ''}
      ${row('ملاحظات', r.notes)}
    </tbody></table>
    <div class="sh-foot">${date}</div>`;
}

function renderSheet() {
  const size = $('#paperSize').value;
  const sheet = $('#sheet');
  sheet.className = 'sheet ' + (size === 'a4' ? 'a4' : 'w' + size);
  sheet.innerHTML = sheetHTML();
}

function openPreview(type, id, area, ids) {
  preview = { type, id, area: area || '', ids: ids || null };
  renderSheet();
  $('#previewModal').hidden = false;
}
$('#paperSize').addEventListener('change', renderSheet);
$('#btnClosePreview').addEventListener('click', () => ($('#previewModal').hidden = true));

$('#btnDoPrint').addEventListener('click', async () => {
  const size = $('#paperSize').value;
  const pageSize = size === 'a4' ? 'A4' : { width: Number(size) * 1000, height: 297000 };
  $('#pageStyle').textContent = size === 'a4' ? '@page{size:A4;margin:0}' : `@page{size:${size}mm auto;margin:0}`;
  document.body.classList.add('printing');
  const res = await window.api.print(pageSize);
  document.body.classList.remove('printing');
  if (res && !res.success && res.reason && res.reason !== 'cancelled') toast('تعذّرت الطباعة: ' + res.reason);
});

// ---------- الإحصائيات والتصدير ----------
const byName = (a, b) => (a.area === NO_AREA ? 1 : b.area === NO_AREA ? -1 : a.area.localeCompare(b.area, 'ar'));
const STATS_SORTS = {
  name: byName,
  total: (a, b) => b.total - a.total || byName(a, b),
  sold: (a, b) => b.sold - a.sold || byName(a, b),
  ratio: (a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.total - a.total || byName(a, b)
};
let statsSort = 'name'; // الترتيب المعروض هو نفسه ترتيب ملفَي Excel وPDF

const ratioOf = (sold, total) => (total ? sold / total : null);
const pctOf = (ratio) => (ratio === null ? null : Math.round(ratio * 100));

function computeStats() {
  const map = new Map();
  const get = (k) => {
    if (!map.has(k)) map.set(k, { area: k, total: 0, sold: 0, by: {} });
    return map.get(k);
  };
  (db.areas || []).forEach((a) => get(a)); // المنطقة المحفوظة تظهر حتى لو كانت فارغة
  db.records.forEach((r) => {
    const o = get(r.area || NO_AREA);
    o.total++;
    if (r.status === SOLD) o.sold++;
    const sk = SEGMENT_KEYS.has(r.status) ? r.status : ''; // حالة فارغة أو غير معروفة → «غير محدد»
    o.by[sk] = (o.by[sk] || 0) + 1;
  });
  const rows = [...map.values()];
  rows.forEach((r) => { r.ratio = ratioOf(r.sold, r.total); r.pct = pctOf(r.ratio); });
  rows.sort(STATS_SORTS[statsSort] || byName);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const sold = rows.reduce((n, r) => n + r.sold, 0);
  const ratio = ratioOf(sold, total);
  const by = {};
  rows.forEach((r) => Object.entries(r.by).forEach(([k, n]) => { by[k] = (by[k] || 0) + n; }));
  return { rows, total, sold, ratio, pct: pctOf(ratio), by };
}

// أعمدة الجدول: المفتاح يُستخدم في الترتيب (عمود dist للعرض فقط)
const STATS_COLS = [
  { key: 'name', label: 'المنطقة' },
  { key: 'total', label: 'عدد العقارات' },
  { key: 'sold', label: 'المباع' },
  { key: 'ratio', label: 'نسبة المباع' },
  { key: 'dist', label: 'توزيع الحالات' }
];

// أجزاء الشريط بالترتيب: المنتهي أولاً (مباع/مؤجر) ثم المحجوز ثم المتاح، فتبدأ حصة المباع من اليمين دائماً
const SEGMENTS = [
  { key: SOLD, cls: 'seg-sold' },
  { key: 'مؤجر', cls: 'seg-rented' },
  { key: 'محجوز', cls: 'seg-reserved' },
  { key: 'للبيع', cls: 'seg-sale' },
  { key: 'للإيجار', cls: 'seg-rent' },
  { key: '', label: 'غير محدد', cls: 'seg-none' }
];
const SEGMENT_KEYS = new Set(SEGMENTS.map((g) => g.key));
const segLabel = (g) => g.label || g.key;

// الشريط المجزّأ لصف أو للإجمالي (o.by = عدد كل حالة)
function segBar(o, lg) {
  if (!o.total) return '<span class="none">—</span>';
  const used = SEGMENTS.filter((g) => o.by[g.key]);
  const desc = used.map((g) => `${segLabel(g)}: ${o.by[g.key]}`);
  const parts = used.map((g, i) => `<i class="${g.cls}" style="flex:${o.by[g.key]}" title="${desc[i]}"></i>`).join('');
  return `<span class="meter${lg ? ' lg' : ''}" role="img" aria-label="${desc.join('، ')}">${parts}</span>`;
}
const legendHTML = (st) =>
  `<ul class="legend">${SEGMENTS.filter((g) => st.by[g.key]).map((g) => `<li><i class="dot ${g.cls}"></i>${segLabel(g)} <b>${st.by[g.key]}</b></li>`).join('')}</ul>`;

const pctCell = (o) => `<td class="pct">${o.pct === null ? '<span class="none">—</span>' : o.pct + '%'}</td>`;
const distCell = (o) => `<td class="dist">${segBar(o)}</td>`;

function renderStats() {
  const st = computeStats();
  const cell = (n) => `<td${n ? '' : ' class="zero"'}>${n}</td>`;
  const th = (c) => {
    const on = c.key === statsSort;
    const sort = on ? (c.key === 'name' ? 'ascending' : 'descending') : 'none';
    if (c.key === 'dist') return `<th class="dist">${c.label}</th>`;
    return `<th aria-sort="${sort}"><button type="button" class="th-sort${on ? ' on' : ''}" data-sort="${c.key}" title="ترتيب حسب ${c.label}">${c.label}</button></th>`;
  };
  const summary = st.total
    ? `<div class="stats-summary">
        <div class="ss-line"><span><b>${st.sold}</b> مباع من <b>${st.total}</b> عقار</span><b class="ss-pct">${st.pct}%</b></div>
        ${segBar(st, true)}
        ${legendHTML(st)}
      </div>`
    : '';
  $('#statsBox').innerHTML = st.rows.length
    ? `${summary}<table class="stats">
        <thead><tr>${STATS_COLS.map(th).join('')}</tr></thead>
        <tbody>${st.rows.map((r) => `<tr><td>${esc(r.area)}</td>${cell(r.total)}${cell(r.sold)}${pctCell(r)}${distCell(r)}</tr>`).join('')}</tbody>
        <tfoot><tr><td>الإجمالي</td><td>${st.total}</td><td>${st.sold}</td>${pctCell(st)}${distCell(st)}</tr></tfoot>
      </table>`
    : '<div class="empty">لا توجد عقارات بعد.</div>';
}
$('#statsBox').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sort]');
  if (!b) return;
  statsSort = b.dataset.sort;
  renderStats();
});

function statsSheetHTML(st) {
  const date = new Date().toLocaleDateString('ar-u-ca-gregory-nu-latn');
  const th = (c) => `<th${c.key === 'dist' ? ' class="dist"' : ''}>${c.label}</th>`;
  const line = st.total ? `<div class="sh-sum">مباع <b>${st.sold}</b> من <b>${st.total}</b> عقار (${st.pct}%)</div>${legendHTML(st)}` : '';
  return `${sheetHead('إحصائيات المناطق')}${line}
    <table class="sh-stats">
      <thead><tr>${STATS_COLS.map(th).join('')}</tr></thead>
      <tbody>${st.rows.map((r) => `<tr><td>${esc(r.area)}</td><td>${r.total}</td><td>${r.sold}</td>${pctCell(r)}${distCell(r)}</tr>`).join('')}
        <tr class="total"><td>الإجمالي</td><td>${st.total}</td><td>${st.sold}</td>${pctCell(st)}${distCell(st)}</tr></tbody>
    </table>
    <div class="sh-foot">${date}</div>`;
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function exportResult(res) {
  if (!res || res.canceled) return; // أغلق المستخدم نافذة الحفظ
  toast(res.ok ? 'تم حفظ الملف' : 'تعذّر الحفظ' + (res.error ? ': ' + res.error : ''));
}

$('#btnStatsXlsx').addEventListener('click', async () => {
  const st = computeStats();
  if (!st.rows.length) return toast('لا توجد بيانات للتصدير');
  const bytes = window.REExport.xlsxFromTable({
    sheetName: 'إحصائيات المناطق',
    headers: STATS_COLS.slice(0, 3).map((c) => c.label),
    rows: st.rows.map((r) => [r.area, r.total, r.sold]),
    totalLabel: 'الإجمالي',
    ratio: { header: STATS_COLS[3].label, num: 2, den: 1 }
  });
  exportResult(await window.api.saveXlsx(bytes, `إحصائيات-العقارات-${todayStr()}.xlsx`));
});

$('#btnStatsPdf').addEventListener('click', async () => {
  const st = computeStats();
  if (!st.rows.length) return toast('لا توجد بيانات للتصدير');
  exportResult(await window.api.exportPdf(statsSheetHTML(st), `إحصائيات-العقارات-${todayStr()}.pdf`));
});

// ---------- الإعدادات ----------
function fillSettings() {
  const s = db.settings;
  $('#s-office').value = s.office || '';
  $('#s-officePhone').value = s.officePhone || '';
  $('#s-tpl').value = s.tpl || DEFAULT_TPL;
  $('#brandName').textContent = s.office || 'إدارة العقارات';
}
$('#btnSaveSettings').addEventListener('click', async () => {
  db.settings = {
    office: $('#s-office').value.trim(),
    officePhone: $('#s-officePhone').value.trim(),
    tpl: $('#s-tpl').value.trim() || DEFAULT_TPL
  };
  await persist();
  fillSettings();
  toast('تم حفظ الإعدادات');
});

$('#btnExport').addEventListener('click', async () => {
  const ok = await window.api.exportBackup(JSON.stringify(db, null, 2));
  if (ok) toast('تم حفظ النسخة الاحتياطية');
});
async function restoreFromText(text) {
  if (!text) return toast('تعذّر قراءة النسخة');
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data.records)) throw new Error('bad');
    if (!confirm('سيتم استبدال البيانات الحالية بهذه النسخة. متابعة؟')) return;
    db = { records: data.records, areas: data.areas || [], settings: Object.assign({}, db.settings, upgradeSettings(data.settings) || {}) };
    db.records.forEach((r) => dirtyPhotos.add(r.id));
    refreshAreas();
    await persist();
    fillSettings();
    renderList();
    toast('تمت استعادة النسخة');
    backfillThumbs();
  } catch (err) {
    toast('الملف غير صالح');
  }
}
$('#btnImport').addEventListener('click', async () => restoreFromText(await window.api.importBackup()));

// ---------- النسخ الاحتياطي التلقائي ----------
const fmtDate = (ms) => new Date(ms).toLocaleString('ar-u-ca-gregory-nu-latn');
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

async function refreshBackups() {
  const card = $('#autoBackupCard');
  const ok = typeof window.api.backupGetConfig === 'function';
  card.hidden = !ok; // غير متاح في صفحة الفحص
  if (!ok) return;
  const cfg = await window.api.backupGetConfig();
  $('#b-enabled').checked = cfg.enabled;
  $('#b-dir').value = cfg.dir;
  $('#b-keep').value = cfg.keep;
  const list = await window.api.backupList();
  $('#b-list').innerHTML = list.length
    ? list
        .slice(0, 10)
        .map((b) => `<tr><td>${esc(fmtDate(b.mtime))}</td><td>${fmtSize(b.size)}</td><td><button class="btn ghost small" data-restore="${esc(b.name)}">استعادة</button></td></tr>`)
        .join('')
    : '<tr><td colspan="3" class="hint">لا توجد نسخ بعد — تُنشأ أول نسخة عند أول حفظ.</td></tr>';
}
$('#b-enabled').addEventListener('change', async (e) => {
  await window.api.backupSetConfig({ enabled: e.target.checked });
  toast(e.target.checked ? 'تم تفعيل النسخ التلقائي' : 'تم إيقاف النسخ التلقائي');
});
$('#b-keep').addEventListener('change', async (e) => {
  const v = Math.min(200, Math.max(5, parseInt(toLatin(e.target.value), 10) || 20));
  e.target.value = v;
  await window.api.backupSetConfig({ keep: v });
});
$('#b-choose').addEventListener('click', async () => {
  const dir = await window.api.backupChooseDir();
  if (!dir) return;
  await window.api.backupSetConfig({ dir });
  await persist({ forceBackup: true }); // إنشاء نسخة فورية في المجلد الجديد
  refreshBackups();
});
$('#b-open').addEventListener('click', () => window.api.backupOpenDir());
$('#b-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-restore]');
  if (b) restoreFromText(await window.api.backupRestore(b.dataset.restore));
});

// ---------- التشغيل ----------
(async function init() {
  initFacades();
  renderGallery();
  const saved = await window.api.load();
  if (saved && Array.isArray(saved.records)) {
    db = { records: saved.records, areas: saved.areas || [], settings: Object.assign({}, db.settings, upgradeSettings(saved.settings) || {}) };
  }
  refreshAreas();
  fillSettings();
  renderList();
  setTimeout(backfillThumbs, 500);
})();
