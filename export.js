'use strict';

// إنشاء ملف Excel (.xlsx) بدون أي مكتبات خارجية.
// ملف xlsx هو أرشيف zip يحتوي ملفات XML، والملفات هنا صغيرة فيكفي zip بدون ضغط.
// يعمل داخل صفحة البرنامج مباشرة، ويُرسَل الناتج إلى العملية الرئيسية لحفظه.
(function () {
  const enc = new TextEncoder();

  const xmlEsc = (s) =>
    String(s ?? '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // ---------- zip (بدون ضغط) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const body = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = enc.encode(f.text);
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true); // النسخة المطلوبة
      lh.setUint16(6, 0x0800, true); // أسماء الملفات UTF-8
      lh.setUint16(8, 0, true); // بدون ضغط
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      body.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    const parts = [...body, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // ---------- ملفات xlsx ----------
  const colName = (i) => {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  };

  // الألوان من هوية البرنامج: petrol / brass / line
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Arial"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><b/><sz val="11"/><name val="Arial"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0F5C63"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF0F4F5"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9E0E4"/></left><right style="thin"><color rgb="FFD9E0E4"/></right><top style="thin"><color rgb="FFD9E0E4"/></top><bottom style="thin"><color rgb="FFD9E0E4"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFD9E0E4"/></left><right style="thin"><color rgb="FFD9E0E4"/></right><top style="medium"><color rgb="FFB8893B"/></top><bottom style="thin"><color rgb="FFD9E0E4"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="9" fontId="2" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const S_HEAD = 1, S_TEXT = 2, S_NUM = 3, S_TOTAL_TEXT = 4, S_TOTAL_NUM = 5, S_PCT = 6, S_TOTAL_PCT = 7;

  const strCell = (ref, text, s) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
  const numCell = (ref, n, s) => `<c r="${ref}" s="${s}"><v>${Number(n) || 0}</v></c>`;

  /**
   * جدول بسيط في ورقة واحدة من اليمين إلى اليسار.
   * العمود الأول نصي، وبقية الأعمدة أرقام. صف الإجمالي (إن وُجد) بمعادلات SUM.
   * ratio (اختياري) يضيف عموداً أخيراً = العمود num ÷ العمود den بمعادلة، بصيغة نسبة مئوية
   * مع شريط بيانات:  { header, num: رقم العمود (من 0), den: رقم العمود }
   *   { sheetName, headers: [..], rows: [[نص, رقم, رقم], ..], totalLabel, widths: [..], ratio }
   */
  function xlsxFromTable({ sheetName, headers, rows, totalLabel, widths, ratio, extra }) {
    const nCols = headers.length;
    const nExtra = extra && extra.headers.length ? extra.headers.length : 0;
    const ratioCol = nCols + (ratio ? 1 : 0); // أول عمود إضافي بعد عمود النسبة
    const outCols = ratioCol + nExtra;
    const last = rows.length + 1; // آخر صف بيانات (الصف 1 هو العناوين)
    const lastCol = colName(outCols - 1);
    const allHeaders = [...headers, ...(ratio ? [ratio.header] : []), ...(nExtra ? extra.headers : [])];
    const N = ratio ? colName(ratio.num) : '';
    const D = ratio ? colName(ratio.den) : '';
    // بدون عقارات لا توجد نسبة: تبقى الخلية فارغة (نص فارغ) بدل 0%
    const ratioCell = (r, numV, denV, style) =>
      `<c r="${colName(nCols)}${r}" s="${style}"${denV ? '' : ' t="str"'}><f>IF(${D}${r}=0,"",${N}${r}/${D}${r})</f><v>${denV ? numV / denV : ''}</v></c>`;

    const extraCells = (vals, r, style) =>
      nExtra ? vals.map((v, j) => (v === '' ? `<c r="${colName(ratioCol + j)}${r}" s="${style}" t="str"><v></v></c>` : numCell(colName(ratioCol + j) + r, v, style))).join('') : '';

    const sheetRows = [];
    sheetRows.push(`<row r="1" ht="24" customHeight="1">${allHeaders.map((h, c) => strCell(colName(c) + 1, h, S_HEAD)).join('')}</row>`);
    rows.forEach((row, i) => {
      const r = i + 2;
      const cells = row.map((v, c) => (c === 0 ? strCell(colName(c) + r, v, S_TEXT) : numCell(colName(c) + r, v, S_NUM))).join('');
      sheetRows.push(`<row r="${r}">${cells}${ratio ? ratioCell(r, Number(row[ratio.num]) || 0, Number(row[ratio.den]) || 0, S_PCT) : ''}${extraCells(extra && extra.rows[i], r, S_NUM)}</row>`);
    });
    if (totalLabel && rows.length) {
      const r = last + 1;
      const sums = [];
      let cells = strCell('A' + r, totalLabel, S_TOTAL_TEXT);
      for (let c = 1; c < nCols; c++) {
        const L = colName(c);
        sums[c] = rows.reduce((n, row) => n + (Number(row[c]) || 0), 0); // قيمة مخزّنة تظهر قبل إعادة الحساب
        cells += `<c r="${L}${r}" s="${S_TOTAL_NUM}"><f>SUM(${L}2:${L}${last})</f><v>${sums[c]}</v></c>`;
      }
      if (ratio) cells += ratioCell(r, sums[ratio.num], sums[ratio.den], S_TOTAL_PCT);
      if (nExtra) cells += extra.totals.map((v, j) => (v === '' ? '' : `<c r="${colName(ratioCol + j)}${r}" s="${S_TOTAL_NUM}"><v>${v}</v></c>`)).join('');
      sheetRows.push(`<row r="${r}">${cells}</row>`);
    }

    const cols = (widths || allHeaders.map((_, c) => (c === 0 ? 30 : 16)))
      .map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
      .join('');

    // شريط بيانات أصلي في Excel على عمود النسبة (من 0% إلى 100%)
    const ratioL = colName(nCols);
    const bar = ratio && rows.length
      ? `<conditionalFormatting sqref="${ratioL}2:${ratioL}${last}"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="num" val="0"/><cfvo type="num" val="1"/><color rgb="FF0F5C63"/></dataBar></cfRule></conditionalFormatting>`
      : '';

    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><tabColor rgb="FF0F5C63"/><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${cols}</cols>
<sheetData>${sheetRows.join('')}</sheetData>
<autoFilter ref="A1:${lastCol}${last}"/>
${bar}<printOptions horizontalCentered="1"/>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

    const name = xmlEsc(String(sheetName || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31));
    const NS = 'http://schemas.openxmlformats.org/officeDocument/2006';
    return zip([
      {
        name: '[Content_Types].xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
      },
      {
        name: '_rels/.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      },
      {
        name: 'xl/workbook.xml',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS}/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS}/relationships/styles" Target="styles.xml"/></Relationships>`
      },
      { name: 'xl/styles.xml', text: STYLES },
      { name: 'xl/worksheets/sheet1.xml', text: sheet }
    ]);
  }

  window.REExport = { xlsxFromTable };
})();
