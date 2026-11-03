// Social Manager — single-page UI (no build step).
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PF = { youtube: { name: 'YouTube', color: 'var(--yt)' }, instagram: { name: 'Instagram', color: 'var(--ig)' } };
const STATUS = { planned: ['Planned', ''], publishing: ['Publishing…', 'warn'], posted: ['Posted', 'good'], failed: ['Failed', 'bad'], manual_due: ['Post manually', 'warn'] };
let state = { channels: [] };
let chatLog = [];

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: opts.body && typeof opts.body === 'string' && !opts.csv ? { 'Content-Type': 'application/json' } : opts.csv ? { 'Content-Type': 'text/csv' } : {}, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b || {}) });
const del = p => api(p, { method: 'DELETE' });

function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms); }
function modal(html, onMount) {
  const m = $('#modal'); m.querySelector('.modal-card').innerHTML = html; m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; };
  onMount && onMount(m.querySelector('.modal-card'));
}
const closeModal = () => ($('#modal').hidden = true);
const pfBadge = p => `<span class="badge ${p}">${PF[p] ? PF[p].name : p}</span>`;
const statusBadge = s => { const [t, c] = STATUS[s] || [s, '']; return `<span class="badge ${c}">${t}</span>`; };
const fmtWhen = s => s ? new Date(s).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
const delta = (v, suffix = '%') => v == null ? '<span class="flat">—</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${Math.abs(v)}${suffix}</span>`;
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const monday = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const chFilter = () => Number($('#channel-filter').value) || 0;
const visibleChannels = () => state.channels.filter(c => !chFilter() || c.id === chFilter());
function needChannel(view) {
  if (state.channels.length) return false;
  view.innerHTML = `<div class="card empty"><p>No channels yet.</p><a class="btn primary" href="#/channels">Add your first channel</a></div>`;
  return true;
}
function oneChannel(view, page) {
  // analytics/insights work on one channel at a time
  const id = chFilter() || (state.channels[0] && state.channels[0].id);
  if (!chFilter() && state.channels.length > 1) view.insertAdjacentHTML('afterbegin', `<p class="muted small">Showing ${esc(state.channels[0].name)}. Pick a channel above to switch.</p>`);
  return id;
}

async function loadState() {
  state = await api('/api/state');
  const sel = $('#channel-filter'), keep = sel.value || localStorage.getItem('channel') || '';
  sel.innerHTML = `<option value="">All channels</option>` + state.channels.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sel.value = state.channels.some(c => String(c.id) === keep) ? keep : '';
}

// ---------------------------------------------------------------- dashboard
async function pageDashboard(view) {
  if (needChannel(view)) return;
  const d = await api('/api/dashboard');
  const chans = d.channels.filter(c => !chFilter() || c.id === chFilter());
  const upcoming = d.upcoming.filter(p => !chFilter() || p.channel_id === chFilter());
  const todo = d.todo.filter(p => !chFilter() || p.channel_id === chFilter());
  view.innerHTML = `
    ${chans.some(c => c.demo) ? `<div class="demo-flag">Some numbers below are <b>sample data</b> for trying the app. Clear them from Analytics once your real accounts are connected.</div>` : ''}
    ${todo.length ? `<div class="card" style="margin-bottom:16px"><h2>Needs you <span class="badge bad">${todo.length}</span></h2><ul class="list">${todo.map(p => `
      <li><span class="dot" style="background:${esc(p.color)};margin-top:6px"></span><div style="flex:1"><b>${esc(p.title)}</b> ${pfBadge(p.platform)} ${statusBadge(p.status)}<div class="muted small">${esc(p.channel)} · due ${fmtWhen(p.scheduled_at)} · ${esc(p.error)}</div></div>
      <button class="btn small" data-act="open-post" data-id="${p.id}">Open</button></li>`).join('')}</ul></div>` : ''}
    <div class="grid cols-2">${chans.map(c => dashChannel(c)).join('')}</div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h2>Coming up</h2>${upcoming.length ? `<ul class="list">${upcoming.map(p => `
        <li><span class="dot" style="background:${esc(p.color)};margin-top:6px"></span><div style="flex:1"><b>${esc(p.title)}</b><div class="muted small">${fmtWhen(p.scheduled_at)} · ${esc(p.channel)}</div></div>${pfBadge(p.platform)} ${statusBadge(p.status)}</li>`).join('')}</ul>`
        : `<div class="empty">Nothing scheduled for the next two weeks. <a href="#/planner">Open the planner</a></div>`}</div>
      <div class="card"><h2>Recent activity</h2><ul class="list">${d.activity.map(a => `<li><div style="flex:1">${esc(a.message)}<div class="muted small">${esc(a.channel || '')} · ${new Date(a.at.replace(' ', 'T') + 'Z').toLocaleString()}</div></div></li>`).join('') || '<li class="muted">No activity yet</li>'}</ul></div>
    </div>`;
  view.onclick = e => { const b = e.target.closest('[data-act="open-post"]'); if (b) postModal(todo.find(p => p.id === +b.dataset.id)); };
}

function dashChannel(c) {
  const tiles = Object.entries(c.growth).map(([pf, g]) => `
    <div class="stat"><div class="label"><i class="dot" style="background:${PF[pf].color}"></i>${PF[pf].name} ${pf === 'youtube' ? 'subscribers' : 'followers'}</div>
      <div class="value">${g.followers != null ? g.followers.toLocaleString() : '—'}</div>
      <div class="delta">${g.followers_gained != null ? `${g.followers_gained >= 0 ? '+' : ''}${g.followers_gained} this week` : 'not synced yet'}</div></div>
    <div class="stat"><div class="label"><i class="dot" style="background:${PF[pf].color}"></i>${PF[pf].name} views this week</div>
      <div class="value">${g.views.toLocaleString()}</div><div class="delta">${delta(g.views_change_pct)} <span class="muted">vs same days last week</span></div></div>`).join('');
  const nw = c.nextWeek, tw = c.thisWeek;
  return `<div class="card">
    <h2><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)} ${c.demo ? '<span class="badge warn">sample data</span>' : ''}</h2>
    ${tiles ? `<div class="stats">${tiles}</div>` : '<p class="muted">No analytics yet. Connect accounts or import a CSV on the Analytics page.</p>'}
    <h3>Weekly pipeline</h3>
    <div class="row small">
      <span>This week: <b>${tw.planned}/${tw.slots}</b> slots planned</span>
      <span>Next week: <b>${nw.planned}/${nw.slots}</b> planned</span>
      <span>Ready to post: ${Object.entries(nw.stock).map(([p, n]) => `${PF[p].name} ${n}`).join(', ') || '—'}</span>
      ${nw.shortfall > 0 ? `<span class="badge bad">${nw.shortfall} video(s) short for next week</span>` : nw.slots ? '<span class="badge good">Enough videos for next week</span>' : ''}
    </div>
    <h3>Your manager says</h3>
    <ul class="list">${c.next.map(n => `<li><span class="prio ${n.priority}">${n.priority}</span><span>${esc(n.text)}</span></li>`).join('') || '<li class="muted">All good for now.</li>'}</ul>
    ${c.working.length ? `<h3>Working best</h3>${c.working.map(w => `<div class="finding good">${esc(w.text)}</div>`).join('')}` : ''}
  </div>`;
}

// ---------------------------------------------------------------- planner
let plannerWeek = monday();
async function pagePlanner(view) {
  if (needChannel(view)) return;
  const from = stamp(plannerWeek), to = stamp(addDays(plannerWeek, 7));
  const [posts, videos] = await Promise.all([api(`/api/posts?from=${from}&to=${to}`), api(`/api/videos?channel=${chFilter()}`)]);
  const shown = posts.filter(p => !chFilter() || p.channel_id === chFilter());
  const tray = videos.filter(v => v.status === 'ready' && v.posts.length < 2);
  const today = stamp(new Date()).slice(0, 10);
  view.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <button class="btn" data-act="prev">‹</button>
      <b>Week of ${plannerWeek.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</b>
      <button class="btn" data-act="next">›</button>
      <button class="btn" data-act="today">This week</button>
      <span class="spacer"></span>
      <button class="btn primary" data-act="auto">Auto-plan this week</button>
    </div>
    <div class="planner-layout">
      <div class="week-scroll"><div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => {
        const day = addDays(plannerWeek, i), ds = stamp(day).slice(0, 10);
        const items = shown.filter(p => p.scheduled_at.startsWith(ds));
        return `<div class="day ${ds === today ? 'today' : ''}" data-day="${ds}">
          <div class="day-head"><span>${DAYS[i]}</span><span>${day.getDate()}</span></div>
          ${items.map(p => `<div class="post" draggable="${p.status !== 'posted'}" data-post="${p.id}" style="--c:${esc(p.color)}">
            ${p.has_cover ? `<img src="/media/cover/${p.video_id}" alt="" loading="lazy">` : p.has_thumb ? `<img src="/media/thumb/${p.video_id}" alt="" loading="lazy">` : ''}
            <div class="t">${esc(p.title)}</div>
            <div class="row" style="gap:4px">${pfBadge(p.platform)} <span class="muted">${p.scheduled_at.slice(11)}</span></div>
            <div style="margin-top:3px">${statusBadge(p.status)}</div></div>`).join('')}
        </div>`;
      }).join('')}</div></div>
      <div class="card tray"><h2>Ready to schedule</h2><p class="muted small">Drag a video onto a day. It's scheduled at your usual posting times for every platform it hasn't gone to yet.</p>
        ${tray.map(v => `<div class="vid" draggable="true" data-video="${v.id}">${v.cover_path ? `<img src="/media/cover/${v.id}" alt="">` : ''}<div><b>${esc(v.title)}</b><div class="muted small">${v.posts.map(p => PF[p.platform].name).join(', ') || 'not scheduled'}</div></div></div>`).join('') || '<div class="empty small">Every ready video is scheduled. Import new videos from the Library.</div>'}
      </div>
    </div>`;
  view.onclick = async e => {
    const a = e.target.closest('[data-act]'), card = e.target.closest('[data-post]');
    if (a) {
      if (a.dataset.act === 'prev') plannerWeek = addDays(plannerWeek, -7);
      if (a.dataset.act === 'next') plannerWeek = addDays(plannerWeek, 7);
      if (a.dataset.act === 'today') plannerWeek = monday();
      if (a.dataset.act === 'auto') {
        const r = await post('/api/plan/auto', { week: from.slice(0, 10), channel_id: chFilter() || null });
        const made = r.reduce((s, x) => s + x.created.length, 0), empty = r.reduce((s, x) => s + x.unfilled.length, 0);
        toast(`Planned ${made} post(s).${empty ? ` ${empty} slot(s) left empty: not enough ready videos.` : ''}`, 4000);
      }
      return route();
    }
    if (card) postModal(shown.find(p => p.id === +card.dataset.post));
  };
  // drag & drop: move a post to another day (same time), or drop a ready video to schedule it
  view.ondragstart = e => { const p = e.target.closest('[data-post],[data-video]'); if (p) e.dataTransfer.setData('text/plain', JSON.stringify(p.dataset)); };
  view.ondragover = e => { const d = e.target.closest('.day'); if (d) { e.preventDefault(); d.classList.add('drop'); } };
  view.ondragleave = e => { const d = e.target.closest('.day'); if (d) d.classList.remove('drop'); };
  view.ondrop = async e => {
    const d = e.target.closest('.day'); if (!d) return;
    e.preventDefault(); d.classList.remove('drop');
    const data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
    try {
      if (data.post) {
        const p = shown.find(x => x.id === +data.post);
        await put(`/api/posts/${p.id}`, { scheduled_at: `${d.dataset.day}T${p.scheduled_at.slice(11)}` });
      } else if (data.video) {
        const v = tray.find(x => x.id === +data.video), ch = state.channels.find(c => c.id === v.channel_id);
        const dayIdx = (new Date(d.dataset.day + 'T00:00').getDay() + 6) % 7;
        const done = v.posts.map(p => p.platform);
        const platforms = [...new Set((ch.schedule || []).map(s => s.platform))].filter(p => !done.includes(p));
        for (const pf of (platforms.length ? platforms : ['youtube', 'instagram'].filter(p => !done.includes(p)))) {
          const slot = (ch.schedule || []).find(s => s.platform === pf && s.day === dayIdx) || (ch.schedule || []).find(s => s.platform === pf);
          await post('/api/posts', { video_id: v.id, platform: pf, scheduled_at: `${d.dataset.day}T${slot ? slot.time : '19:00'}` });
        }
      }
    } catch (err) { toast(err.message); }
    route();
  };
}

function postModal(p) {
  if (!p) return;
  modal(`<h2>${esc(p.title)}</h2>
    <div class="row" style="margin-bottom:10px">${pfBadge(p.platform)} ${statusBadge(p.status)} <span class="muted">${esc(p.channel || '')}</span></div>
    ${p.error ? `<div class="finding bad small">${esc(p.error)}</div>` : ''}
    ${p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">View the live post ↗</a></p>` : ''}
    <div class="form">
      ${p.status !== 'posted' ? `<label>Scheduled for <input type="datetime-local" id="when" value="${esc(p.scheduled_at)}"></label>` : ''}
      <label>Caption <textarea readonly id="cap">${esc(p.caption || '')}</textarea></label>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn" data-a="copy">Copy caption</button>
      <a class="btn" href="/media/video/${p.video_id}" download>Download video</a>
      ${p.has_cover ? `<a class="btn" href="/media/cover/${p.video_id}" download>Vertical cover</a>` : ''}
      ${p.has_portrait ? `<a class="btn" href="/media/portrait/${p.video_id}" download>Portrait cover</a>` : ''}
      ${p.status !== 'posted' ? `<button class="btn" data-a="save">Save time</button><button class="btn primary" data-a="publish">Publish now</button>` : ''}
    </div>
    ${p.status !== 'posted' ? `<h3 class="muted small" style="margin-top:18px">Posted it yourself?</h3>
    <div class="row"><input type="text" id="url" placeholder="Link to the post (optional)" style="flex:1"><button class="btn" data-a="mark">Mark as posted</button><button class="btn danger" data-a="remove">Remove</button></div>` : ''}
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" data-close>Close</button></div>`, card => {
    card.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      try {
        if (a.dataset.a === 'copy') { await navigator.clipboard.writeText($('#cap', card).value); toast('Caption copied'); return; }
        if (a.dataset.a === 'save') await put(`/api/posts/${p.id}`, { scheduled_at: $('#when', card).value });
        if (a.dataset.a === 'publish') { a.disabled = true; a.textContent = 'Publishing…'; const r = await post(`/api/posts/${p.id}/publish`); toast(r.status === 'posted' ? 'Posted!' : r.status === 'manual_due' ? 'No account connected: post it manually.' : `Failed: ${r.error}`, 5000); }
        if (a.dataset.a === 'mark') await put(`/api/posts/${p.id}`, { status: 'posted', url: $('#url', card).value });
        if (a.dataset.a === 'remove') { if (!confirm('Remove this post from the plan?')) return; await del(`/api/posts/${p.id}`); }
        closeModal(); route();
      } catch (err) { toast(err.message, 5000); }
    };
  });
}

// ---------------------------------------------------------------- library
async function pageLibrary(view) {
  if (needChannel(view)) return;
  const videos = await api(`/api/videos?channel=${chFilter()}`);
  view.innerHTML = `
    <div class="row library-toolbar" style="margin-bottom:14px">
      <button class="btn primary" data-act="add">Add video</button>
      ${visibleChannels().map(c => `<button class="btn" data-import="${c.id}" title="${esc(c.video_dir || 'No folder set')}">Import · ${esc(c.name)}</button>`).join('')}
      <span class="spacer"></span><span class="muted small">${videos.length} video(s)</span>
    </div>
    ${videos.length ? `<div class="vids">${videos.map(v => `
      <div class="vcard" data-video="${v.id}">
        <div class="img" style="${v.cover_path ? `background-image:url('/media/cover/${v.id}')` : v.portrait_path ? `background-image:url('/media/portrait/${v.id}')` : v.thumb_path ? `background-image:url('/media/thumb/${v.id}')` : ''}">${v.cover_path || v.portrait_path || v.thumb_path ? '' : 'No cover'}</div>
        <div class="body"><div class="t">${esc(v.title)}</div>
          <div class="row" style="gap:4px"><span class="badge ${v.status === 'ready' ? 'good' : v.status === 'draft' ? 'warn' : ''}">${v.status}</span>${v.duration ? `<span class="badge">${fmtDur(v.duration)}</span>` : ''}${v.cover_path ? '<span class="badge">9:16</span>' : '<span class="badge warn">No vertical cover</span>'}${v.portrait_path ? '<span class="badge">4:5</span>' : '<span class="badge warn">No portrait cover</span>'}</div>
          <div class="row" style="gap:4px">${v.posts.map(p => `${pfBadge(p.platform)}${p.status === 'posted' ? '✓' : ''}`).join(' ') || '<span class="muted small">not scheduled</span>'}</div>
        </div></div>`).join('')}</div>`
      : `<div class="card empty">No videos yet. Add one here, or set a video folder on the Channels page and press Import.</div>`}`;
  view.onclick = async e => {
    const imp = e.target.closest('[data-import]'), card = e.target.closest('[data-video]');
    if (e.target.closest('[data-act="add"]')) return addVideoModal();
    if (imp) { try { const r = await post(`/api/channels/${imp.dataset.import}/import`); toast(`Imported ${r.added} new, refreshed ${r.updated}`); await loadState(); route(); } catch (err) { toast(err.message, 5000); } }
    if (card) videoModal(videos.find(v => v.id === +card.dataset.video));
  };
}

function coverSlots(v) {
  const slot = (id, label, hint, src) => `<label class="cover-slot">${label}<span class="muted small">${hint}</span>${src ? `<img src="${src}" alt="">` : ''}<input type="file" id="${id}" accept="image/png,image/jpeg,image/webp"></label>`;
  return `<div class="cover-grid">
    ${slot('cover', 'Vertical cover', '9:16, for Reels', v && v.cover_path ? `/media/cover/${v.id}?v=${Date.now()}` : '')}
    ${slot('portrait', 'Portrait cover', '4:5, for the feed', v && v.portrait_path ? `/media/portrait/${v.id}?v=${Date.now()}` : '')}
    ${slot('thumb', 'YouTube thumbnail', '16:9, optional', v && v.thumb_path ? `/media/thumb/${v.id}?v=${Date.now()}` : '')}
  </div>`;
}

function watchCoverPicks(card) {
  card.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'file' || !input.files[0] || !input.accept.startsWith('image')) return;
    let img = input.parentElement.querySelector('img');
    if (!img) { img = document.createElement('img'); input.before(img); }
    img.src = URL.createObjectURL(input.files[0]);
  });
}

function addVideoModal() {
  if (!state.channels.length) return toast('Add a channel first.');
  const selected = chFilter() || state.channels[0].id;
  modal(`<h2>Add video</h2>
    <div class="form">
      <label>Channel <select id="ch">${state.channels.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label>Title <input type="text" id="t"></label>
      <label>Caption (Instagram) <textarea id="c"></textarea></label>
      <label>Description (YouTube) <textarea id="d"></textarea></label>
      <label>Topics, comma separated <input type="text" id="g"></label>
      <label>Video <input type="file" id="video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"><span class="muted small">Up to 400 MB. The video is saved in Supabase.</span></label>
      ${coverSlots(null)}
    </div>
    <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Add video</button></div>`, card => {
    watchCoverPicks(card);
    $('#save', card).onclick = async () => {
      const title = $('#t', card).value.trim();
      const video = $('#video', card).files[0], cover = $('#cover', card).files[0], portrait = $('#portrait', card).files[0];
      if (!title) return toast('Give the video a title.');
      if (!video) return toast('Choose the video file.');
      if (video.size > 400 * 1024 * 1024) return toast('Videos must be 400 MB or smaller.');
      if (!cover) return toast('Add the vertical cover (9:16).');
      if (!portrait) return toast('Add the portrait cover (4:5).');
      const body = new FormData();
      body.append('channel_id', $('#ch', card).value);
      body.append('title', title);
      body.append('caption', $('#c', card).value);
      body.append('description', $('#d', card).value);
      body.append('tags', $('#g', card).value);
      body.append('video', video);
      body.append('cover', cover);
      body.append('portrait', portrait);
      if ($('#thumb', card).files[0]) body.append('thumb', $('#thumb', card).files[0]);
      try {
        $('#save', card).disabled = true;
        $('#save', card).textContent = 'Uploading…';
        await api('/api/videos', { method: 'POST', body });
        closeModal(); toast('Video added'); await loadState(); route();
      } catch (err) { $('#save', card).disabled = false; toast(err.message, 5000); }
    };
  });
}

function videoModal(v) {
  modal(`<h2>Edit video</h2>
    <div class="form">
      <label>Title <input type="text" id="t" value="${esc(v.title)}"></label>
      <label>Caption (Instagram) <textarea id="c">${esc(v.caption)}</textarea></label>
      <label>Description (YouTube) <textarea id="d">${esc(v.description)}</textarea></label>
      <label>Topics / tags, comma separated: used to learn what works <input type="text" id="g" value="${esc((v.tags || []).join(', '))}"></label>
      <label>Status <select id="s">${['ready', 'draft', 'archived'].map(s => `<option ${s === v.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${coverSlots(v)}
      <div class="muted small">${String(v.file_path || '').startsWith('sb://') ? 'Video file: stored in Supabase' : `File: ${esc(v.file_path)}`}</div>
    </div>
    <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`, card => {
    watchCoverPicks(card);
    $('#save', card).onclick = async () => {
      await put(`/api/videos/${v.id}`, { title: $('#t', card).value, caption: $('#c', card).value, description: $('#d', card).value, status: $('#s', card).value,
        tags: $('#g', card).value.split(',').map(s => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean) });
      const images = new FormData();
      for (const id of ['cover', 'portrait', 'thumb']) if ($('#' + id, card).files[0]) images.append(id, $('#' + id, card).files[0]);
      if ([...images.keys()].length) await api(`/api/videos/${v.id}/images`, { method: 'POST', body: images });
      closeModal(); route();
    };
  });
}

// ---------------------------------------------------------------- analytics
let sortKey = 'posted_at', sortDir = -1;
async function pageAnalytics(view) {
  if (needChannel(view)) return;
  const id = oneChannel(view);
  const a = await api(`/api/analytics/${id}`);
  const ch = state.channels.find(c => c.id === id);
  const fol = ['youtube', 'instagram'].map(pf => ({ name: PF[pf].name, color: PF[pf].color, points: a.series.followers.filter(f => f.platform === pf).map(f => ({ x: f.date, y: f.followers })) })).filter(s => s.points.length);
  const rows = [...a.posts].sort((x, y) => (x[sortKey] > y[sortKey] ? 1 : x[sortKey] < y[sortKey] ? -1 : 0) * sortDir);
  view.insertAdjacentHTML('beforeend', `
    ${a.demo ? `<div class="demo-flag">This channel is showing <b>sample data</b>. <button class="btn small" data-act="clear-demo">Clear sample data</button></div>` : ''}
    <div class="row" style="margin-bottom:14px">
      <button class="btn primary" data-act="sync">Sync from YouTube &amp; Instagram</button>
      <label class="btn">Import CSV<input type="file" accept=".csv,text/csv" hidden data-act="csv"></label>
      <a class="btn" href="data:text/csv;charset=utf-8,${encodeURIComponent('type,date,platform,title,views,likes,comments,shares,saves,avg_view_pct,followers\npost,2026-10-20,youtube,My video title,1200,80,12,5,9,46,\nchannel,2026-10-20,youtube,,,,,,,,1500\n')}" download="analytics-template.csv">CSV template</a>
      ${a.demo ? '' : `<button class="btn" data-act="demo">Load sample data</button>`}
      <span class="spacer"></span><span class="muted small">${esc(ch.name)}</span>
    </div>
    <div class="card" style="margin-bottom:16px"><h2>This week vs the same days last week</h2>
      <div class="stats">${Object.entries(a.growth).map(([pf, g]) => `
        <div class="stat"><div class="label"><i class="dot" style="background:${PF[pf].color}"></i>${PF[pf].name} ${pf === 'youtube' ? 'subscribers' : 'followers'}</div><div class="value">${g.followers != null ? g.followers.toLocaleString() : '—'}</div><div class="delta">${g.followers_gained != null ? `+${g.followers_gained}` : ''} <span class="muted">${g.followers_gained_prev != null ? `(last week +${g.followers_gained_prev})` : ''}</span></div></div>
        <div class="stat"><div class="label">${PF[pf].name} views</div><div class="value">${g.views.toLocaleString()}</div><div class="delta">${delta(g.views_change_pct)}</div></div>
        <div class="stat"><div class="label">${PF[pf].name} engagements</div><div class="value">${g.engagements.toLocaleString()}</div><div class="delta">${delta(g.engagement_change_pct)}</div></div>`).join('') || '<p class="muted">No data yet.</p>'}</div></div>
    <div class="grid cols-2">
      <div class="card"><h2>Followers</h2><div id="ch-fol"></div></div>
      <div class="card"><h2>Views per week</h2><div id="ch-views"></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Every post</h2><div class="table-wrap"><table>
      <thead><tr>${[['title', 'Video'], ['platform', 'Platform'], ['posted_at', 'Posted'], ['views', 'Views', 1], ['engagements', 'Engagements', 1], ['er', 'Eng. rate', 1], ['avg_view_pct', 'Avg watched', 1]].map(([k, l, n]) => `<th class="${n ? 'num' : ''}" data-sort="${k}">${l}${sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(p => `<tr><td class="title">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</td><td>${pfBadge(p.platform)}</td><td>${esc((p.posted_at || '').slice(0, 10))}</td>
        <td class="num">${p.views.toLocaleString()}</td><td class="num">${p.engagements.toLocaleString()}</td><td class="num">${p.views ? (p.engagements / p.views * 100).toFixed(1) + '%' : '—'}</td><td class="num">${p.avg_view_pct ? Math.round(p.avg_view_pct) + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No posts with data yet</td></tr>'}</tbody></table></div></div>`);
  a.posts.forEach(p => (p.er = p.views ? p.engagements / p.views : 0));
  if (fol.length) lineChart($('#ch-fol'), fol); else $('#ch-fol').innerHTML = '<div class="empty">No follower history yet</div>';
  barChart($('#ch-views'), a.series.weekly.map(w => ({ label: new Date(w.week + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), title: `Week of ${w.week}`, values: w })),
    ['youtube', 'instagram'].filter(pf => a.series.weekly.some(w => w[pf])).map(pf => ({ key: pf, name: PF[pf].name, color: PF[pf].color })));
  view.onclick = async e => {
    const s = e.target.closest('[data-sort]'), act = e.target.closest('[data-act]');
    if (s) { if (sortKey === s.dataset.sort) sortDir *= -1; else { sortKey = s.dataset.sort; sortDir = -1; } return route(); }
    if (!act || act.dataset.act === 'csv') return;
    try {
      if (act.dataset.act === 'sync') { act.disabled = true; act.textContent = 'Syncing…'; const r = await post(`/api/analytics/${id}/sync`); toast(r.report.join(' · ') || 'Nothing to sync', 6000); }
      if (act.dataset.act === 'demo') await post(`/api/demo/${id}`);
      if (act.dataset.act === 'clear-demo') { if (!confirm('Remove all sample data for this channel?')) return; await del(`/api/demo/${id}`); }
      await loadState(); route();
    } catch (err) { toast(err.message, 6000); route(); }
  };
  view.onchange = async e => {
    if (e.target.dataset.act !== 'csv' || !e.target.files[0]) return;
    try { const r = await api(`/api/analytics/${id}/csv`, { method: 'POST', body: await e.target.files[0].text(), csv: true }); toast(`Imported ${r.posts} post rows and ${r.channel} follower rows`); route(); }
    catch (err) { toast(err.message, 6000); }
  };
}

// ---------------------------------------------------------------- insights & manager
async function pageInsights(view) {
  if (needChannel(view)) return;
  const id = oneChannel(view);
  const [r, ideas] = await Promise.all([api(`/api/insights/${id}`), api(`/api/ideas?channel=${id}`)]);
  const postRow = p => `<li><div style="flex:1">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}<div class="muted small">${PF[p.platform].name} · ${esc(p.posted_at.slice(0, 10))} · ${p.views7.toLocaleString()} views in 7 days · ${p.er}% engagement</div></div><span class="badge ${p.index >= 1 ? 'good' : 'bad'}">${p.index}× typical</span></li>`;
  view.insertAdjacentHTML('beforeend', `
    ${r.demo ? `<div class="demo-flag">This report is built on <b>sample data</b>.</div>` : ''}
    <div class="grid cols-2">
      <div class="card"><h2>Weekly report · ${esc(r.channel)}</h2>
        ${r.summary.map(s => `<p style="margin:4px 0">${esc(s)}</p>`).join('') || '<p class="muted">No numbers yet.</p>'}
        <p class="muted small">Based on ${r.sample} post(s) old enough to judge (3+ days). Generated ${fmtWhen(r.generatedAt)}.</p>
        <h3>What's working</h3>${r.working.map(w => `<div class="finding good">${esc(w.text)}</div>`).join('') || '<p class="muted small">Not enough data to call it yet: needs 4+ posts with numbers.</p>'}
        <h3>What's not working</h3>${r.notWorking.map(w => `<div class="finding bad">${esc(w.text)}</div>`).join('') || '<p class="muted small">Nothing stands out as underperforming.</p>'}
        <h3>What to do next</h3><ul class="list">${r.next.map(n => `<li><span class="prio ${n.priority}">${n.priority}</span><span>${esc(n.text)}</span></li>`).join('')}</ul>
      </div>
      <div class="card chat"><h2>Ask your social manager</h2>
        ${state.aiReady ? '' : `<div class="finding bad small">Add an Anthropic API key in <a href="#/settings">Settings</a> to chat. The report on the left works without it.</div>`}
        <div class="msgs" id="msgs">${chatLog.map(m => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('') || '<p class="muted small">I can see all your channels, numbers, plans and ideas. Ask me anything about growing them.</p>'}</div>
        <div class="chips">${['What should I post next week and when?', 'Why did my views drop this week?', 'Write 3 hooks for my next video', 'Plan a growth strategy for the next month'].map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <div class="row"><input type="text" id="ask" placeholder="Ask about your channels…" style="flex:1"><button class="btn primary" id="send">Send</button></div>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h2>Best posts (7-day views)</h2><ul class="list">${r.topPosts.map(postRow).join('') || '<li class="muted">No data yet</li>'}</ul>
        <h3>Weakest posts</h3><ul class="list">${r.bottomPosts.map(postRow).join('') || '<li class="muted">No data yet</li>'}</ul></div>
      <div class="card"><h2>Idea backlog</h2><p class="muted small">Tag ideas with topics, and the report ranks them by what's working.</p>
        <ul class="list">${ideas.map(i => `<li><div style="flex:1"><b>${esc(i.title)}</b> ${i.status !== 'idea' ? `<span class="badge">${i.status.replace('_', ' ')}</span>` : ''}<div class="muted small">${esc(i.notes)}${(i.tags || []).length ? ` · #${i.tags.join(' #')}` : ''}</div></div>
          <select data-idea="${i.id}" class="small">${['idea', 'in_production', 'done'].map(s => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>
          <button class="btn small danger" data-del-idea="${i.id}">✕</button></li>`).join('') || '<li class="muted">No ideas yet</li>'}</ul>
        <div class="form" style="margin-top:10px"><input type="text" id="it" placeholder="New idea title"><div class="row"><input type="text" id="itags" placeholder="topics: karna, emotional" style="flex:1"><button class="btn" id="addidea">Add idea</button></div></div>
      </div>
    </div>`);
  const send = async q => {
    q = (q || $('#ask').value).trim(); if (!q) return;
    chatLog.push({ role: 'user', content: q });
    $('#msgs').insertAdjacentHTML('beforeend', `<div class="msg user">${esc(q)}</div><div class="msg assistant muted" id="thinking">Thinking…</div>`);
    $('#ask').value = ''; $('#msgs').scrollTop = 1e9;
    try { const { reply } = await post('/api/manager/chat', { messages: chatLog.slice(-12) }); chatLog.push({ role: 'assistant', content: reply }); }
    catch (err) { chatLog.pop(); toast(err.message, 6000); }
    if (location.hash.startsWith('#/insights')) route();
  };
  $('#send').onclick = () => send();
  $('#ask').onkeydown = e => { if (e.key === 'Enter') send(); };
  view.onclick = async e => {
    const chip = e.target.closest('[data-q]'), d = e.target.closest('[data-del-idea]');
    if (chip) send(chip.dataset.q);
    if (d) { await del(`/api/ideas/${d.dataset.delIdea}`); route(); }
    if (e.target.id === 'addidea' && $('#it').value.trim()) {
      await post('/api/ideas', { channel_id: id, title: $('#it').value.trim(), tags: $('#itags').value.split(',').map(s => s.trim().replace(/^#/, '').toLowerCase()).filter(Boolean) });
      route();
    }
  };
  view.onchange = async e => {
    const s = e.target.closest('[data-idea]'); if (!s) return;
    const i = ideas.find(x => x.id === +s.dataset.idea);
    await put(`/api/ideas/${i.id}`, { ...i, status: s.value }); route();
  };
}

// ---------------------------------------------------------------- channels
async function pageChannels(view) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('connected')) toast(`Connected ${q.get('connected')}`);
  view.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="btn primary" data-act="new">Add channel</button></div>
    <div class="grid cols-2">${state.channels.map(c => `
      <div class="card"><h2><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}<span class="spacer"></span><button class="btn small" data-edit="${c.id}">Edit</button></h2>
        <p class="muted small" style="margin-top:-6px">${esc(c.niche)}</p>
        <div class="row small"><span><b>${c.counts.ready}</b> ready</span><span><b>${c.counts.drafts}</b> drafts</span><span><b>${c.counts.posted}</b> posted</span><span>Goal <b>${c.weekly_goal}</b>/week</span></div>
        <h3>Posting slots</h3><div class="row small">${(c.schedule || []).map(s => `<span class="badge ${s.platform}">${DAYS[s.day]} ${s.time}</span>`).join('') || '<span class="muted">None. Add slots so auto-plan knows when to post.</span>'}</div>
        <h3>Accounts</h3>
        ${['youtube', 'instagram'].map(pf => { const any = c.accounts.find(x => x.platform === pf), acc = any && any.status === 'connected' ? any : null;
          const name = any && any.handle ? (any.profile_url ? `<a href="${esc(any.profile_url)}" target="_blank" rel="noopener"><b>${esc(any.handle)}</b></a>` : `<b>${esc(any.handle)}</b>`) : '';
          const connectBtn = pf === 'youtube' ? `<a class="btn small" href="/oauth/youtube/start?channel=${c.id}">Connect YouTube</a>` : `<button class="btn small" data-ig="${c.id}">Connect Instagram</button>`;
          return `<div class="row" style="margin:6px 0">${pfBadge(pf)} ${acc ? `${name} <span class="badge good">connected</span>${acc.last_error ? ` <span class="badge bad" title="${esc(acc.last_error)}">error</span>` : ''}<span class="spacer"></span><button class="btn small" data-disconnect="${acc.id}">Disconnect</button>`
            : name ? `${name} <span class="badge warn" title="Linked by handle. Connect it to post automatically and sync stats.">not connected</span><span class="spacer"></span>${connectBtn}`
            : `<span class="muted small">No ${PF[pf].name} account</span><span class="spacer"></span>${connectBtn}`}</div>`; }).join('')}
      </div>`).join('') || '<div class="card empty">No channels yet. Add one for each brand you run.</div>'}</div>`;
  view.onclick = async e => {
    const t = e.target.closest('[data-act="new"],[data-edit],[data-ig],[data-disconnect]'); if (!t) return;
    if (t.dataset.disconnect) { if (confirm('Disconnect this account? Scheduled posts will wait for manual posting.')) { await del(`/api/accounts/${t.dataset.disconnect}`); await loadState(); route(); } return; }
    if (t.dataset.ig) return igModal(+t.dataset.ig);
    channelModal(state.channels.find(c => c.id === +t.dataset.edit));
  };
}

function channelModal(c) {
  const ch = c || { name: '', niche: '', color: '#2a78d6', video_dir: '', weekly_goal: 3, schedule: [] };
  let sched = [...(ch.schedule || [])];
  const rowsHtml = () => sched.map((s, i) => `<div class="sched-row">
      <select data-i="${i}" data-f="platform">${Object.keys(PF).map(p => `<option value="${p}" ${p === s.platform ? 'selected' : ''}>${PF[p].name}</option>`).join('')}</select>
      <select data-i="${i}" data-f="day">${DAYS.map((d, k) => `<option value="${k}" ${k === s.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <input type="time" data-i="${i}" data-f="time" value="${esc(s.time)}">
      <button class="btn small danger" data-rm="${i}">✕</button></div>`).join('');
  modal(`<h2>${c ? 'Edit channel' : 'New channel'}</h2>
    <div class="form">
      <label>Name <input type="text" id="n" value="${esc(ch.name)}" placeholder="e.g. Mahabharata Reels"></label>
      <label>What it's about <input type="text" id="ni" value="${esc(ch.niche)}" placeholder="Niche and audience: helps the AI manager"></label>
      <div class="row"><label>Color <input type="color" id="co" value="${esc(ch.color)}"></label><label>Posts per week (goal) <input type="number" id="g" min="0" value="${ch.weekly_goal}" style="width:90px"></label></div>
      <label>Video folder: finished videos land here <input type="text" id="dir" value="${esc(ch.video_dir)}" placeholder="/Users/you/Videos/channel/out"></label>
      <div><div class="muted small" style="margin-bottom:4px">Weekly posting slots</div><div id="sched">${rowsHtml()}</div>
        <button class="btn small" id="addslot" style="margin-top:6px">+ Add slot</button></div>
    </div>
    <div class="row" style="margin-top:16px">${c ? '<button class="btn danger" id="delch">Delete channel</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`, card => {
    const redraw = () => ($('#sched', card).innerHTML = rowsHtml());
    card.onchange = e => { const i = e.target.dataset.i; if (i == null) return; const f = e.target.dataset.f; sched[i][f] = f === 'day' ? +e.target.value : e.target.value; };
    card.onclick = async e => {
      if (e.target.dataset.rm != null) { sched.splice(+e.target.dataset.rm, 1); redraw(); }
      if (e.target.id === 'addslot') { sched.push({ platform: 'instagram', day: 1, time: '19:00' }); redraw(); }
      if (e.target.id === 'delch' && confirm(`Delete ${ch.name} and all its videos, plans and stats?`)) { await del(`/api/channels/${c.id}`); closeModal(); await loadState(); route(); }
      if (e.target.id === 'save') {
        const body = { name: $('#n', card).value.trim(), niche: $('#ni', card).value, color: $('#co', card).value, weekly_goal: +$('#g', card).value, video_dir: $('#dir', card).value.trim(), schedule: sched };
        try { if (c) await put(`/api/channels/${c.id}`, body); else await post('/api/channels', body); closeModal(); await loadState(); route(); } catch (err) { toast(err.message); }
      }
    };
  });
}

function igModal(channelId) {
  modal(`<h2>Connect Instagram</h2>
    <ol class="steps">
      <li>Switch the Instagram account to a <b>Professional</b> (Creator or Business) account.</li>
      <li>At <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a>, create an app and add the <b>Instagram</b> product (API setup with Instagram login).</li>
      <li>Add your Instagram account under <i>Generate access tokens</i>, then press <b>Generate token</b>. Copy the token and the account's ID.</li>
    </ol>
    <div class="form" style="margin-top:12px">
      <label>Access token <input type="password" id="tok" autocomplete="off"></label>
      <label>Instagram user ID (optional) <input type="text" id="uid"></label>
    </div>
    <p class="muted small">Auto-posting Reels also needs a public media URL (Settings), because Instagram downloads the video from the internet.</p>
    <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Connect</button></div>`, card => {
    $('#go', card).onclick = async () => {
      try { const r = await post(`/api/channels/${channelId}/instagram`, { token: $('#tok', card).value, user_id: $('#uid', card).value }); toast(`Connected @${r.handle}`); closeModal(); await loadState(); route(); }
      catch (err) { toast(err.message, 6000); }
    };
  });
}

// ---------------------------------------------------------------- settings
async function pageSettings(view) {
  const s = await api('/api/settings');
  const field = (k, label, type = 'text', ph = '') => `<label>${label}<input type="${type}" data-k="${k}" value="${esc(s[k])}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
  view.innerHTML = `<div class="grid cols-2">
    <div class="card"><h2>YouTube</h2>
      <ol class="steps"><li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>, create a project and enable <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>.</li>
        <li>Set up the OAuth consent screen (External) and add yourself as a test user.</li>
        <li>Create an OAuth client ID of type <b>Web application</b> with this redirect URI: <code>${esc(s.redirect_uri)}</code></li>
        <li>Paste the client ID and secret here, then press <b>Connect YouTube</b> on the Channels page.</li></ol>
      <div class="form" style="margin-top:12px">
        ${field('google_client_id', 'Client ID')}${field('google_client_secret', 'Client secret', 'password')}
        <label>New uploads are <select data-k="youtube_privacy">${['public', 'unlisted', 'private'].map(p => `<option ${(s.youtube_privacy || 'public') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      </div></div>
    <div class="card"><h2>Instagram</h2>
      <p class="small">Instagram fetches Reels from a public link, so auto-posting needs this app's media reachable from the internet. Run a tunnel such as <code>cloudflared tunnel --url http://localhost:4173</code> and paste the https address it gives you. Without it, Instagram posts wait as "Post manually" with the caption ready to copy.</p>
      <div class="form">${field('public_media_url', 'Public media URL', 'text', 'https://your-tunnel.trycloudflare.com')}
        ${field('instagram_graph_host', 'Graph API host', 'text', 'graph.instagram.com')}${field('instagram_api_version', 'Graph API version', 'text', 'v23.0')}</div></div>
    <div class="card"><h2>AI social manager</h2>
      <p class="small">The chat on the Insights page uses Claude. Create a key at <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>. The weekly report works without it.</p>
      <div class="form">${field('anthropic_api_key', 'Anthropic API key', 'password', 'sk-ant-…')}</div></div>
  </div>
  <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn primary" id="save">Save settings</button></div>`;
  $('#save').onclick = async () => {
    const body = {}; view.querySelectorAll('[data-k]').forEach(i => (body[i.dataset.k] = i.value));
    await put('/api/settings', body); await loadState(); toast('Settings saved');
  };
}

// ---------------------------------------------------------------- router
const PAGES = { '': ['dashboard', 'Dashboard', pageDashboard], planner: ['planner', 'Weekly planner', pagePlanner], library: ['library', 'Video library', pageLibrary],
  analytics: ['analytics', 'Analytics', pageAnalytics], insights: ['insights', 'Insights & manager', pageInsights], channels: ['channels', 'Channels & accounts', pageChannels], settings: ['settings', 'Settings', pageSettings] };
async function route() {
  const key = (location.hash.replace(/^#\/?/, '').split('?')[0]) || '';
  const [id, title, fn] = PAGES[key] || PAGES[''];
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('active', a.dataset.page === id));
  $('#page-title').textContent = title;
  $('.channel-pick').style.visibility = ['channels', 'settings'].includes(id) ? 'hidden' : 'visible';
  closeModal();
  const view = $('#view'); view.onclick = view.onchange = view.ondrop = view.ondragover = view.ondragstart = view.ondragleave = null;
  view.innerHTML = '<div class="empty">Loading…</div>';
  try { view.innerHTML = ''; await fn(view); } catch (e) { view.innerHTML = `<div class="card finding bad">${esc(e.message)}</div>`; }
}
$('#channel-filter').onchange = e => { localStorage.setItem('channel', e.target.value); route(); };
window.addEventListener('hashchange', route);

// theme switch: System follows the Mac's setting; Light/Dark override it and are remembered
function setTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', t); } catch (e) {}
  document.querySelectorAll('[data-theme-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePick === t)));
}
document.querySelectorAll('[data-theme-pick]').forEach(b => (b.onclick = () => { setTheme(b.dataset.themePick); if (/analytics/.test(location.hash)) route(); }));
setTheme((() => { try { return localStorage.getItem('theme') || 'system'; } catch (e) { return 'system'; } })());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeNav(); }
});

function openNav() {
  document.body.classList.add('nav-open');
  $('#menu-btn')?.setAttribute('aria-expanded', 'true');
  $('#nav-backdrop').hidden = false;
}
function closeNav() {
  document.body.classList.remove('nav-open');
  $('#menu-btn')?.setAttribute('aria-expanded', 'false');
  $('#nav-backdrop').hidden = true;
}
$('#menu-btn')?.addEventListener('click', () => document.body.classList.contains('nav-open') ? closeNav() : openNav());
$('#nav-backdrop')?.addEventListener('click', closeNav);
document.querySelectorAll('.side a').forEach(a => a.addEventListener('click', closeNav));
window.addEventListener('hashchange', closeNav);
window.addEventListener('resize', () => { if (window.innerWidth > 900) closeNav(); });

loadState().then(route);
