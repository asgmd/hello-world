import * as db from './db.js';
import * as places from './places.js';
import {
  todayLocal, formatDate, escapeHtml as h, uid, formatDistance, summarize,
} from './util.js';

const view = document.getElementById('view');
let pendingPlace = null; // a looked-up restaurant not saved until its first visit is logged
let lastPosition = null;

// ---------- small helpers ----------

let objectUrls = [];
function blobUrl(blob) {
  const u = URL.createObjectURL(blob);
  objectUrls.push(u);
  return u;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2500);
}

const stars = (n) => {
  const full = Math.round(n ?? 0);
  return `<span class="stars" aria-label="${n == null ? 'not rated' : `${(+n).toFixed(1)} out of 5`}">${'★'.repeat(full)}<span class="dim">${'★'.repeat(5 - full)}</span></span>`;
};

const meta = (p) => [p.cuisine || p.kind, p.address].filter(Boolean).map(h).join(' · ');

function placeHeader(p) {
  const links = [];
  if (p.lat != null) {
    links.push(`<a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">Map</a>`);
  }
  if (p.website) links.push(`<a href="${h(/^https?:/i.test(p.website) ? p.website : `https://${p.website}`)}" target="_blank" rel="noopener">Website</a>`);
  if (p.phone) links.push(`<a href="tel:${h(p.phone.replace(/[^\d+]/g, ''))}">Call</a>`);
  return `
    <section class="card place-head">
      <h2>${h(p.name)}</h2>
      <p class="muted">${meta(p) || 'No address saved'}</p>
      ${links.length ? `<p class="links">${links.join('')}</p>` : ''}
    </section>`;
}

function openLightbox(src) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${src}" alt="Photo">`;
  box.onclick = () => box.remove();
  document.body.append(box);
}

// Downscale photos so dozens of visits don't fill up the phone.
async function shrinkImage(file, max = 1600) {
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file; // unsupported format for canvas — keep the original
  }
}

// ---------- routing ----------

const routes = [
  [/^#\/places$/, renderPlaces],
  [/^#\/place\/(.+)$/, (m) => renderPlace(decodeURIComponent(m[1]))],
  [/^#\/log$/, renderPicker],
  [/^#\/log\/(.+)$/, (m) => renderVisitForm({ restaurantId: decodeURIComponent(m[1]) })],
  [/^#\/visit\/(.+)$/, (m) => renderVisitForm({ visitId: decodeURIComponent(m[1]) })],
  [/^#\/visits$/, renderVisits],
  [/^#\/settings$/, renderSettings],
];

async function router() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  const hash = location.hash || '#/places';
  const tab = hash.split('/')[1];
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const t = a.dataset.tab;
    a.classList.toggle('active', t === tab || (t === 'places' && tab === 'place') || (t === 'log' && tab === 'visit'));
  });
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    try {
      await fn(m);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<section class="card"><p class="error">${h(e.message)}</p></section>`;
    }
    window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/places';
}

const go = (hash) => { location.hash = hash; };
const placeHash = (id) => `#/place/${encodeURIComponent(id)}`;
const logHash = (id) => `#/log/${encodeURIComponent(id)}`;

// ---------- Places (home) ----------

async function renderPlaces() {
  const all = summarize(await db.getAll('restaurants'), await db.getAll('visits'));
  if (!all.length) {
    view.innerHTML = `
      <section class="empty">
        <div class="big">🍽️</div>
        <h2>No restaurants yet</h2>
        <p class="muted">Log your first family meal out — today's, or one from the past.</p>
        <a class="btn primary" href="#/log">+ Log a visit</a>
      </section>`;
    return;
  }
  view.innerHTML = `
    <div class="toolbar">
      <input id="filter" type="search" placeholder="Filter ${all.length} places…" aria-label="Filter places">
      <select id="sort" aria-label="Sort">
        <option value="recent">Recent</option>
        <option value="rating">Top rated</option>
        <option value="visits">Most visited</option>
        <option value="name">A–Z</option>
      </select>
    </div>
    <ul class="list" id="list"></ul>`;
  const sorters = {
    recent: (a, b) => (b.lastVisit ?? '').localeCompare(a.lastVisit ?? ''),
    rating: (a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0) || b.visitCount - a.visitCount,
    visits: (a, b) => b.visitCount - a.visitCount,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const filter = view.querySelector('#filter');
  const sort = view.querySelector('#sort');
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = all
      .filter((p) => !q || `${p.name} ${p.cuisine} ${p.address}`.toLowerCase().includes(q))
      .sort(sorters[sort.value]);
    view.querySelector('#list').innerHTML = rows.map((p) => `
      <li><a class="item" href="${placeHash(p.id)}">
        ${p.coverPhoto ? `<img class="thumb" src="${blobUrl(p.coverPhoto)}" alt="">` : '<div class="thumb ph">🍴</div>'}
        <div class="grow">
          <div class="title">${h(p.name)}</div>
          <div class="muted small">${meta(p)}</div>
          <div class="small">${stars(p.avgRating)} ${p.avgRating ? p.avgRating.toFixed(1) : ''}
            <span class="muted">· ${p.visitCount} visit${p.visitCount === 1 ? '' : 's'}${p.lastVisit ? ` · last ${formatDate(p.lastVisit)}` : ''}</span></div>
        </div>
      </a></li>`).join('') || '<li class="muted pad">No matches.</li>';
  };
  filter.oninput = draw;
  sort.onchange = draw;
  draw();
}

// ---------- Place detail ----------

async function renderPlace(id) {
  const p = await db.get('restaurants', id);
  if (!p) return go('#/places');
  const visits = (await db.visitsFor(id)).sort((a, b) => b.date.localeCompare(a.date));
  const [s] = summarize([p], visits);
  view.innerHTML = `
    ${placeHeader(p)}
    <section class="card stats">
      <div><div class="num">${s.avgRating ? s.avgRating.toFixed(1) : '–'}</div><div class="muted small">avg rating</div></div>
      <div><div class="num">${s.visitCount}</div><div class="muted small">visits</div></div>
      <div><div class="num small-num">${s.lastVisit ? formatDate(s.lastVisit) : '–'}</div><div class="muted small">last visit</div></div>
    </section>
    <a class="btn primary block" href="${logHash(id)}">+ Log a visit here</a>
    <h3>Visits</h3>
    <ul class="list">${visits.map(visitItem).join('') || '<li class="muted pad">No visits yet.</li>'}</ul>
    <details class="card">
      <summary>Edit restaurant details</summary>
      <form id="editPlace" class="stack">
        <label>Name <input name="name" required value="${h(p.name)}"></label>
        <label>Cuisine <input name="cuisine" value="${h(p.cuisine)}"></label>
        <label>Address <input name="address" value="${h(p.address)}"></label>
        <button class="btn">Save details</button>
      </form>
      <button id="delPlace" class="btn danger block">Delete restaurant and all its visits</button>
    </details>`;
  wirePhotos();
  view.querySelector('#editPlace').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await db.put('restaurants', {
      ...p, name: f.get('name').trim() || p.name, cuisine: f.get('cuisine').trim(), address: f.get('address').trim(), updatedAt: new Date().toISOString(),
    });
    toast('Saved');
    router();
  };
  view.querySelector('#delPlace').onclick = async () => {
    if (!confirm(`Delete ${p.name} and its ${visits.length} visit(s)? This cannot be undone.`)) return;
    await db.deleteRestaurant(id);
    toast('Deleted');
    go('#/places');
  };
}

function visitItem(v, placeName) {
  return `
    <li class="visit card">
      <div class="row between">
        <div>
          ${typeof placeName === 'string' ? `<a class="title" href="${placeHash(v.restaurantId)}">${h(placeName)}</a><br>` : ''}
          <strong>${formatDate(v.date, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</strong>
          ${v.who?.length ? `<span class="muted small"> · ${v.who.map(h).join(', ')}</span>` : ''}
        </div>
        <a class="small" href="#/visit/${encodeURIComponent(v.id)}">Edit</a>
      </div>
      <div>${stars(v.rating)}</div>
      ${v.notes ? `<p class="notes">${h(v.notes)}</p>` : ''}
      ${v.photos?.length ? `<div class="photos">${v.photos.map((b) => `<img src="${blobUrl(b)}" alt="Visit photo" data-zoom>`).join('')}</div>` : ''}
    </li>`;
}

function wirePhotos() {
  view.querySelectorAll('img[data-zoom]').forEach((img) => { img.onclick = () => openLightbox(img.src); });
}

// ---------- History ----------

async function renderVisits() {
  const restaurants = new Map((await db.getAll('restaurants')).map((r) => [r.id, r]));
  const visits = (await db.getAll('visits')).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  if (!visits.length) {
    view.innerHTML = '<section class="empty"><div class="big">📅</div><h2>No visits yet</h2><a class="btn primary" href="#/log">+ Log a visit</a></section>';
    return;
  }
  const people = [...new Set(visits.flatMap((v) => v.who ?? []))].sort();
  const years = [...new Set(visits.map((v) => v.date.slice(0, 4)))];
  view.innerHTML = `
    <div class="toolbar">
      <select id="year" aria-label="Year"><option value="">All years</option>${years.map((y) => `<option>${y}</option>`).join('')}</select>
      ${people.length ? `<select id="who" aria-label="Family member"><option value="">Everyone</option>${people.map((p) => `<option>${h(p)}</option>`).join('')}</select>` : ''}
    </div>
    <div id="timeline"></div>`;
  const draw = () => {
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
    const year = view.querySelector('#year').value;
    const who = view.querySelector('#who')?.value;
    const rows = visits.filter((v) => (!year || v.date.startsWith(year)) && (!who || v.who?.includes(who)));
    let html = '';
    let month = '';
    for (const v of rows) {
      const m = v.date.slice(0, 7);
      if (m !== month) {
        if (month) html += '</ul>';
        month = m;
        html += `<h3>${formatDate(`${m}-01`, { year: 'numeric', month: 'long' })}</h3><ul class="list">`;
      }
      html += visitItem(v, restaurants.get(v.restaurantId)?.name ?? 'Unknown restaurant');
    }
    view.querySelector('#timeline').innerHTML = (html ? `${html}</ul>` : '<p class="muted pad">No visits match.</p>');
    wirePhotos();
  };
  view.querySelector('#year').onchange = draw;
  if (people.length) view.querySelector('#who').onchange = draw;
  draw();
}

// ---------- Log: choose a restaurant ----------

async function renderPicker() {
  const saved = summarize(await db.getAll('restaurants'), await db.getAll('visits'))
    .sort((a, b) => (b.lastVisit ?? '').localeCompare(a.lastVisit ?? ''));
  view.innerHTML = `
    <section class="card stack">
      <h2>Where did you eat?</h2>
      <button id="near" class="btn primary block">📍 Find restaurants near me</button>
      <form id="searchForm" class="row">
        <input id="q" type="search" class="grow" placeholder="Search by name, e.g. Joe's Pizza Boston" aria-label="Search restaurants" required>
        <button class="btn">Search</button>
      </form>
      <button id="manualBtn" class="btn ghost block">✏️ Enter one manually</button>
      <form id="manual" class="stack" hidden>
        <label>Restaurant name <input name="name" required></label>
        <label>Cuisine <input name="cuisine" placeholder="e.g. Thai"></label>
        <label>Address / city <input name="address"></label>
        <button class="btn primary">Next</button>
      </form>
    </section>
    <div id="results"></div>
    ${saved.length ? `
      <h3>Or pick one of your places</h3>
      <ul class="list">${saved.map((p) => `
        <li><a class="item" href="${logHash(p.id)}"><div class="grow">
          <div class="title">${h(p.name)}</div>
          <div class="muted small">${meta(p)}</div>
        </div><span class="small">${stars(p.avgRating)}</span></a></li>`).join('')}
      </ul>` : ''}`;

  const results = view.querySelector('#results');
  let candidates = [];
  const showResults = (title, list) => {
    candidates = list;
    results.innerHTML = list.length ? `
      <h3>${h(title)}</h3>
      <ul class="list">${list.map((c, i) => `
        <li><button class="item" data-i="${i}"><div class="grow">
          <div class="title">${h(c.name)}${saved.some((s) => s.id === c.id) ? ' <span class="badge">saved</span>' : ''}</div>
          <div class="muted small">${meta(c)}</div>
        </div>${c.distance != null ? `<span class="muted small">${formatDistance(c.distance)}</span>` : ''}</button></li>`).join('')}
      </ul>` : '<section class="card muted">Nothing found. Try a different search, or enter it manually.</section>';
  };
  results.onclick = (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const c = candidates[+btn.dataset.i];
    if (saved.some((s) => s.id === c.id)) return go(logHash(c.id));
    pendingPlace = c;
    go('#/log/new');
  };

  const busy = (msg) => { results.innerHTML = `<section class="card muted"><span class="spinner"></span> ${h(msg)}</section>`; };
  const fail = (e) => { results.innerHTML = `<section class="card error">${h(e.message)}</section>`; };

  view.querySelector('#near').onclick = async () => {
    try {
      busy('Finding your location…');
      lastPosition = await places.getPosition();
      busy('Looking up restaurants nearby…');
      let list = await places.nearby(lastPosition);
      if (!list.length) list = await places.nearby(lastPosition, 3000);
      showResults('Nearby', list);
    } catch (e) { fail(e); }
  };

  view.querySelector('#searchForm').onsubmit = async (e) => {
    e.preventDefault();
    const q = view.querySelector('#q').value.trim();
    if (!q) return;
    try {
      busy('Searching…');
      showResults(`Results for “${q}”`, await places.search(q, lastPosition));
    } catch (err) { fail(err); }
  };

  const manual = view.querySelector('#manual');
  view.querySelector('#manualBtn').onclick = () => {
    manual.hidden = !manual.hidden;
    if (!manual.hidden) manual.querySelector('input').focus();
  };
  manual.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(manual);
    pendingPlace = {
      id: `manual:${uid()}`, source: 'manual', name: f.get('name').trim(), cuisine: f.get('cuisine').trim(), address: f.get('address').trim(),
    };
    go('#/log/new');
  };
}

// ---------- Log / edit a visit ----------

async function renderVisitForm({ restaurantId, visitId }) {
  let visit = null;
  let place;
  if (visitId) {
    visit = await db.get('visits', visitId);
    if (!visit) return go('#/visits');
    place = await db.get('restaurants', visit.restaurantId);
  } else if (restaurantId === 'new') {
    place = pendingPlace;
  } else {
    place = await db.get('restaurants', restaurantId);
  }
  if (!place) return go('#/log');

  const settings = await db.getSettings();
  const today = todayLocal();
  const photos = [...(visit?.photos ?? [])];
  let rating = visit?.rating ?? 0;
  const who = new Set(visit?.who ?? []);

  view.innerHTML = `
    ${placeHeader(place)}
    <form id="visitForm" class="card stack" novalidate>
      <label>Date of visit
        <input type="date" name="date" value="${h(visit?.date ?? today)}" max="${today}" required>
        <span class="hint">Defaults to today — pick an earlier date to log a past visit.</span>
      </label>
      <div>
        <div class="label">Rating</div>
        <div class="rate" role="radiogroup" aria-label="Rating">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-r="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
        </div>
      </div>
      <div>
        <div class="label">Who went?</div>
        <div class="chips" id="chips"></div>
        <div class="row">
          <input id="newWho" class="grow" placeholder="Add a family member" aria-label="Add a family member">
          <button type="button" id="addWho" class="btn">Add</button>
        </div>
      </div>
      <label>Notes
        <textarea name="notes" rows="3" placeholder="What did you order? Anything to remember?">${h(visit?.notes ?? '')}</textarea>
      </label>
      <div>
        <div class="label">Photos</div>
        <div class="photos edit" id="photoGrid"></div>
        <label class="btn ghost block file">📷 Add photos
          <input type="file" id="photoInput" accept="image/*" multiple hidden>
        </label>
      </div>
      <p class="error" id="formError" hidden></p>
      <button class="btn primary block" id="saveBtn">${visit ? 'Save changes' : 'Save visit'}</button>
      ${visit ? '<button type="button" id="delVisit" class="btn danger block">Delete this visit</button>' : ''}
    </form>`;

  const form = view.querySelector('#visitForm');
  const err = view.querySelector('#formError');

  const drawRating = () => view.querySelectorAll('.rate button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.r <= rating);
    b.setAttribute('aria-checked', String(+b.dataset.r === rating));
  });
  view.querySelector('.rate').onclick = (e) => {
    const b = e.target.closest('[data-r]');
    if (b) { rating = +b.dataset.r; drawRating(); }
  };
  drawRating();

  const family = [...new Set([...settings.family, ...who])];
  const drawChips = () => {
    view.querySelector('#chips').innerHTML = family.map((n) => `<button type="button" class="chip ${who.has(n) ? 'on' : ''}" data-n="${h(n)}">${h(n)}</button>`).join('')
      || '<span class="muted small">Add family members once and tap to pick them next time.</span>';
  };
  view.querySelector('#chips').onclick = (e) => {
    const c = e.target.closest('[data-n]');
    if (!c) return;
    const n = c.dataset.n;
    if (who.has(n)) who.delete(n); else who.add(n);
    drawChips();
  };
  const addWho = async () => {
    const input = view.querySelector('#newWho');
    const n = input.value.trim();
    if (!n) return;
    if (!family.includes(n)) family.push(n);
    who.add(n);
    input.value = '';
    await db.saveSettings({ ...settings, family: [...new Set([...settings.family, n])] });
    settings.family = [...new Set([...settings.family, n])];
    drawChips();
  };
  view.querySelector('#addWho').onclick = addWho;
  view.querySelector('#newWho').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addWho(); } };
  drawChips();

  const grid = view.querySelector('#photoGrid');
  const drawPhotos = () => {
    grid.innerHTML = photos.map((b, i) => `<div class="ph-wrap"><img src="${blobUrl(b)}" alt="Photo ${i + 1}"><button type="button" class="x" data-del="${i}" aria-label="Remove photo">×</button></div>`).join('');
  };
  grid.onclick = (e) => {
    const x = e.target.closest('[data-del]');
    if (x) { photos.splice(+x.dataset.del, 1); drawPhotos(); }
  };
  view.querySelector('#photoInput').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const save = view.querySelector('#saveBtn');
    save.disabled = true;
    save.textContent = 'Processing photos…';
    for (const f of files) photos.push(await shrinkImage(f));
    save.disabled = false;
    save.textContent = visit ? 'Save changes' : 'Save visit';
    drawPhotos();
  };
  drawPhotos();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const now = new Date().toISOString();
    const record = {
      id: visit?.id ?? uid(),
      restaurantId: place.id,
      date: f.get('date'),
      rating,
      who: [...who],
      notes: f.get('notes').trim(),
      photos,
      createdAt: visit?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      db.checkVisit(record);
      if (restaurantId === 'new') {
        await db.put('restaurants', { ...place, distance: undefined, createdAt: now, updatedAt: now });
        pendingPlace = null;
      }
      await db.saveVisit(record);
      toast(visit ? 'Visit updated' : 'Visit saved');
      go(placeHash(place.id));
    } catch (ex) {
      err.textContent = rating ? ex.message : 'Tap the stars to give a rating (1–5).';
      err.hidden = false;
    }
  };

  view.querySelector('#delVisit')?.addEventListener('click', async () => {
    if (!confirm('Delete this visit?')) return;
    await db.del('visits', visit.id);
    toast('Visit deleted');
    go(placeHash(place.id));
  });
}

// ---------- Settings ----------

async function renderSettings() {
  const settings = await db.getSettings();
  const [rCount, vCount] = [(await db.getAll('restaurants')).length, (await db.getAll('visits')).length];
  view.innerHTML = `
    <section class="card stack">
      <h2>Family members</h2>
      <div class="chips">${settings.family.map((n, i) => `<span class="chip on">${h(n)} <button class="x-inline" data-i="${i}" aria-label="Remove ${h(n)}">×</button></span>`).join('') || '<span class="muted small">None yet.</span>'}</div>
      <form id="addFam" class="row"><input name="n" class="grow" placeholder="Name" required><button class="btn">Add</button></form>
    </section>
    <section class="card stack">
      <h2>Backup &amp; share</h2>
      <p class="muted small">Your ${rCount} restaurants and ${vCount} visits are stored on this device only.
        Export a backup file to keep it safe, or send it to another family member and have them import it — imports merge, they don't erase anything.</p>
      <button id="export" class="btn primary block">⬇️ Export backup</button>
      <label class="btn ghost block file">⬆️ Import backup<input type="file" id="import" accept="application/json,.json" hidden></label>
    </section>
    <p class="muted small center">Restaurant data © OpenStreetMap contributors.</p>`;

  view.querySelector('.chips').onclick = async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    settings.family.splice(+b.dataset.i, 1);
    await db.saveSettings(settings);
    router();
  };
  view.querySelector('#addFam').onsubmit = async (e) => {
    e.preventDefault();
    const n = new FormData(e.target).get('n').trim();
    if (n && !settings.family.includes(n)) settings.family.push(n);
    await db.saveSettings(settings);
    router();
  };
  view.querySelector('#export').onclick = async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `family-eats-${todayLocal()}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Family Eats backup' }); return; } catch { /* fall back to download */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  view.querySelector('#import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { added, skipped } = await db.importAll(JSON.parse(await file.text()));
      toast(`Imported ${added} visit${added === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`);
      router();
    } catch (ex) {
      toast(ex.message);
    }
  };
}

// ---------- boot ----------

window.addEventListener('hashchange', router);
router();
navigator.storage?.persist?.(); // ask the browser not to evict our data
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}
