// Small SVG charts with hover tooltips. Colors come from CSS variables so
// light/dark themes swap together. No dependencies.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p * 1.1) * p; };
  const shortDate = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function frame(container, height) {
    container.innerHTML = '';
    container.classList.add('chart');
    const W = Math.max(320, container.clientWidth || 600), H = height;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; container.appendChild(tip);
    return { svg, tip, W, H, m: { l: 44, r: 12, t: 10, b: 26 } };
  }
  function axes(svg, f, max, ticks = 4) {
    for (let i = 0; i <= ticks; i++) {
      const y = f.m.t + (f.H - f.m.t - f.m.b) * (1 - i / ticks);
      el('line', { x1: f.m.l, x2: f.W - f.m.r, y1: y, y2: y, style: `stroke:var(--border);stroke-width:1` }, svg);
      const t = el('text', { x: f.m.l - 6, y: y + 4, 'text-anchor': 'end', style: 'fill:var(--muted);font-size:11px' }, svg);
      t.textContent = fmt(max * i / ticks);
    }
  }
  function legend(container, series) {
    if (series.length < 2) return;
    const lg = document.createElement('div'); lg.className = 'legend';
    lg.innerHTML = series.map(s => `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join('');
    container.prepend(lg);
  }

  // series: [{ name, color, points: [{ x: 'YYYY-MM-DD', y }] }]
  window.lineChart = function (container, series, { height = 220, unit = '' } = {}) {
    const f = frame(container, height), { svg, tip, W, H, m } = f;
    const xs = [...new Set(series.flatMap(s => s.points.map(p => p.x)))].sort();
    if (!xs.length) { container.innerHTML = '<div class="empty">No data yet</div>'; return; }
    const ys = series.flatMap(s => s.points.map(p => p.y));
    const min0 = Math.min(...ys), max0 = Math.max(...ys);
    const lo = Math.max(0, Math.floor((min0 - (max0 - min0) * 0.15) / 10) * 10), hi = niceMax(max0);
    const X = x => m.l + (W - m.l - m.r) * (xs.length === 1 ? 0.5 : xs.indexOf(x) / (xs.length - 1));
    const Y = y => m.t + (H - m.t - m.b) * (1 - (y - lo) / (hi - lo || 1));
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4, y = Y(v);
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, style: 'stroke:var(--border)' }, svg);
      el('text', { x: m.l - 6, y: y + 4, 'text-anchor': 'end', style: 'fill:var(--muted);font-size:11px' }, svg).textContent = fmt(v);
    }
    const step = Math.ceil(xs.length / 6);
    xs.forEach((x, i) => { if (i % step === 0) el('text', { x: X(x), y: H - 6, 'text-anchor': 'middle', style: 'fill:var(--muted);font-size:11px' }, svg).textContent = shortDate(x); });
    for (const s of series) {
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      el('path', { d, fill: 'none', style: `stroke:${s.color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round` }, svg);
      const last = s.points[s.points.length - 1];
      if (last && series.length <= 4) el('text', { x: X(last.x) - 4, y: Y(last.y) - 8, 'text-anchor': 'end', style: 'fill:var(--text-2);font-size:11.5px;font-weight:600' }, svg).textContent = fmt(last.y);
    }
    legend(container, series);
    // crosshair + tooltip
    const cross = el('line', { y1: m.t, y2: H - m.b, style: 'stroke:var(--muted);stroke-dasharray:3 3', visibility: 'hidden' }, svg);
    const dots = series.map(s => el('circle', { r: 4.5, style: `fill:${s.color};stroke:var(--surface);stroke-width:2`, visibility: 'hidden' }, svg));
    const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
      const i = Math.max(0, Math.min(xs.length - 1, Math.round((px - m.l) / (W - m.l - m.r) * (xs.length - 1))));
      const x = xs[i];
      cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.setAttribute('visibility', 'visible');
      const rows = series.map((s, k) => {
        const p = s.points.find(q => q.x === x);
        dots[k].setAttribute('visibility', p ? 'visible' : 'hidden');
        if (p) { dots[k].setAttribute('cx', X(x)); dots[k].setAttribute('cy', Y(p.y)); }
        return p ? `<div><i class="dot" style="background:${s.color}"></i> ${s.name}: <b>${p.y.toLocaleString()}</b>${unit}</div>` : '';
      }).join('');
      tip.innerHTML = `<div class="muted">${shortDate(x)}</div>${rows}`; tip.hidden = false;
      const left = X(x) / W * r.width;
      tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '8px';
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); });
  };

  // groups: [{ label, values: { key: number } }], keys: [{ key, name, color }]
  window.barChart = function (container, groups, keys, { height = 220 } = {}) {
    const f = frame(container, height), { svg, tip, W, H, m } = f;
    const max = niceMax(Math.max(...groups.flatMap(g => keys.map(k => g.values[k.key] || 0)), 1));
    axes(svg, f, max);
    const gw = (W - m.l - m.r) / groups.length, bw = Math.max(4, Math.min(28, (gw - 10) / keys.length - 2));
    groups.forEach((g, gi) => {
      const x0 = m.l + gi * gw + (gw - keys.length * (bw + 2)) / 2;
      el('text', { x: m.l + gi * gw + gw / 2, y: H - 6, 'text-anchor': 'middle', style: 'fill:var(--muted);font-size:11px' }, svg).textContent = g.label;
      keys.forEach((k, ki) => {
        const v = g.values[k.key] || 0, h = (H - m.t - m.b) * v / max, x = x0 + ki * (bw + 2), y = H - m.b - h;
        // rounded top, square base
        const r = Math.min(4, bw / 2, h);
        el('path', { d: `M${x},${H - m.b}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H - m.b}Z`, style: `fill:${k.color}` }, svg);
      });
      const hit = el('rect', { x: m.l + gi * gw, y: m.t, width: gw, height: H - m.t - m.b, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', e => {
        const r = svg.getBoundingClientRect();
        tip.innerHTML = `<div class="muted">${g.title || g.label}</div>` + keys.map(k => `<div><i class="dot" style="background:${k.color}"></i> ${k.name}: <b>${(g.values[k.key] || 0).toLocaleString()}</b></div>`).join('');
        tip.hidden = false;
        tip.style.left = Math.min((e.clientX - r.left) + 12, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '8px';
      });
      hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
    legend(container, keys.map(k => ({ name: k.name, color: k.color })));
  };
})();
