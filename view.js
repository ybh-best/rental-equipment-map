/* ============================================================
 * DataView —— 数据渲染层（访问者页 / 管理员页共用）
 * 负责：业务员表格、汇总行、业务员下拉、湖北地图、未识别提示
 * 数据来源由各页面自行决定（访问者拉取线上 JSON，管理员本地解析）
 * ============================================================ */

window.UNKNOWN_REGION = window.UNKNOWN_REGION || '未识别区域';

/* github.io 卡住/某镜像被拦时自动逐级切换：gcore/fastly/jsdelivr → statically → raw */
const DATA_MIRRORS = (p) => [
  'https://gcore.jsdelivr.net/gh/ybh-best/rental-equipment-map@main/' + p,
  'https://fastly.jsdelivr.net/gh/ybh-best/rental-equipment-map@main/' + p,
  'https://cdn.jsdelivr.net/gh/ybh-best/rental-equipment-map@main/' + p,
  'https://cdn.statically.io/gh/ybh-best/rental-equipment-map/main/' + p,
  'https://raw.githubusercontent.com/ybh-best/rental-equipment-map/main/' + p,
];
async function getJsonOnce(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchWithMirrors(localUrl, repoPath) {
  try {
    return await getJsonOnce(localUrl, 4000);
  } catch (e) {
    for (const u of DATA_MIRRORS(repoPath)) {
      try {
        return await getJsonOnce(u, 8000);
      } catch (_) { /* 试下一个镜像 */ }
    }
    throw new Error('所有数据源均不可用');
  }
}

class DataView {
  constructor(els) {
    this.el = els; // {tbody, sumScissor, sumBoom, summaryRow, select, sub, map, mapTitle, unknownCard, unknownText, unknownSamples, regionSel, typeSel, sumCard}
    this.data = null;
    this.currentSales = '__ALL__';
    this.chart = null;
    this.geo = null;
    this.selectedRegions = null; // null=全选；否则为区域名数组（可空）
    this.types = { scissor: true, boom: true }; // 设备类型勾选：默认全选
    this.onSalesChange = null;

    if (this.el.select) {
      this.el.select.addEventListener('change', () => {
        this.setSales(this.el.select.value);
      });
    }
    if (this.el.regionSel) this._bindRegionSel();
    if (this.el.typeSel) this._bindTypeSel();
  }

  /* 设备类型多选（剪刀车/臂车）：两项，不允许全不勾 */
  _bindTypeSel() {
    const root = this.el.typeSel;
    const btn = root.querySelector('.rs-btn');
    const list = root.querySelector('.rs-list');
    btn.addEventListener('click', () => root.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) root.classList.remove('open');
    });
    list.addEventListener('change', () => {
      const s = list.querySelector('input[value="scissor"]').checked;
      const b = list.querySelector('input[value="boom"]').checked;
      if (!s && !b) { /* 不允许空选择，勾回原先保持勾选的那项 */
        const last = this.types.scissor ? 'scissor' : 'boom';
        list.querySelector(`input[value="${last}"]`).checked = true;
        this.types = { scissor: last === 'scissor', boom: last === 'boom' };
      } else {
        this.types = { scissor: s, boom: b };
      }
      this._paintTypeSel();
      this.renderMap();
    });
  }

  _paintTypeSel() {
    const btn = this.el.typeSel.querySelector('.rs-btn');
    const { scissor, boom } = this.types;
    btn.textContent = (scissor && boom) ? '全部类型' : (scissor ? '剪刀车' : '臂车');
  }

  /* 按类型勾选折算某区域的台数 */
  _typeVal(v) {
    return (this.types.scissor ? v.scissor : 0) + (this.types.boom ? v.boom : 0);
  }

  /* 区域多选下拉组件：__ALL__ 与具体区域互斥；外部点击收起 */
  _bindRegionSel() {
    const root = this.el.regionSel;
    const btn = root.querySelector('.rs-btn');
    const list = root.querySelector('.rs-list');
    btn.addEventListener('click', () => root.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) root.classList.remove('open');
    });
    list.addEventListener('change', (e) => {
      const t = e.target;
      if (t.value === '__ALL__') {
        if (t.checked) {
          list.querySelectorAll('input').forEach((i) => {
            if (i !== t) i.checked = false;
          });
        } else {
          t.checked = true; /* 不允许空选择 */
        }
      } else if (t.checked) {
        list.querySelector('input[value="__ALL__"]').checked = false;
      } else if (!list.querySelector('input:checked')) {
        list.querySelector('input[value="__ALL__"]').checked = true;
      }
      this.selectedRegions = this._readRegionSel();
      this._paintRegionSel();
      this.renderMap();
    });
  }

  _readRegionSel() {
    const list = this.el.regionSel.querySelector('.rs-list');
    if (!list) return null;
    const all = list.querySelector('input[value="__ALL__"]');
    if (all.checked) return null;
    const picked = [];
    list.querySelectorAll('input:checked').forEach((i) => picked.push(i.value));
    return picked.length ? picked : null;
  }

  _paintRegionSel() {
    const btn = this.el.regionSel.querySelector('.rs-btn');
    const picked = this.selectedRegions;
    if (!picked) {
      btn.textContent = '全部区域';
      return;
    }
    if (picked.length === 1) btn.textContent = picked[0];
    else if (picked.length <= 2) btn.textContent = picked.join('、');
    else btn.textContent = `已选 ${picked.length} 个区域`;
  }

  renderRegionSel() {
    if (!this.el.regionSel) return;
    const list = this.el.regionSel.querySelector('.rs-list');
    list.innerHTML = '';
    const names = ['__ALL__'].concat(
      this.data.regions.filter((r) => r.name !== UNKNOWN_REGION).map((r) => r.name)
    );
    names.forEach((n) => {
      const id = 'rs-' + this.el.regionSel.id + '-' + encodeURIComponent(n).replace(/%/g, '');
      const lb = document.createElement('label');
      lb.className = 'rs-item';
      lb.htmlFor = id;
      lb.innerHTML =
        `<input type="checkbox" id="${id}" value="${esc(n)}"${n === '__ALL__' ? ' checked' : ''}>` +
        `<span>${esc(n === '__ALL__' ? '全部区域' : n)}</span>`;
      list.appendChild(lb);
    });
    this.selectedRegions = null;
    this._paintRegionSel();
  }

  async loadGeo() {
    if (this.geo) return this.geo;
    const resp = await fetchWithMirrors('./hubei.json', 'hubei.json');
    this.geo = await resp.json();
    return this.geo;
  }

  setData(data) {
    this.data = data;
    this.currentSales = '__ALL__';
    this.selectedRegions = null;
    if (this.el.select) this.el.select.value = '__ALL__';
    this.renderAll();
  }

  setSales(name) {
    this.currentSales = name;
    if (this.el.select) this.el.select.value = name;
    this.renderTable();
    this.renderUnknown();
    this.renderMap();
    if (this.onSalesChange) this.onSalesChange(name);
  }

  renderAll() {
    if (this.el.placeholder) this.el.placeholder.style.display = 'none';
    this.renderSelect();
    this.renderRegionSel();
    this.renderTable();
    this.renderUnknown();
    this.renderMap();
  }

  renderSelect() {
    if (!this.el.select) return;
    const sel = this.el.select;
    sel.innerHTML = '<option value="__ALL__">全部数据（汇总）</option>';
    this.data.salespeople.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = `${s.name}（剪${s.scissor} / 臂${s.boom}）`;
      sel.appendChild(opt);
    });
    sel.value = this.currentSales;
    sel.disabled = false;
  }

  renderTable() {
    const tbody = this.el.tbody;
    tbody.innerHTML = '';
    this.data.salespeople.forEach((s) => {
      const tr = document.createElement('tr');
      if (s.name === this.currentSales) tr.className = 'active';
      tr.innerHTML =
        `<td class="col-name">${esc(s.name)}</td>` +
        `<td class="col-num">${s.scissor}</td>` +
        `<td class="col-num">${s.boom}</td>`;
      tr.addEventListener('click', () => this.setSales(s.name));
      tbody.appendChild(tr);
    });
    if (this.el.sumScissor) this.el.sumScissor.textContent = this.data.totals.scissor;
    if (this.el.sumBoom) this.el.sumBoom.textContent = this.data.totals.boom;
    if (this.el.summaryRow) this.el.summaryRow.style.display = '';
  }

  getRegionView(regionName) {
    const r = this.data.regions.find((x) => x.name === regionName);
    if (!r) return { scissor: 0, boom: 0, total: 0 };
    if (this.currentSales === '__ALL__') {
      return { scissor: r.scissor, boom: r.boom, total: r.total };
    }
    const v = r.sales.find((x) => x.name === this.currentSales);
    return v ? { scissor: v.scissor, boom: v.boom, total: v.scissor + v.boom }
             : { scissor: 0, boom: 0, total: 0 };
  }

  renderUnknown() {
    if (!this.el.unknownCard) return;
    const v = this.getRegionView(UNKNOWN_REGION);
    if (v.total > 0) {
      this.el.unknownCard.style.display = '';
      const who = this.currentSales === '__ALL__' ? '全部' : this.currentSales;
      this.el.unknownText.textContent =
        `${who} 有 ${v.total} 台设备（剪刀车 ${v.scissor} 台、臂车 ${v.boom} 台）无法定位到湖北区域，未显示在地图上。`;
      if (this.el.unknownSamples) {
        if (this.currentSales === '__ALL__' && (this.data.unknownSamples || []).length) {
          this.el.unknownSamples.innerHTML =
            '地址样例：' + this.data.unknownSamples.map(esc).join('<br>');
        } else {
          this.el.unknownSamples.innerHTML = '';
        }
      }
    } else {
      this.el.unknownCard.style.display = 'none';
    }
  }

  async renderMap() {
    if (!this.data || !this.el.map) return;
    // echarts 可能还在从国内 CDN 兜底加载中，等它就绪（最多等约 20 秒）
    if (!window.echarts) {
      this._echartsWaits = (this._echartsWaits || 0) + 1;
      if (this._echartsWaits <= 40) setTimeout(() => this.renderMap(), 500);
      return;
    }
    this._echartsWaits = 0;
    if (!this.chart) this.chart = echarts.init(this.el.map);
    const geo = await this.loadGeo();

    // 区域筛选：null=全省；否则只保留选中的区域几何
    const picked = this.selectedRegions;
    const picking = Array.isArray(picked);
    const viewGeo = picking
      ? { type: 'FeatureCollection', features: geo.features.filter((f) => picked.includes(f.properties.name)) }
      : geo;

    const mapData = this.data.regions
      .filter((r) => r.name !== UNKNOWN_REGION)
      .filter((r) => !picking || picked.includes(r.name))
      .map((r) => {
        const v = this.getRegionView(r.name);
        return { name: r.name, value: this._typeVal(v), scissor: v.scissor, boom: v.boom };
      });
    const maxVal = Math.max(1, ...mapData.map((d) => d.value));

    // 右下角汇总卡：当前地图所见区域 + 当前业务员 + 勾选的设备类型
    let sumS = 0, sumB = 0;
    mapData.forEach((d) => { sumS += d.scissor; sumB += d.boom; });
    if (this.el.sumCard) {
      const rows = [];
      if (this.types.scissor) rows.push(`剪刀车 <b style="color:#1d4ed8">${sumS}</b> 台`);
      if (this.types.boom) rows.push(`臂车 <b style="color:#c2410c">${sumB}</b> 台`);
      const totalTxt = (this.types.scissor && this.types.boom)
        ? `<br>合计 <b>${sumS + sumB}</b> 台` : '';
      this.el.sumCard.innerHTML =
        `<b>当前地图汇总</b><br>` + rows.join(' · ') + totalTxt;
      this.el.sumCard.style.display = '';
    }

    // 鱼眼变形：地图保持完整连通，有数据的区域按台数在原位"鼓起来"，
    // 周围区域被平滑压缩让位（同一连续函数作用于所有顶点，边界不裂开）
    const valMap = {};
    mapData.forEach((d) => { valMap[d.name] = d.value; });
    const bumps = [];
    mapData.forEach((d) => {
      if (d.value <= 0) return;
      const ft = viewGeo.features.find((f) => f.properties.name === d.name);
      if (!ft) return;
      const bb = geoBBox(ft.geometry);
      bumps.push({
        c: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2],
        r: Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.75 + 0.15,
        a: 0.55 * (d.value / maxVal),
      });
    });
    // 四大板块标签向外微偏（像素），避免与相邻市州标签叠在一起
    const LABEL_OFFSET = {
      '东西湖区域': [-14, -22],
      '新城区域': [26, -6],
      '汉阳区域': [-26, 0],
      '武汉区域': [-14, 36],
      '天门市': [-6, -20],
      '潜江市': [-34, 8],
      '仙桃市': [16, 20],
      '黄石市': [24, 12],
    };
    mapData.forEach((d) => {
      if (LABEL_OFFSET[d.name]) d.label = { offset: LABEL_OFFSET[d.name] };
    });
    echarts.registerMap('hubei', morphGeo(viewGeo, bumps));

    if (this.el.mapTitle) {
      const regionPart = picking
        ? (picked.length <= 3 ? picked.join('、') : `${picked.length} 个区域`)
        : '湖北省';
      this.el.mapTitle.textContent = this.currentSales === '__ALL__'
        ? `${regionPart}在租设备分布（全部数据）`
        : `${this.currentSales} · ${regionPart}在租设备分布`;
    }

    this.chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 35, 80, .92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 13 },
        formatter: (p) => {
          const d = p.data || {};
          const s = d.scissor || 0, b = d.boom || 0, t = d.value || 0;
          if (t === 0) return `<b>${p.name}</b><br/>暂无在租设备（按当前类型筛选）`;
          const lines = [`<b style="font-size:14px">${p.name}</b>`];
          if (this.types.scissor) lines.push(`剪刀车：<b style="color:#7dd3fc">${s}</b> 台`);
          if (this.types.boom) lines.push(`臂　车：<b style="color:#fdba74">${b}</b> 台`);
          if (this.types.scissor && this.types.boom) lines.push(`合　计：<b>${t}</b> 台`);
          return lines.join('<br/>');
        },
      },
      visualMap: {
        type: 'continuous', min: 0, max: maxVal,
        left: 20, bottom: 26, text: ['多', '少'], calculable: true,
        inRange: { color: ['#e3edfb', '#7fb0f5', '#2563eb', '#173b8e'] },
        outOfRange: { color: '#f1f5f9' },
        textStyle: { color: '#475569', fontSize: 12 },
      },
      series: [{
        name: '在租设备', type: 'map', map: 'hubei',
        roam: true, zoom: 1.0,
        aspectScale: 1, /* 真实经纬度比例：默认 0.75 把湖北压扁，竖向只占面板约六成，1 可填满高度 */
        layoutCenter: ['50%', '50%'], layoutSize: '100%', selectedMode: false,
        label: {
          show: true,
          backgroundColor: 'rgba(255,255,255,.82)',
          borderRadius: 3,
          padding: [2, 4],
          formatter: (p) => {
            const d = p.data || {};
            const short = {
              '东西湖区域': '东西湖', '汉阳区域': '汉阳', '武汉区域': '武汉', '新城区域': '新城',
              '恩施土家族苗族自治州': '恩施', '神农架林区': '神农架',
            }[p.name] || p.name;
            if ((d.value || 0) > 0) {
              const parts = [];
              if (this.types.scissor) parts.push(`{c|剪${d.scissor || 0}}`);
              if (this.types.boom) parts.push(`{b|臂${d.boom || 0}}`);
              return `{n|${short}}\n` + parts.join(' ');
            }
            return ''; // 无数据区域不显示标签，避免拥挤（悬停时显示）
          },
          rich: {
            n: { color: '#334155', fontSize: 12, fontWeight: 600, lineHeight: 16 },
            c: { color: '#1d4ed8', fontSize: 11, lineHeight: 15 },
            b: { color: '#c2410c', fontSize: 11, lineHeight: 15 },
          },
        },
        emphasis: {
          label: {
            show: true,
            formatter: (p) => `{n|${p.name}}`,
            rich: {
              n: { color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 18 },
              c: { color: '#bfdbfe', fontSize: 12, lineHeight: 16 },
              b: { color: '#fed7aa', fontSize: 12, lineHeight: 16 },
            },
          },
          itemStyle: { areaColor: '#f59e0b', shadowBlur: 14, shadowColor: 'rgba(0,0,0,.3)' },
        },
        itemStyle: { borderColor: '#ffffff', borderWidth: 1, areaColor: '#f1f5f9' },
        data: mapData,
      }],
    }, true);
  }

  resize() { if (this.chart) this.chart.resize(); }
}

/* 几何包围盒 [minX, minY, maxX, maxY] */
function geoBBox(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (n) => {
    if (typeof n[0] === 'number') {
      if (n[0] < minX) minX = n[0];
      if (n[0] > maxX) maxX = n[0];
      if (n[1] < minY) minY = n[1];
      if (n[1] > maxY) maxY = n[1];
      return;
    }
    n.forEach(walk);
  };
  walk(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

/* 鱼眼变形：对每个有数据的区域施加一个高斯凸包位移场（中心处向外推得最多，
   随距离平滑衰减），所有场叠加后作用于全省每一个顶点。由于是纯连续函数，
   相邻区域共享的边界点变换结果一致，地图保持完整连通不裂开 */
function morphGeo(geo, bumps) {
  const clone = JSON.parse(JSON.stringify(geo));
  const f = (p) => {
    let tx = 0, ty = 0;
    for (const b of bumps) {
      const dx = p[0] - b.c[0], dy = p[1] - b.c[1];
      const w = b.a * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
      tx += dx * w;
      ty += dy * w;
    }
    p[0] += tx;
    p[1] += ty;
  };
  const walk = (n) => {
    if (typeof n[0] === 'number') { f(n); return; }
    n.forEach(walk);
  };
  for (const ft of clone.features) {
    walk(ft.geometry.coordinates);
    if (ft.properties.cp) f(ft.properties.cp);
  }
  return clone;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
