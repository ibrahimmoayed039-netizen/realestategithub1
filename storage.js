'use strict';
// طبقة التخزين: بيانات العقارات الخفيفة في data.json، وصور كل عقار في ملف مستقل داخل مجلد photos.
// بهذا لا يُعاد كتابة (ولا نسخ) مئات الميغابايتات من الصور عند كل حفظ.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const photoName = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 24) + '.json';
const embeddedPhotos = (r) => (Array.isArray(r.photos) && r.photos.length ? r.photos : r.photo ? [r.photo] : []);
const strip = (r) => {
  const { photos, photo, ...rest } = r;
  return rest;
};

async function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, text, 'utf8');
  await fs.promises.rename(tmp, file);
}

// تنفيذ دوال غير متزامنة بعدد محدود من العمليات المتوازية (لتفادي فتح آلاف الملفات دفعة واحدة)
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function createStore(dir) {
  const dataFile = path.join(dir, 'data.json');
  const photosDir = path.join(dir, 'photos');
  const photoFile = (id) => path.join(photosDir, photoName(id));
  let queue = Promise.resolve();
  // كل العمليات تمرّ في طابور واحد كي لا تتداخل عمليتا كتابة أو قراءة أثناء الكتابة
  const enqueue = (fn) => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };

  async function writePhotos(map) {
    await fs.promises.mkdir(photosDir, { recursive: true });
    await mapLimit(Object.keys(map), 8, async (id) => {
      const arr = map[id];
      if (Array.isArray(arr) && arr.length) await writeAtomic(photoFile(id), JSON.stringify(arr));
      else await fs.promises.unlink(photoFile(id)).catch(() => {});
    });
  }

  async function _save({ records, areas, settings, photos }) {
    await writePhotos(photos || {}); // الصور أولاً ثم ملف البيانات — فلا يشير الملف الرئيسي إلى صور غير موجودة
    await writeAtomic(dataFile, JSON.stringify({ records: records.map(strip), areas: areas || [], settings: settings || {} }));
    if (records.length) {
      // حذف ملفات صور العقارات المحذوفة
      const keep = new Set(records.map((r) => photoName(r.id)));
      let files = [];
      try { files = await fs.promises.readdir(photosDir); } catch (e) {}
      for (const f of files) {
        if (f.endsWith('.tmp') || (f.endsWith('.json') && !keep.has(f))) await fs.promises.unlink(path.join(photosDir, f)).catch(() => {});
      }
    }
  }

  async function _load() {
    let raw;
    try { raw = await fs.promises.readFile(dataFile, 'utf8'); } catch (e) { return null; }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // ملف تالف: نحتفظ بنسخة منه بدل أن يُكتب فوقه
      await fs.promises.copyFile(dataFile, path.join(dir, `data.corrupt-${Date.now()}.json`)).catch(() => {});
      return null;
    }
    if (!data || !Array.isArray(data.records)) return data;

    const legacy = {};
    await mapLimit(data.records, 16, async (r) => {
      const emb = embeddedPhotos(r);
      if (emb.length) { // صيغة قديمة: الصور داخل data.json
        legacy[r.id] = emb;
        r.photos = emb;
        delete r.photo;
        return;
      }
      try { r.photos = JSON.parse(await fs.promises.readFile(photoFile(r.id), 'utf8')); } catch (e) { r.photos = []; }
    });

    if (Object.keys(legacy).length) {
      // ترحيل تلقائي مرة واحدة إلى الصيغة الجديدة، مع الاحتفاظ بنسخة من الملف القديم
      const bak = path.join(dir, 'data.pre-split.json');
      try { await fs.promises.access(bak); } catch (e) { await fs.promises.copyFile(dataFile, bak); }
      await _save({ records: data.records, areas: data.areas, settings: data.settings, photos: legacy });
    }
    return data;
  }

  // نسخة كاملة (مع الصور) بنفس الصيغة القديمة، لتعمل الاستعادة والتصدير كما كانت
  async function _exportFull() {
    let data;
    try { data = JSON.parse(await fs.promises.readFile(dataFile, 'utf8')); } catch (e) { return null; }
    if (!data || !Array.isArray(data.records)) return JSON.stringify(data);
    const parts = new Array(data.records.length);
    await mapLimit(data.records, 16, async (r, i) => {
      let photosText = '[]';
      try { photosText = await fs.promises.readFile(photoFile(r.id), 'utf8'); } catch (e) {}
      const head = JSON.stringify(strip(r));
      parts[i] = head.slice(0, -1) + (head.length > 2 ? ',' : '') + '"photos":' + photosText + '}';
    });
    const rest = JSON.stringify({ areas: data.areas || [], settings: data.settings || {} });
    return '{"records":[' + parts.join(',') + '],' + rest.slice(1);
  }

  return {
    load: () => enqueue(_load),
    save: (payload) => enqueue(() => _save(payload)),
    exportFull: () => enqueue(_exportFull),
    dataFile
  };
}

module.exports = { createStore, photoName };
