/* ============================================================
 * DataView —— 数据渲染层（访问者页 / 管理员页共用）
 * 负责：业务员表格、汇总行、业务员下拉、湖北地图、未识别提示
 * 数据来源由各页面自行决定（访问者拉取线上 JSON，管理员本地解析）
 * ============================================================ */

window.UNKNOWN_REGION = window.UNKNOWN_REGION || '未识别区域';

class DataView {
  constructor(els) {
    this.el = els; // {tbody, sumScissor, sumBoom, summaryRow, select, sub, map, mapTitle, unknownCard, unknownText, unknownSamples}
    this.data = null;
    this.currentSales = '__ALL__';
    this.chart = null;
    this.geo = null;
    this.onSalesChange = null;

    if (this.el.select) {
      this.el.select.addEventListener('change', () => {
        this.setSales(this.el.select.value);
      });
    }
  }

  async loadGeo() {
    if (this.geo) return this.geo;
    const resp = await fetch('./hubei.json');
    this.geo = await resp.json();
    return this.geo;
  }

  setData(data) {
    this.data = data;
    this.currentSales = '__ALL__';
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
    this.renderSelect();
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
    if (!this.chart) this.chart = echarts.init(this.el.map);
    const geo = await this.loadGeo();
    echarts.registerMap('hubei', geo);

    const mapData = this.data.regions
      .filter((r) => r.name !== UNKNOWN_REGION)
      .map((r) => {
        const v = this.getRegionView(r.name);
        return { name: r.name, value: v.total, scissor: v.scissor, boom: v.boom };
      });
    const maxVal = Math.max(1, ...mapData.map((d) => d.value));

    if (this.el.mapTitle) {
      this.el.mapTitle.textContent = this.currentSales === '__ALL__'
        ? '湖北省在租设备分布（全部数据）'
        : `${this.currentSales} 的在租设备分布`;
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
          if (t === 0) return `<b>${p.name}</b><br/>暂无在租设备`;
          return `<b style="font-size:14px">${p.name}</b><br/>` +
                 `剪刀车：<b style="color:#7dd3fc">${s}</b> 台<br/>` +
                 `臂　车：<b style="color:#fdba74">${b}</b> 台<br/>` +
                 `合　计：<b>${t}</b> 台`;
        },
      },
      visualMap: {
        type: 'continuous', min: 0, max: maxVal,
        left: 16, bottom: 18, text: ['多', '少'], calculable: true,
        inRange: { color: ['#e3edfb', '#7fb0f5', '#2563eb', '#173b8e'] },
        outOfRange: { color: '#f1f5f9' },
        textStyle: { color: '#475569', fontSize: 12 },
      },
      series: [{
        name: '在租设备', type: 'map', map: 'hubei',
        roam: true, zoom: 1.05,
        layoutCenter: ['50%', '52%'], layoutSize: '96%', selectedMode: false,
        label: {
          show: true,
          formatter: (p) => {
            const d = p.data || {};
            if ((d.value || 0) > 0) {
              return `{n|${p.name}}\n{c|剪${d.scissor || 0}} {b|臂${d.boom || 0}}`;
            }
            return `{n|${p.name}}`;
          },
          rich: {
            n: { color: '#334155', fontSize: 11, fontWeight: 600, lineHeight: 15 },
            c: { color: '#1d4ed8', fontSize: 10, lineHeight: 14 },
            b: { color: '#c2410c', fontSize: 10, lineHeight: 14 },
          },
        },
        emphasis: {
          label: {
            show: true,
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

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
