/* ============================================================
 * Excel 解析与聚合（浏览器端，纯静态，等价于 Flask 版 server.py）
 * 分类：系列含"剪叉"=剪刀车，其余=臂车
 * 在租：租赁状态含"在租"（排除非/未在租）或占用单据非空
 * ============================================================ */

window.UNKNOWN_REGION = window.UNKNOWN_REGION || '未识别区域';
const UNKNOWN_SALES = '未填写业务员';

// 武汉功能区（非行政区划）→ 实际所属区
const WUHAN_ZONE_MAP = [
  ['东湖新技术开发区', '洪山区'], ['东湖高新区', '洪山区'], ['光谷', '洪山区'],
  ['武汉经济技术开发区', '蔡甸区'], ['武汉经开区', '蔡甸区'], ['经开区', '蔡甸区'],
  ['沌阳', '蔡甸区'], ['沌口', '蔡甸区'], ['军山', '蔡甸区'],
  ['临空港', '东西湖区'], ['化工新城', '青山区'], ['化学工业区', '青山区'],
  ['东湖生态旅游', '武昌区'], ['东湖风景区', '武昌区'],
  ['汉口北', '黄陂区'], ['阳逻', '新洲区'],
];

let REGION_NAMES = [];
let WUHAN_DISTRICTS = [];
let OTHER_CITIES = [];
let GEO = null;

async function loadRegions() {
  if (GEO) return GEO;
  const resp = await fetch('./hubei.json');
  GEO = await resp.json();
  // 神农架林区名称以"区"结尾但不属于武汉，按 adcode(4201xx) 判定
  GEO.features.forEach((ft) => {
    const name = ft.properties.name;
    const adcode = String(ft.properties.adcode || '');
    REGION_NAMES.push(name);
    if (adcode.startsWith('4201')) WUHAN_DISTRICTS.push(name);
    else OTHER_CITIES.push(name);
  });
  return GEO;
}

function norm(text) {
  return text == null ? '' : String(text).replace(/\s+/g, '');
}

function cityKeyword(city) {
  if (city === '恩施土家族苗族自治州') return '恩施';
  if (city === '神农架林区') return '神农架';
  return city.endsWith('市') ? city.slice(0, -1) : city;
}

/* 地址 -> GeoJSON 区域名（武汉精确到区，外地以市州为单位），无法识别返回 null */
function parseRegion(addr) {
  if (!addr) return null;
  const s = String(addr).replace(/\s+/g, '');

  const candidates = [];
  const pW = s.indexOf('武汉');
  if (pW >= 0) candidates.push([pW, '__WUHAN__']);
  OTHER_CITIES.forEach((city) => {
    const kw = cityKeyword(city);
    const p = s.indexOf(kw);
    if (p >= 0) candidates.push([p, city]);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a[0] - b[0]);
  const hit = candidates[0][1];
  if (hit !== '__WUHAN__') return hit;

  // 武汉：在"武汉"之后找最先出现的行政区/功能区
  const tail = s.slice(pW);
  const districtHits = [];
  WUHAN_DISTRICTS.forEach((d) => {
    const p = tail.indexOf(d);
    if (p >= 0) districtHits.push([p, d]);
  });
  WUHAN_ZONE_MAP.forEach(([zone, d]) => {
    const p = tail.indexOf(zone);
    if (p >= 0) districtHits.push([p, d]);
  });
  if (!districtHits.length) return null;
  districtHits.sort((a, b) => a[0] - b[0]);
  return districtHits[0][1];
}

/* 表头定位关键列 */
function findColumns(headers) {
  const hn = headers.map(norm);
  const cols = {};
  // 优先精确"业务员"，其次"业务经理"
  const iSalesman = hn.findIndex((h) => h === '业务员' || h === '业务员名称');
  if (iSalesman >= 0) cols.sales = iSalesman;
  else {
    const iMgr = hn.findIndex((h) => h === '业务经理');
    if (iMgr >= 0) cols.sales = iMgr;
  }
  hn.forEach((h, i) => {
    if (h === '系列') cols.series = i;
    else if (h === '设备最新定位地址') cols.addr = i;
    else if ((h.includes('最新定位') || h.includes('定位地址')) && cols.addr === undefined) cols.addr = i;
    else if (h === '租赁状态') cols.rent = i;
    else if (h === '占用单据') cols.doc = i;
  });
  return cols;
}

function locateHeader(rows) {
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const headers = rows[i] || [];
    const cols = findColumns(headers);
    if (cols.series !== undefined && (cols.addr !== undefined || cols.sales !== undefined)) {
      return { headerRow: i, headers, cols };
    }
  }
  return null;
}

function isRented(status, doc) {
  const s = status == null ? '' : String(status).trim();
  let rented = s.includes('在租') && !s.includes('非在租') && !s.includes('未在租');
  if (!rented && doc != null) {
    const d = String(doc).trim();
    if (d && d.toLowerCase() !== 'none' && d.toLowerCase() !== 'nan' && d !== '-') rented = true;
  }
  return rented;
}

function emptyCount() {
  return { scissor: 0, boom: 0 };
}

/* 解析 ArrayBuffer，返回与旧版后端一致的聚合结果 */
function analyzeWorkbook(buffer, fileName, rentedOnlyOpt) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

  const located = locateHeader(rows);
  if (!located) {
    throw new Error('未找到必需列，请确认表格包含「系列」和「设备最新定位地址」列');
  }
  const { headerRow, headers, cols } = located;
  const ci = {
    series: cols.series,
    addr: cols.addr,
    sales: cols.sales,
    rent: cols.rent,
    doc: cols.doc,
  };
  const hasRentInfo = ci.rent !== undefined || ci.doc !== undefined;
  const rentedOnly = rentedOnlyOpt && hasRentInfo;

  const salespeople = new Map();
  const regionSales = new Map();
  const regionOrder = REGION_NAMES.concat([UNKNOWN_REGION]);
  const regionTotals = {};
  regionOrder.forEach((n) => { regionTotals[n] = emptyCount(); });
  const unknownSamples = [];
  let totalRows = 0;
  let countedRows = 0;

  const cell = (row, idx) => (idx !== undefined && idx < row.length ? row[idx] : null);

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const isEmpty = row.every((v) => v == null || String(v).trim() === '');
    if (isEmpty) continue;
    totalRows++;

    if (rentedOnly && !isRented(cell(row, ci.rent), cell(row, ci.doc))) continue;
    countedRows++;

    const seriesRaw = cell(row, ci.series);
    const series = seriesRaw == null ? '' : String(seriesRaw).trim();
    const isScissor = series.includes('剪叉');

    let name = UNKNOWN_SALES;
    const salesRaw = cell(row, ci.sales);
    if (salesRaw != null) {
      const v = String(salesRaw).trim();
      if (v && v.toLowerCase() !== 'none' && v.toLowerCase() !== 'nan') name = v;
    }

    const addrRaw = cell(row, ci.addr);
    const addr = addrRaw == null ? '' : String(addrRaw).trim();
    const region = parseRegion(addr) || UNKNOWN_REGION;
    const kind = isScissor ? 'scissor' : 'boom';

    if (!salespeople.has(name)) salespeople.set(name, emptyCount());
    salespeople.get(name)[kind]++;
    regionTotals[region][kind]++;
    if (!regionSales.has(region)) regionSales.set(region, new Map());
    const rm = regionSales.get(region);
    if (!rm.has(name)) rm.set(name, emptyCount());
    rm.get(name)[kind]++;

    if (region === UNKNOWN_REGION && addr && unknownSamples.length < 10) {
      unknownSamples.push(addr);
    }
  }

  const salesList = [...salespeople.entries()].map(([name, v]) => ({
    name, scissor: v.scissor, boom: v.boom, total: v.scissor + v.boom,
  }));
  salesList.sort((a, b) => {
    if ((a.name === UNKNOWN_SALES) !== (b.name === UNKNOWN_SALES)) {
      return a.name === UNKNOWN_SALES ? 1 : -1;
    }
    if (b.total !== a.total) return b.total - a.total;
    return a.name.localeCompare(b.name, 'zh');
  });

  const regionsOut = regionOrder.map((region) => {
    const t = regionTotals[region];
    const sales = regionSales.get(region);
    const salesOut = sales ? [...sales.entries()].map(([name, v]) => ({
      name, scissor: v.scissor, boom: v.boom,
    })) : [];
    salesOut.sort((a, b) => (b.scissor + b.boom) - (a.scissor + a.boom));
    return {
      name: region,
      scissor: t.scissor,
      boom: t.boom,
      total: t.scissor + t.boom,
      sales: salesOut,
    };
  });

  const totals = emptyCount();
  salespeople.forEach((v) => {
    totals.scissor += v.scissor;
    totals.boom += v.boom;
  });

  const unk = regionTotals[UNKNOWN_REGION];
  return {
    fileName,
    totalRows,
    countedRows,
    filteredOut: totalRows - countedRows,
    rentedOnly,
    hasRentInfo,
    columns: {
      series: headers[ci.series] ?? '系列',
      addr: ci.addr !== undefined ? headers[ci.addr] : null,
      sales: ci.sales !== undefined ? headers[ci.sales] : null,
    },
    salespeople: salesList,
    regions: regionsOut,
    totals,
    unknownSamples,
    unknownCount: unk.scissor + unk.boom,
  };
}
