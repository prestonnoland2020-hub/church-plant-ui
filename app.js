'use strict';

/* ---------- Config ---------- */
const SUPABASE_URL = 'https://goelbybscatczovtjtnw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_w_lfSdz46qk8k5cFaRdW4A_O6qzGqFi';
const MIN_YEAR = 2015;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COORD_MSG = 'Paste coordinates like 30.947157, 72.758333';

const LS = {
  team: 'fr_team',
  opts: 'fr_opts',
  draft: 'fr_draft',
  queue: 'fr_queue',
  failed: 'fr_failed',
  sent: 'fr_sent',
  name: 'fr_name',
};

const sb = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

/* ---------- Small helpers ---------- */
const $ = (id) => document.getElementById(id);

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}
function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage full or blocked */ }
}

function newClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

/* Calls an RPC. Returns {data} on success, {error} for a server answer
   (validation, wrong team code), or {netErr:true} when the server could not be reached. */
async function rpc(fn, args, ms = 20000) {
  if (!sb) return { netErr: true };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const { data, error } = await sb.rpc(fn, args).abortSignal(ctl.signal);
    if (error) {
      const code = error.code || '';
      if (/^[0-9A-Z]{5}$/.test(code) || /^PGRST/.test(code)) return { error };
      return { netErr: true, error };
    }
    return { data };
  } catch (e) {
    return { netErr: true };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Time (corrected with server clock) ---------- */
function nowYM() {
  const opts = load(LS.opts, null);
  const offset = opts && opts.offset ? opts.offset : 0;
  const d = new Date(Date.now() + offset);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/* ---------- Coordinates ---------- */
function decimals(s) {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function parseCoords(raw) {
  const s = raw.trim();
  if (!s) return { err: 'Enter the coordinates' };
  let latS, lngS;

  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch (e) { return { err: COORD_MSG }; }
    const host = u.hostname.toLowerCase();
    const isGoogle = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
    if (!isGoogle) return { err: COORD_MSG };
    let path;
    try { path = decodeURIComponent(u.pathname); } catch (e) { path = u.pathname; }
    const at = path.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:,|$)/);
    const q = (u.searchParams.get('q') || '').trim().match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    const m = q || at;
    if (!m) return { err: COORD_MSG };
    latS = m[1]; lngS = m[2];
  } else {
    const m = s.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    if (!m) return { err: COORD_MSG };
    latS = m[1]; lngS = m[2];
  }

  if (decimals(latS) < 4 || decimals(lngS) < 4) {
    return { err: 'Use at least 4 decimal places, like 30.947157, 72.758333' };
  }
  const lat = Number(latS), lng = Number(lngS);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) return { err: COORD_MSG };
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inGeometry(geom, lng, lat) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (!poly.length || !inRing(lng, lat, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(lng, lat, poly[h])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

function countryAt(lat, lng) {
  const opts = load(LS.opts, null);
  if (!opts) return null;
  return opts.countries.find((c) => inGeometry(c.border, lng, lat)) || null;
}

/* ---------- Form state ---------- */
let state;

function blankState() {
  return {
    clientId: newClientId(),
    coordsRaw: '',
    lat: null,
    lng: null,
    countryCode: null,
    regionId: '',
    type: '',
    village: '',
    leaderId: '',
    newLeader: false,
    nlName: '',
    nlPhone: '',
    month: '',
    year: '',
    attendees: '',
    notes: '',
    dupAck: false,
  };
}

let dup = { status: 'idle', list: [], key: '' }; // idle | checking | found | none | skipped

function currentCountry() {
  const opts = load(LS.opts, null);
  if (!opts || !state.countryCode) return null;
  return opts.countries.find((c) => c.code === state.countryCode) || null;
}

function saveDraft() {
  save(LS.draft, state);
}

/* ---------- Field errors ---------- */
function setErr(field, msg) {
  const f = $('f_' + field);
  const e = $('e_' + field);
  if (!f || !e) return;
  e.textContent = msg || '';
  f.classList.toggle('invalid', !!msg);
}
function clearErrs() {
  for (const f of document.querySelectorAll('#mainForm .field')) f.classList.remove('invalid');
  $('formError').hidden = true;
}

/* ---------- Coordinates field ---------- */
function onCoordsChanged(fromRestore) {
  const raw = $('coords').value;
  state.coordsRaw = raw;
  const r = parseCoords(raw);
  const mapLink = $('mapLink');

  if (r.err) {
    state.lat = state.lng = null;
    mapLink.hidden = true;
    if (raw.trim()) setErr('coords', r.err); else setErr('coords', '');
    applyCountry(null, fromRestore);
    resetDup();
    saveDraft();
    return;
  }

  setErr('coords', '');
  state.lat = r.lat;
  state.lng = r.lng;
  mapLink.href = `https://www.google.com/maps?q=${r.lat},${r.lng}`;
  mapLink.textContent = 'Check on Google Maps ↗';
  mapLink.hidden = false;

  const c = countryAt(r.lat, r.lng);
  if (!c) {
    setErr('country', 'These coordinates are not in a country we serve.');
    applyCountry(null, fromRestore);
    resetDup();
  } else {
    setErr('country', '');
    applyCountry(c, fromRestore);
    checkNearby();
  }
  saveDraft();
}

function applyCountry(c, keepSelections) {
  const prev = state.countryCode;
  state.countryCode = c ? c.code : null;
  $('country').value = c ? c.name : '';
  if (!keepSelections && prev !== state.countryCode) {
    state.regionId = '';
    state.leaderId = '';
    state.newLeader = false;
    state.nlName = '';
    state.nlPhone = '';
  }
  renderRegions();
  renderLeader();
}

function renderRegions() {
  const c = currentCountry();
  const sel = $('region');
  $('regionLabel').textContent = c ? c.region_label : 'State / Province';
  sel.innerHTML = '';
  if (!c) {
    sel.add(new Option('Enter coordinates first', ''));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.add(new Option(`Choose ${c.region_label.toLowerCase()}`, ''));
  for (const r of c.regions) sel.add(new Option(r.name, String(r.id)));
  if (!c.regions.some((r) => String(r.id) === String(state.regionId))) state.regionId = '';
  sel.value = String(state.regionId);
}

/* ---------- Duplicate check ---------- */
function resetDup() {
  dup = { status: 'idle', list: [], key: '' };
  state.dupAck = false;
  renderDup();
}

async function checkNearby() {
  const key = `${state.lat},${state.lng}`;
  if (dup.key === key && dup.status !== 'skipped') return;
  const team = load(LS.team, null);
  dup = { status: 'checking', list: [], key };
  state.dupAck = false;
  renderDup();
  if (!navigator.onLine) {
    dup.status = 'skipped';
    renderDup();
    return;
  }
  await new Promise((r) => setTimeout(r, 400)); // wait for typing to settle
  if (dup.key !== key) return;
  const res = await rpc('nearby_groups', { p_team_code: team, p_lat: state.lat, p_lng: state.lng }, 12000);
  if (dup.key !== key) return; // coordinates changed while waiting
  if (res.data) {
    dup.list = res.data;
    dup.status = res.data.length ? 'found' : 'none';
  } else {
    dup.status = 'skipped';
  }
  renderDup();
}

function renderDup() {
  const box = $('dupBox');
  if (dup.status === 'idle' || dup.status === 'none') {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  if (dup.status === 'checking') {
    box.className = 'notice info';
    box.textContent = 'Checking for records nearby…';
    return;
  }
  if (dup.status === 'skipped') {
    box.className = 'notice warn';
    box.textContent = "Couldn't check for records nearby (no connection). You can still continue.";
    return;
  }
  box.className = 'notice warn';
  box.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = 'Already logged nearby:';
  box.appendChild(title);
  const ul = document.createElement('ul');
  for (const g of dup.list) {
    const li = document.createElement('li');
    li.textContent = `${g.village_name} (${g.code}), ${Math.round(g.dist_m)} m`;
    ul.appendChild(li);
  }
  box.appendChild(ul);
  const lab = document.createElement('label');
  lab.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.dupAck;
  cb.addEventListener('change', () => {
    state.dupAck = cb.checked;
    if (cb.checked) setErr('coords', '');
    saveDraft();
  });
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode('This is a different group'));
  box.appendChild(lab);
}

/* ---------- Leader picker ---------- */
function renderLeader() {
  const c = currentCountry();
  const search = $('leaderSearch');
  const list = $('leaderList');
  const picked = $('leaderPicked');
  const wrap = $('leaderSearchWrap');
  const nl = $('newLeader');

  if (!c) {
    picked.hidden = true;
    nl.hidden = true;
    wrap.hidden = false;
    search.disabled = true;
    search.value = '';
    search.placeholder = 'Enter coordinates first';
    list.hidden = true;
    return;
  }

  const leader = state.leaderId ? c.leaders.find((l) => l.id === state.leaderId) : null;
  if (state.leaderId && !leader) state.leaderId = '';

  $('nlCc').textContent = c.phone_cc;
  $('nlPhone').placeholder = c.phone_example;

  if (leader || state.newLeader) {
    picked.hidden = false;
    $('leaderPickedText').textContent = leader ? `${leader.name} ••${leader.phone_tail}` : '+ New leader';
    wrap.hidden = true;
    nl.hidden = !state.newLeader;
    $('nlName').value = state.nlName;
    $('nlPhone').value = state.nlPhone;
    return;
  }

  picked.hidden = true;
  nl.hidden = true;
  wrap.hidden = false;
  search.disabled = false;
  search.placeholder = 'Search by name or last 4 digits';
  renderLeaderList();
}

function renderLeaderList() {
  const c = currentCountry();
  const list = $('leaderList');
  if (!c) return;
  const q = $('leaderSearch').value.trim().toLowerCase();
  const matches = q
    ? c.leaders.filter((l) => l.name.toLowerCase().includes(q) || String(l.phone_tail).includes(q))
    : c.leaders;
  const LIMIT = 50;
  list.innerHTML = '';
  for (const l of matches.slice(0, LIMIT)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const n = document.createElement('span');
    n.textContent = l.name;
    const t = document.createElement('span');
    t.className = 'tail';
    t.textContent = `••${l.phone_tail}`;
    b.append(n, t);
    b.addEventListener('click', () => pickLeader(l.id));
    li.appendChild(b);
    list.appendChild(li);
  }
  if (matches.length > LIMIT) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = `${matches.length - LIMIT} more — type to narrow the list`;
    list.appendChild(li);
  } else if (!matches.length) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = 'No leader matches that search';
    list.appendChild(li);
  }
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'new';
  b.textContent = '+ New leader';
  b.addEventListener('click', () => pickLeader(null));
  li.appendChild(b);
  list.appendChild(li);
  list.hidden = false;
}

function pickLeader(id) {
  state.leaderId = id || '';
  state.newLeader = !id;
  if (id) { state.nlName = ''; state.nlPhone = ''; }
  $('leaderSearch').value = '';
  setErr('leader', '');
  renderLeader();
  if (!id) $('nlName').focus();
  saveDraft();
}

function cleanPhone(v, cc) {
  let s = v.trim();
  if (cc && s.startsWith(cc)) s = s.slice(cc.length);
  s = s.replace(/\D/g, '');
  return s.replace(/^0+/, '');
}

/* ---------- Month / year ---------- */
function renderDate() {
  const { y, m } = nowYM();
  const ySel = $('year');
  const mSel = $('month');
  ySel.innerHTML = '';
  ySel.add(new Option('Year', ''));
  for (let yr = y; yr >= MIN_YEAR; yr--) ySel.add(new Option(String(yr), String(yr)));
  if (state.year && (Number(state.year) > y || Number(state.year) < MIN_YEAR)) state.year = '';
  ySel.value = String(state.year);

  mSel.innerHTML = '';
  mSel.add(new Option('Month', ''));
  MONTHS.forEach((name, i) => {
    const o = new Option(name, String(i + 1));
    if (Number(state.year) === y && i + 1 > m) o.disabled = true;
    mSel.add(o);
  });
  if (state.month && Number(state.year) === y && Number(state.month) > m) state.month = '';
  mSel.value = String(state.month);
}

/* ---------- Text cleanup ---------- */
const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const VILLAGE_RE = /^[\p{L}\p{M}\p{N} .\-'()]+$/u;
const NAME_RE = /^[\p{L}\p{M} .\-']+$/u;

/* ---------- Validation ---------- */
function validate() {
  const errs = {};
  const c = currentCountry();
  const coords = parseCoords(state.coordsRaw);

  if (coords.err) errs.coords = coords.err;
  else if (!c) errs.country = 'These coordinates are not in a country we serve.';
  else if (dup.status === 'checking') errs.coords = 'Still checking for records nearby — wait a moment.';
  else if (dup.status === 'found' && !state.dupAck) errs.coords = 'Tick "This is a different group" to continue.';

  if (c) {
    if (!c.regions.some((r) => String(r.id) === String(state.regionId))) errs.region = `Choose a ${c.region_label.toLowerCase()}`;
  } else {
    errs.region = 'Enter valid coordinates first';
  }

  if (state.type !== 'Church' && state.type !== 'Story Group') errs.type = 'Choose Church or Story Group';

  const v = collapse(state.village);
  if (!v) errs.village = 'Enter the village name';
  else if (v.length < 2 || v.length > 60) errs.village = 'Village name must be 2–60 characters';
  else if (!VILLAGE_RE.test(v) || !/[\p{L}\p{N}]/u.test(v)) errs.village = "Use only letters, numbers, spaces and . - ' ( )";

  if (!c) {
    errs.leader = 'Enter valid coordinates first';
  } else if (state.newLeader) {
    const n = collapse(state.nlName);
    const re = new RegExp(c.phone_pattern);
    if (!n) errs.leader = "Enter the new leader's name";
    else if (n.length < 2 || n.length > 60 || !NAME_RE.test(n)) errs.leader = "Name must be 2–60 letters (spaces and . - ' allowed)";
    else if (!state.nlPhone) errs.leader = 'Enter the mobile number';
    else if (!re.test(state.nlPhone)) errs.leader = `Not a valid ${c.name} mobile number. Example: ${c.phone_cc} ${c.phone_example}`;
  } else if (!c.leaders.some((l) => l.id === state.leaderId)) {
    errs.leader = 'Choose a leader, or "+ New leader"';
  }

  const { y, m } = nowYM();
  const yr = Number(state.year), mo = Number(state.month);
  if (!state.month || !state.year) errs.date = 'Choose the month and year it started';
  else if (yr < MIN_YEAR || yr > y || mo < 1 || mo > 12) errs.date = 'Choose a valid month and year';
  else if (yr === y && mo > m) errs.date = 'Start date cannot be in the future';

  const att = state.attendees;
  if (!/^\d+$/.test(att)) errs.attendees = 'Enter the number of attendees';
  else if (Number(att) < 1 || Number(att) > 1000) errs.attendees = 'Attendees must be between 1 and 1000';

  const notes = state.notes.trim();
  if (!notes) errs.notes = 'Write some notes or a story about this group';
  else if (notes.length < 10) errs.notes = 'Notes must be at least 10 characters';
  else if (notes.length > 4000) errs.notes = 'Notes can be at most 4000 characters';

  return errs;
}

function buildPayload() {
  const c = currentCountry();
  const p = {
    client_id: state.clientId,
    country_code: c.code,
    region_id: Number(state.regionId),
    group_type: state.type,
    village_name: collapse(state.village),
    month_started: Number(state.month),
    year_started: Number(state.year),
    latitude: state.lat,
    longitude: state.lng,
    attendees: Number(state.attendees),
    notes: state.notes.trim(),
    submitted_by: collapse($('submittedBy').value) || null,
  };
  if (state.newLeader) {
    p.new_leader_name = collapse(state.nlName);
    p.new_leader_phone = state.nlPhone;
  } else {
    p.leader_id = state.leaderId;
  }
  return p;
}

/* Maps a server validation message to the field it belongs to. */
function fieldForMessage(msg) {
  const s = (msg || '').toLowerCase();
  if (/coordinat|latitude|longitude|location|inside/.test(s)) return 'coords';
  if (/country/.test(s)) return 'country';
  if (/region|state|province|division|area/.test(s)) return 'region';
  if (/type|church|story/.test(s)) return 'type';
  if (/village/.test(s)) return 'village';
  if (/leader|phone|mobile/.test(s)) return 'leader';
  if (/month|year|date|start/.test(s)) return 'date';
  if (/attend/.test(s)) return 'attendees';
  if (/note/.test(s)) return 'notes';
  return null;
}

function showFieldErrors(errs) {
  let first = null;
  for (const [k, msg] of Object.entries(errs)) {
    setErr(k, msg);
    if (!first) first = k;
  }
  if (first) {
    const el = $('f_' + first);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ---------- Review ---------- */
function goReview() {
  clearErrs();
  state.village = collapse(state.village);
  $('village').value = state.village;
  const errs = validate();
  if (Object.keys(errs).length) {
    showFieldErrors(errs);
    return;
  }
  const c = currentCountry();
  const region = c.regions.find((r) => String(r.id) === String(state.regionId));
  const leader = c.leaders.find((l) => l.id === state.leaderId);
  const rows = [
    ['Coordinates', `${state.lat}, ${state.lng}`],
    ['Country', c.name],
    [c.region_label, region.name],
    ['Type', state.type],
    ['Village', state.village],
    ['Leader', leader ? `${leader.name} ••${leader.phone_tail}` : `New: ${collapse(state.nlName)}, ${c.phone_cc} ${state.nlPhone}`],
    ['Started', `${MONTHS[Number(state.month) - 1]} ${state.year}`],
    ['Attendees', state.attendees],
  ];
  rows.push(['Notes', state.notes.trim()]);
  const by = collapse($('submittedBy').value);
  if (by) rows.push(['Your name', by]);
  if (dup.status === 'found') rows.push(['Nearby records', 'Confirmed this is a different group']);
  if (dup.status === 'skipped') rows.push(['Nearby records', 'Not checked (no connection)']);

  const dl = $('reviewList');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    d.append(dt, dd);
    dl.appendChild(d);
  }
  $('reviewError').hidden = true;
  showScreen('scrReview');
}

/* ---------- Submit ---------- */
let sending = false;

async function submit() {
  if (sending) return;
  const errs = validate();
  if (Object.keys(errs).length) {
    showScreen('scrForm');
    showFieldErrors(errs);
    return;
  }
  const team = load(LS.team, null);
  const payload = buildPayload();
  sending = true;
  const btn = $('submitBtn');
  btn.disabled = true;
  $('editBtn').disabled = true;
  btn.textContent = 'Sending…';
  $('reviewError').hidden = true;

  const res = navigator.onLine ? await rpc('submit_group', { p_team_code: team, p: payload }) : { netErr: true };

  sending = false;
  btn.disabled = false;
  $('editBtn').disabled = false;
  btn.textContent = 'Submit';

  if (res.data) {
    finishSuccess(res.data, payload);
    return;
  }
  if (res.netErr) {
    enqueue(payload, team);
    resetForm();
    showScreen('scrQueued');
    return;
  }
  if (res.error.code === '28000') {
    showTeamScreen('That team code is no longer correct. Enter your team code again — your form is kept.');
    return;
  }
  // Validation error from the database: show it on the field.
  const msg = res.error.message || 'Something is not right with this form.';
  const field = fieldForMessage(msg);
  showScreen('scrForm');
  if (field) {
    showFieldErrors({ [field]: msg });
  } else {
    $('formError').textContent = msg;
    $('formError').hidden = false;
    $('formError').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function addSent(code, village) {
  const sent = load(LS.sent, []);
  if (!sent.some((s) => s.code === code)) sent.unshift({ code, village, at: new Date().toISOString() });
  save(LS.sent, sent.slice(0, 30));
  renderSent();
}

function finishSuccess(data, payload) {
  addSent(data.code, payload.village_name);
  $('doneCode').textContent = data.code;
  $('doneTitle').textContent = 'Saved';
  $('doneNote').textContent = data.already_saved
    ? 'This record was already saved earlier — here is its code.'
    : 'Write this code down or copy it.';
  $('copyBtn').textContent = 'Copy code';
  resetForm();
  showScreen('scrDone');
}

function resetForm() {
  state = blankState();
  save(LS.draft, null);
  resetDup();
  fillFormFromState();
}

/* ---------- Offline queue ---------- */
function enqueue(payload, team) {
  const q = load(LS.queue, []);
  if (!q.some((it) => it.payload.client_id === payload.client_id)) {
    q.push({ payload, team, queued_at: new Date().toISOString() });
  }
  save(LS.queue, q);
  renderQueue();
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  let q = load(LS.queue, []);
  if (!q.length) return;
  flushing = true;
  try {
    while (q.length) {
      const item = q[0];
      const res = await rpc('submit_group', { p_team_code: item.team, p: item.payload });
      if (res.netErr) break;
      q = load(LS.queue, []).filter((it) => it.payload.client_id !== item.payload.client_id);
      save(LS.queue, q);
      if (res.data) {
        addSent(res.data.code, item.payload.village_name);
        toast(`Sent: ${item.payload.village_name} — ${res.data.code}`);
      } else {
        const failed = load(LS.failed, []);
        failed.push({ ...item, message: res.error.message || 'Could not be saved' });
        save(LS.failed, failed);
      }
    }
  } finally {
    flushing = false;
    renderQueue();
  }
}

function renderQueue() {
  const q = load(LS.queue, []);
  const failed = load(LS.failed, []);
  const pill = $('pendingPill');
  pill.hidden = !q.length;
  pill.textContent = `${q.length} waiting to send`;
  $('queueBar').hidden = !q.length;
  $('queueText').textContent = `${q.length} record${q.length === 1 ? '' : 's'} saved on this phone, waiting to send.`;

  const box = $('failedBox');
  box.hidden = !failed.length;
  box.innerHTML = '';
  if (failed.length) {
    const h = document.createElement('div');
    h.textContent = `${failed.length} saved record${failed.length === 1 ? '' : 's'} could not be sent. Fix and submit again:`;
    box.appendChild(h);
    failed.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'item';
      const t = document.createElement('div');
      t.innerHTML = '';
      const b = document.createElement('strong');
      b.textContent = it.payload.village_name;
      t.append(b, document.createTextNode(` — ${it.message}`));
      const a = document.createElement('div');
      a.className = 'actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open in form';
      open.addEventListener('click', () => openFailed(i));
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Discard';
      del.addEventListener('click', () => {
        if (!confirm(`Discard the record for ${it.payload.village_name}?`)) return;
        const f = load(LS.failed, []);
        f.splice(i, 1);
        save(LS.failed, f);
        renderQueue();
      });
      a.append(open, del);
      d.append(t, a);
      box.appendChild(d);
    });
  }
}

function openFailed(i) {
  const f = load(LS.failed, []);
  const it = f[i];
  if (!it) return;
  if (state.coordsRaw && !confirm('This replaces what is in the form now. Continue?')) return;
  f.splice(i, 1);
  save(LS.failed, f);
  const p = it.payload;
  state = {
    ...blankState(),
    clientId: p.client_id,
    coordsRaw: `${p.latitude}, ${p.longitude}`,
    regionId: String(p.region_id || ''),
    type: p.group_type || '',
    village: p.village_name || '',
    leaderId: p.leader_id || '',
    newLeader: !p.leader_id && !!p.new_leader_name,
    nlName: p.new_leader_name || '',
    nlPhone: p.new_leader_phone || '',
    month: String(p.month_started || ''),
    year: String(p.year_started || ''),
    attendees: String(p.attendees || ''),
    notes: p.notes || '',
  };
  saveDraft();
  fillFormFromState();
  renderQueue();
  const field = fieldForMessage(it.message);
  if (field) showFieldErrors({ [field]: it.message });
  else { $('formError').textContent = it.message; $('formError').hidden = false; }
  if (!state.notes.trim()) setErr('notes', 'Notes are now required — add them before sending');
}

function renderSent() {
  const sent = load(LS.sent, []);
  $('sentBox').hidden = !sent.length;
  const ul = $('sentList');
  ul.innerHTML = '';
  for (const s of sent) {
    const li = document.createElement('li');
    li.textContent = `${s.code} — ${s.village}`;
    ul.appendChild(li);
  }
}

/* ---------- Fill form ---------- */
function fillFormFromState() {
  $('coords').value = state.coordsRaw;
  $('village').value = state.village;
  $('attendees').value = state.attendees;
  $('notes').value = state.notes;
  $('notesCount').textContent = state.notes.length;
  $('submittedBy').value = load(LS.name, '') || '';
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
  clearErrs();
  $('mapLink').hidden = true;
  renderDate();
  if (state.coordsRaw) onCoordsChanged(true);
  else applyCountry(null, true);
}

/* ---------- Team code ---------- */
function showTeamScreen(msg) {
  $('teamCode').value = load(LS.team, '') || '';
  setErr('team', msg || '');
  showScreen('scrTeam');
}

function storeOptions(data) {
  const serverMs = Date.parse(data.server_time);
  save(LS.opts, {
    countries: data.countries,
    server_time: data.server_time,
    offset: Number.isFinite(serverMs) ? serverMs - Date.now() : 0,
    fetched_at: new Date().toISOString(),
  });
}

async function verifyTeam(e) {
  e.preventDefault();
  const code = $('teamCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    setErr('team', 'Team code looks like XXXX-XXXX');
    return;
  }
  const btn = $('teamBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  setErr('team', '');
  const res = await rpc('form_options', { p_team_code: code });
  btn.disabled = false;
  btn.textContent = 'Continue';
  if (res.netErr) {
    setErr('team', 'No connection. Connect to the internet once to check your team code.');
    return;
  }
  if (res.error) {
    setErr('team', res.error.code === '28000' ? 'That team code is not correct.' : res.error.message);
    return;
  }
  save(LS.team, code);
  storeOptions(res.data);
  startForm();
  flushQueue();
}

function startForm() {
  $('teamShown').textContent = load(LS.team, '');
  const draft = load(LS.draft, null);
  state = draft && draft.clientId ? { ...blankState(), ...draft } : blankState();
  fillFormFromState();
  renderQueue();
  renderSent();
  showScreen('scrForm');
}

/* Refresh cached options in the background. */
async function refreshOptions() {
  const team = load(LS.team, null);
  if (!team || !navigator.onLine) return;
  const res = await rpc('form_options', { p_team_code: team });
  if (res.data) {
    storeOptions(res.data);
    if (!$('scrForm').hidden) {
      renderDate();
      if (state.lat != null) {
        const c = countryAt(state.lat, state.lng);
        applyCountry(c, c && c.code === state.countryCode);
      }
    }
  } else if (res.error && res.error.code === '28000') {
    save(LS.team, null);
    showTeamScreen('Your team code is no longer valid. Enter the new one.');
  }
}

/* ---------- Network status ---------- */
function renderNet() {
  const pill = $('netPill');
  pill.hidden = navigator.onLine;
  pill.className = 'pill offline';
}

/* ---------- Wire up ---------- */
function wire() {
  $('teamCode').addEventListener('input', (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (v.length > 4) v = v.slice(0, 4) + '-' + v.slice(4);
    e.target.value = v;
  });
  $('teamForm').addEventListener('submit', verifyTeam);

  const coords = $('coords');
  coords.addEventListener('change', () => onCoordsChanged(false));
  coords.addEventListener('paste', () => setTimeout(() => onCoordsChanged(false), 0));
  coords.addEventListener('input', () => {
    // Clear stale results as soon as the text changes; full check runs on change/paste.
    if (coords.value !== state.coordsRaw) {
      state.coordsRaw = coords.value;
      const r = parseCoords(coords.value);
      if (!r.err) onCoordsChanged(false);
      else if (state.lat != null) {
        state.lat = state.lng = null;
        $('mapLink').hidden = true;
        setErr('country', '');
        applyCountry(null, false);
        resetDup();
        saveDraft();
      }
    }
  });

  $('region').addEventListener('change', (e) => { state.regionId = e.target.value; setErr('region', ''); saveDraft(); });

  for (const b of document.querySelectorAll('.seg button')) {
    b.addEventListener('click', () => {
      state.type = b.dataset.type;
      for (const o of document.querySelectorAll('.seg button')) o.setAttribute('aria-pressed', String(o === b));
      setErr('type', '');
      saveDraft();
    });
  }

  $('village').addEventListener('input', (e) => { state.village = e.target.value; setErr('village', ''); saveDraft(); });
  $('village').addEventListener('blur', (e) => { state.village = collapse(e.target.value); e.target.value = state.village; saveDraft(); });

  $('leaderSearch').addEventListener('input', renderLeaderList);
  $('leaderChange').addEventListener('click', () => {
    state.leaderId = '';
    state.newLeader = false;
    renderLeader();
    $('leaderSearch').focus();
    saveDraft();
  });
  $('nlName').addEventListener('input', (e) => { state.nlName = e.target.value; setErr('leader', ''); saveDraft(); });
  $('nlName').addEventListener('blur', (e) => { state.nlName = collapse(e.target.value); e.target.value = state.nlName; saveDraft(); });
  $('nlPhone').addEventListener('input', (e) => {
    const c = currentCountry();
    const v = cleanPhone(e.target.value, c && c.phone_cc);
    e.target.value = v;
    state.nlPhone = v;
    setErr('leader', '');
    saveDraft();
  });

  $('year').addEventListener('change', (e) => { state.year = e.target.value; renderDate(); setErr('date', ''); saveDraft(); });
  $('month').addEventListener('change', (e) => { state.month = e.target.value; setErr('date', ''); saveDraft(); });

  const att = $('attendees');
  att.addEventListener('input', () => {
    att.value = att.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 4);
    state.attendees = att.value;
    setErr('attendees', '');
    saveDraft();
  });
  const step = (d) => {
    let n = Number(state.attendees) || 0;
    n = Math.min(1000, Math.max(1, n + d));
    state.attendees = String(n);
    att.value = state.attendees;
    setErr('attendees', '');
    saveDraft();
  };
  $('attMinus').addEventListener('click', () => step(-1));
  $('attPlus').addEventListener('click', () => step(1));

  $('notes').addEventListener('input', (e) => {
    state.notes = e.target.value.slice(0, 4000);
    $('notesCount').textContent = state.notes.length;
    saveDraft();
  });
  $('submittedBy').addEventListener('input', (e) => save(LS.name, e.target.value));

  $('mainForm').addEventListener('submit', (e) => { e.preventDefault(); goReview(); });
  $('submitBtn').addEventListener('click', submit);
  $('editBtn').addEventListener('click', () => showScreen('scrForm'));

  $('copyBtn').addEventListener('click', async () => {
    const code = $('doneCode').textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(code); ok = true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    $('copyBtn').textContent = ok ? 'Copied ✓' : 'Copy failed — write it down';
  });
  const another = () => { showScreen('scrForm'); renderQueue(); };
  $('anotherBtn').addEventListener('click', another);
  $('anotherBtn2').addEventListener('click', another);

  $('queueRetry').addEventListener('click', flushQueue);
  $('changeTeam').addEventListener('click', () => {
    if (load(LS.queue, []).length) {
      if (!confirm('Records waiting to send will still be sent with the team code they were saved with. Change team?')) return;
    }
    showTeamScreen('');
  });

  window.addEventListener('online', () => { renderNet(); flushQueue(); refreshOptions(); if (dup.status === 'skipped' && state.lat != null) checkNearby(); });
  window.addEventListener('offline', renderNet);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  setInterval(flushQueue, 30000);
}

/* ---------- Start ---------- */
function init() {
  wire();
  renderNet();
  const team = load(LS.team, null);
  const opts = load(LS.opts, null);
  if (team && opts) {
    startForm();
    refreshOptions();
    flushQueue();
  } else {
    showTeamScreen('');
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
