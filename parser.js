/* ============================================================
 * Excel 解析与聚合（浏览器端，纯静态，等价于 Flask 版 server.py）
 * 分类：系列含"剪叉"=剪刀车，其余=臂车
 * 在租：租赁状态含"在租"（排除非/未在租）或占用单据非空
 * ============================================================ */

window.UNKNOWN_REGION = window.UNKNOWN_REGION || '未识别区域';
const UNKNOWN_SALES = '未填写业务员';

/* ---------- v1.5.0 区域体系：武汉13区+鄂州合并为4大板块（共19区域） ----------
 * 东西湖区域 = 东西湖/江岸/江汉(用户所说"汉口区")/硚口/黄陂
 * 汉阳区域   = 汉阳/汉南/蔡甸
 * 武汉区域   = 武昌/江夏 + 洪山西半（连通武昌-江夏的走廊）
 * 新城区域   = 青山/新洲/鄂州 + 洪山东半（光谷，连通青山-鄂州） */
const ZONE_DXH = '东西湖区域';
const ZONE_HY = '汉阳区域';
const ZONE_WH = '武汉区域';
const ZONE_XC = '新城区域';

// 行政区 -> 板块（洪山区单列，按地址关键词切东西）
const DIST_ZONE = {
  东西湖区: ZONE_DXH, 江岸区: ZONE_DXH, 江汉区: ZONE_DXH, 硚口区: ZONE_DXH, 黄陂区: ZONE_DXH,
  汉阳区: ZONE_HY, 汉南区: ZONE_HY, 蔡甸区: ZONE_HY,
  武昌区: ZONE_WH, 江夏区: ZONE_WH,
  青山区: ZONE_XC, 新洲区: ZONE_XC,
};
const HONGSHAN_DISTRICT = '洪山区';
// 洪山西侧地名（->武汉区域）；光谷/东湖高新等东侧及无细节的洪山地址默认 ->新城区域
const HONGSHAN_WEST_KW = ['白沙洲', '张家湾', '青菱', '南湖', '珞狮', '李桥', '建安街', '烽胜', '狮子山'];
// 功能区（非行政区划）关键词 -> 板块
const WUHAN_ZONE_DIRECT = [
  ['东湖新技术开发区', ZONE_XC], ['东湖高新区', ZONE_XC], ['光谷', ZONE_XC],
  ['武汉经济技术开发区', ZONE_HY], ['武汉经开区', ZONE_HY], ['经开区', ZONE_HY],
  ['沌阳', ZONE_HY], ['沌口', ZONE_HY], ['军山', ZONE_HY],
  ['临空港', ZONE_DXH], ['化工新城', ZONE_XC], ['化学工业区', ZONE_XC],
  ['东湖生态旅游', ZONE_WH], ['东湖风景区', ZONE_WH],
  ['汉口北', ZONE_DXH], ['阳逻', ZONE_XC],
];

const WUHAN_DISTRICTS = Object.keys(DIST_ZONE).concat([HONGSHAN_DISTRICT]);
const ZONE_NAMES = [ZONE_DXH, ZONE_HY, ZONE_WH, ZONE_XC];
// 其余市州（鄂州市整体并入新城区域）
const OTHER_CITIES = [
  '黄石市', '十堰市', '宜昌市', '襄阳市', '荆门市', '孝感市', '荆州市',
  '黄冈市', '咸宁市', '随州市', '恩施土家族苗族自治州',
  '仙桃市', '潜江市', '天门市', '神农架林区',
];
// 聚合输出顺序（地图按名称匹配，顺序仅影响 regions 数组）
const REGION_ORDER = OTHER_CITIES.concat(ZONE_NAMES);

let GEO = null;

async function loadRegions() {
  if (GEO) return GEO;
  const resp = await fetch('./hubei.json');
  GEO = await resp.json();
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

/* 地址 -> 板块/市州名（武汉+鄂州归并到4大板块，外地以市州为单位），无法识别返回 null */
function parseRegion(addr) {
  if (!addr) return null;
  const s = String(addr).replace(/\s+/g, '');

  const candidates = [];
  const pW = s.indexOf('武汉');
  if (pW >= 0) candidates.push([pW, '__WUHAN__']);
  OTHER_CITIES.forEach((city) => {
    const p = s.indexOf(cityKeyword(city));
    if (p >= 0) candidates.push([p, city]);
  });
  const pEz = s.indexOf('鄂州');
  if (pEz >= 0) candidates.push([pEz, '__EZHOU__']);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a[0] - b[0]);
  const hit = candidates[0][1];
  if (hit === '__EZHOU__') return ZONE_XC;   // 鄂州市整体并入新城区域
  if (hit !== '__WUHAN__') return hit;

  // 武汉：在"武汉"之后找最先出现的行政区/功能区
  const tail = s.slice(pW);
  const dh = [];
  WUHAN_DISTRICTS.forEach((d) => {
    const p = tail.indexOf(d);
    if (p >= 0) dh.push([p, 'd', d]);
  });
  WUHAN_ZONE_DIRECT.forEach(([kw, z]) => {
    const p = tail.indexOf(kw);
    if (p >= 0) dh.push([p, 'z', z]);
  });
  if (!dh.length) return null;
  dh.sort((a, b) => a[0] - b[0]);
  const [, kind, val] = dh[0];
  if (kind === 'z') return val;
  if (val === HONGSHAN_DISTRICT) {
    // 洪山切两半：西侧地名 -> 武汉区域；其余（含光谷/东湖高新）默认新城区域
    return HONGSHAN_WEST_KW.some((kw) => tail.includes(kw)) ? ZONE_WH : ZONE_XC;
  }
  return DIST_ZONE[val];
}

/* ---------- v1.9.0 G列（位置/仓库名）宽松联想 ----------
 * 仓名常无"武汉市"前缀（如"汉阳仓""仙桃仓""城投汉口仓"），parseRegion 识别不了；
 * 这里在完整解析失败后，直接搜市州名/武汉区名/汉口/功能区关键词，取最先出现的 */
const WUHAN_DIST_LOOSE = [
  ['东西湖', ZONE_DXH], ['江岸', ZONE_DXH], ['江汉', ZONE_DXH], ['硚口', ZONE_DXH], ['黄陂', ZONE_DXH],
  ['汉阳', ZONE_HY], ['汉南', ZONE_HY], ['蔡甸', ZONE_HY],
  ['武昌', ZONE_WH], ['江夏', ZONE_WH],
  ['青山', ZONE_XC], ['新洲', ZONE_XC],
  ['汉口', ZONE_DXH],
];
// 洪山西侧地名（->武汉区域），与 addr 解析同口径
const HONGSHAN_WEST_LOOSE = HONGSHAN_WEST_KW.map((kw) => [kw, ZONE_WH]);

function guessRegionLoose(text) {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, '');
  const direct = parseRegion(s);
  if (direct) return direct;
  const cand = [];
  OTHER_CITIES.forEach((city) => {
    const p = s.indexOf(cityKeyword(city));
    if (p >= 0) cand.push([p, city]);
  });
  const pEz = s.indexOf('鄂州');
  if (pEz >= 0) cand.push([pEz, ZONE_XC]);
  const pHs = s.indexOf('洪山');
  if (pHs >= 0) {
    cand.push([pHs, HONGSHAN_WEST_KW.some((kw) => s.includes(kw)) ? ZONE_WH : ZONE_XC]);
  }
  WUHAN_DIST_LOOSE.forEach(([kw, z]) => {
    const p = s.indexOf(kw);
    if (p >= 0) cand.push([p, z]);
  });
  HONGSHAN_WEST_LOOSE.forEach(([kw, z]) => {
    const p = s.indexOf(kw);
    if (p >= 0) cand.push([p, z]);
  });
  WUHAN_ZONE_DIRECT.forEach(([kw, z]) => {
    const p = s.indexOf(kw);
    if (p >= 0) cand.push([p, z]);
  });
  if (!cand.length) return null;
  cand.sort((a, b) => a[0] - b[0]);
  return cand[0][1];
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
    else if (h === '位置') cols.loc = i;
    else if (h === '运营门店') cols.store = i;
    else if (h === '所属门店') cols.storeOwn = i;
    else if (h === '服务权服务部名称') cols.dept = i;
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
    loc: cols.loc,
    store: cols.store,
    storeOwn: cols.storeOwn,
    dept: cols.dept,
  };
  const hasRentInfo = ci.rent !== undefined || ci.doc !== undefined;
  const rentedOnly = rentedOnlyOpt && hasRentInfo;

  const salespeople = new Map();
  const regionSales = new Map();
  const regionOrder = REGION_ORDER.concat([UNKNOWN_REGION]);
  const regionTotals = {};
  regionOrder.forEach((n) => { regionTotals[n] = emptyCount(); });
  const unknownSamples = [];
  let totalRows = 0;
  let countedRows = 0;
  let guessedRows = 0; // 定位地址无法识别、靠G列关键词联想成功的行数

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
    let region = parseRegion(addr);
    if (!region) {
      // 定位地址（含省外）无法识别时，依次用位置/运营门店/所属门店/服务部名称做关键词联想
      const fallbacks = [ci.loc, ci.store, ci.storeOwn, ci.dept];
      for (const idx of fallbacks) {
        const raw = cell(row, idx);
        const text = raw == null ? '' : String(raw).trim();
        if (!text || text === '-' || text.toLowerCase() === 'none') continue;
        region = guessRegionLoose(text);
        if (region) { guessedRows++; break; }
      }
    }
    if (!region) region = UNKNOWN_REGION;
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
    guessedRows,
  };
}
