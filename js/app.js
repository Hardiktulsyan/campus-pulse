/* Campus Pulse. No dependencies. Reads data/data.js, optionally a published Google Sheet CSV. */
(function () {
  'use strict';

  /* ---------- Setup ---------- */
  const CONFIG = window.CAMPUS_CONFIG || {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = !reduced && typeof Element.prototype.animate === 'function';
  const motion = canAnimate && 'IntersectionObserver' in window;
  if (motion) document.documentElement.classList.add('js-motion');

  const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';
  const EASE_IO = 'cubic-bezier(.77, 0, .18, 1)';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

  function play(el, frames, opts) {
    if (!canAnimate || !el) return Promise.resolve();
    try {
      const a = el.animate(frames, Object.assign({ fill: 'both' }, opts));
      return a.finished.catch(() => {});
    } catch (e) {
      return Promise.resolve();
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- Dates and times ---------- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseIso = (iso) => { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const validIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(parseIso(s)) === s;
  const TODAY = isoOf(new Date());
  const TOMORROW = (() => { const d = new Date(); return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); })();
  const plusDays = (n) => { const d = new Date(); return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

  function normDate(v) {
    const s = String(v == null ? '' : v).trim();
    if (validIso(s)) return s;
    const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s); // DD/MM/YYYY
    if (m) { const iso = m[3] + '-' + pad(m[2]) + '-' + pad(m[1]); if (validIso(iso)) return iso; }
    return '';
  }
  function normTime(v) {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(String(v == null ? '' : v).trim());
    if (!m) return '';
    let h = Number(m[1]); const mi = Number(m[2]);
    if (m[3]) { const pm = m[3].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    if (h > 23 || mi > 59) return '';
    return pad(h) + ':' + pad(mi);
  }
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const fmtShort = (iso) => { const d = parseIso(iso); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };
  const fmtLong = (iso) => { const d = parseIso(iso); return DAYS_LONG[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear(); };
  const dayHeading = (iso) => iso === TODAY ? 'Today, ' + fmtShort(iso) : iso === TOMORROW ? 'Tomorrow, ' + fmtShort(iso) : fmtShort(iso);
  const timeRange = (ev) => ev.start + ' to ' + ev.end;

  /* ---------- Safety helpers ---------- */
  const safeColor = (c, fb) => /^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim() : fb;
  function safeUrl(u) {
    try {
      const url = new URL(String(u || '').trim());
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (e) { return ''; }
  }
  const safeEmail = (e) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(e || '').trim()) ? String(e).trim() : '';
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'event';

  /* ---------- Clubs ---------- */
  const CLUBS = (Array.isArray(window.CAMPUS_CLUBS) ? window.CAMPUS_CLUBS : []).map((c) => ({
    id: clean(c.id, 60),
    name: clean(c.name, 80),
    category: clean(c.category, 30) || 'Other',
    tagline: clean(c.tagline, 140),
    color: safeColor(c.color, '#6B7140'),
    recruitment: clean(c.recruitment, 20),
    meets: clean(c.meets, 120),
    contact: safeEmail(c.contact)
  })).filter((c) => c.id && c.name);
  const clubById = new Map(CLUBS.map((c) => [c.id, c]));
  const clubByName = new Map(CLUBS.map((c) => [c.name.toLowerCase(), c]));
  const CATEGORIES = Array.from(new Set(CLUBS.map((c) => c.category)));

  /* ---------- Events: load, validate, normalise ---------- */
  function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function csvToObjects(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return [];
    const head = rows[0].map((h) => String(h).trim().toLowerCase());
    return rows.slice(1).map((r) => {
      const o = {};
      head.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; });
      return o;
    });
  }

  async function loadRawEvents() {
    const url = safeUrl(CONFIG.sheetCsvUrl);
    if (url && url.startsWith('https://')) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 7000);
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = csvToObjects(await res.text());
        if (list.length) return list;
        console.warn('Campus Pulse: the sheet had no rows, using data/data.js instead.');
      } catch (e) {
        console.warn('Campus Pulse: could not read the sheet, using data/data.js instead.', e);
      }
    }
    return Array.isArray(window.CAMPUS_EVENTS) ? window.CAMPUS_EVENTS : [];
  }

  function normalizeEvents(rawList) {
    const seen = new Set();
    const out = [];
    rawList.forEach((r, i) => {
      const label = 'Campus Pulse: skipped row ' + (i + 1);
      const clubKey = clean(r.club != null ? r.club : r.clubId, 80);
      const club = clubById.get(clubKey) || clubByName.get(clubKey.toLowerCase());
      const title = clean(r.title, 140);
      let date = '';
      if (r.date) date = normDate(r.date);
      else if (r.daysFromToday !== undefined && r.daysFromToday !== '' && Number.isFinite(Number(r.daysFromToday))) date = plusDays(Number(r.daysFromToday));
      const start = normTime(r.start);
      const end = normTime(r.end);
      const venue = clean(r.venue, 80);
      const why = !title ? 'no title' : !club ? 'unknown club "' + clubKey + '"' : !date ? 'bad date' :
        !start ? 'bad start time' : !end ? 'bad end time' : toMin(end) <= toMin(start) ? 'end is not after start' : !venue ? 'no venue' : '';
      if (why) { console.warn(label + ': ' + why); return; }

      let id = clean(r.id, 60).replace(/[^a-z0-9_-]/gi, '-') || ('evt-' + (i + 1));
      while (seen.has(id)) id += '-x';
      seen.add(id);

      const capacity = Math.max(0, parseInt(r.capacity, 10) || 0);
      const registered = Math.max(0, parseInt(r.registered, 10) || 0);
      const description = clean(r.description, 400);
      out.push({
        id, title, club: club.id, clubName: club.name, category: club.category, color: club.color,
        date, start, end, venue, description, capacity, registered,
        link: safeUrl(r.link), contact: safeEmail(r.contact) || club.contact,
        bucket: date === TODAY ? 'today' : date < TODAY ? 'past' : 'upcoming',
        hay: (title + ' ' + club.name + ' ' + venue + ' ' + description + ' ' + club.category).toLowerCase()
      });
    });
    out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return out;
  }

  /* ---------- Saved events (this device only) ---------- */
  const STORE_KEY = 'campus_pulse_saved_v2';
  let saved = (() => {
    try {
      const a = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
    } catch (e) { return []; }
  })();
  const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (e) { /* storage blocked */ } };
  const isSaved = (id) => saved.includes(id);

  /* ---------- State ---------- */
  const state = {
    events: [], viewKey: '', baseHash: '#/', viewName: '', busy: false, pending: false,
    panelOpen: false, panelId: '', closing: false, openedInApp: false, lastFocus: null,
    introPromise: Promise.resolve(), io: null,
    f: { tab: 'upcoming', q: '', club: '', category: '' }, clubCat: 'All'
  };
  const eventById = (id) => state.events.find((e) => e.id === id);

  /* ---------- Poster generator ---------- */
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function wrap(title, max, maxLines) {
    const words = title.split(/\s+/); const lines = []; let cur = '';
    words.forEach((w) => {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length <= max) cur = cand; else { if (cur) lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const cut = lines.slice(0, maxLines);
      cut[maxLines - 1] = cut[maxLines - 1].replace(/[.,:;]?$/, '') + '...';
      return cut;
    }
    return lines;
  }

  function posterSvg(ev, suffix, decorative) {
    const seed = hashSeed(ev.id + '-' + ev.title);
    const comp = seed % 5;
    const primary = ev.color;
    const pool = ['#A8CBE0', '#A5603B', '#6B7140', '#D9C7A6'];
    let secondary = pool[seed % pool.length];
    if (secondary.toLowerCase() === primary.toLowerCase()) secondary = pool[(seed + 1) % pool.length];
    let size = 36; let lines = wrap(ev.title, 17, 5);
    if (lines.length > 4) { size = 28; lines = wrap(ev.title, 22, 5); }
    const step = Math.round(size * 1.22);
    const fid = 'grain-' + slug(ev.id) + '-' + suffix;
    const E = '#3E2A1E', B = '#EFE6D4', S = '#D9C7A6';

    let geo;
    if (comp === 0) geo = `<rect x="44" y="120" width="512" height="310" fill="${primary}"/><circle cx="430" cy="275" r="110" fill="${secondary}"/><rect x="74" y="340" width="220" height="60" fill="${E}"/>`;
    else if (comp === 1) geo = `<rect x="44" y="120" width="250" height="310" fill="${E}"/><rect x="306" y="120" width="250" height="310" fill="${secondary}"/><polygon points="170,150 490,410 170,410" fill="${primary}"/>`;
    else if (comp === 2) geo = `<rect x="44" y="120" width="512" height="310" fill="${S}"/><circle cx="210" cy="275" r="125" fill="${primary}"/><circle cx="385" cy="275" r="95" fill="${E}"/><rect x="110" y="255" width="380" height="40" fill="${secondary}"/>`;
    else if (comp === 3) geo = `<rect x="44" y="120" width="512" height="145" fill="${primary}"/><rect x="44" y="280" width="512" height="150" fill="${E}"/><circle cx="300" cy="275" r="88" fill="${secondary}"/>`;
    else geo = `<rect x="44" y="120" width="512" height="310" fill="${secondary}"/><polygon points="44,430 300,130 556,430" fill="${primary}"/><circle cx="300" cy="315" r="56" fill="${B}"/>`;

    const title = lines.map((l, i) =>
      `<text x="44" y="${512 + i * step}" fill="${E}" font-family="Fraunces, Georgia, serif" font-size="${size}" font-weight="700">${esc(l)}</text>`).join('');
    const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc('Poster for ' + ev.title)}"`;

    return `<svg viewBox="0 0 600 800" xmlns="http://www.w3.org/2000/svg" ${a11y}>
      <defs><filter id="${fid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.06 0"/></filter></defs>
      <rect width="600" height="800" fill="${B}"/>
      <rect x="24" y="24" width="552" height="752" fill="none" stroke="${E}" stroke-width="2"/>
      ${geo}
      <line x1="44" y1="96" x2="556" y2="96" stroke="${E}" stroke-width="1.5"/>
      <text x="44" y="72" fill="${E}" font-family="DM Sans, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${esc(ev.clubName.toUpperCase().slice(0, 28))}</text>
      <text x="556" y="72" fill="${E}" font-family="DM Sans, sans-serif" font-size="16" font-weight="700" text-anchor="end" letter-spacing="1.5">${esc(ev.category.toUpperCase())}</text>
      <line x1="44" y1="458" x2="556" y2="458" stroke="${E}" stroke-width="1.5"/>
      ${title}
      <line x1="44" y1="686" x2="556" y2="686" stroke="${E}" stroke-width="1.5"/>
      <text x="44" y="720" fill="${E}" font-family="DM Sans, sans-serif" font-size="18" font-weight="700">${esc(fmtShort(ev.date).toUpperCase())}, ${esc(ev.start)} TO ${esc(ev.end)}</text>
      <text x="44" y="748" fill="#4F552E" font-family="DM Sans, sans-serif" font-size="16" font-weight="700">${esc(ev.venue.toUpperCase().slice(0, 34))}</text>
      <text x="556" y="748" fill="${E}" font-family="DM Sans, sans-serif" font-size="14" font-weight="700" text-anchor="end" letter-spacing="1">BENNETT UNIVERSITY</text>
      <rect width="600" height="800" filter="url(#${fid})" pointer-events="none"/>
    </svg>`;
  }

  /* ---------- Calendar export ---------- */
  const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) { let out = ''; while (line.length > 70) { out += line.slice(0, 70) + '\r\n '; line = line.slice(70); } return out + line; }
  function buildIcs(list) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Campus Pulse//Bennett University//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Kolkata', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD', 'END:VTIMEZONE'];
    list.forEach((ev) => {
      const d = ev.date.replace(/-/g, '');
      let desc = ev.description;
      if (ev.link) desc += '\nRegister: ' + ev.link;
      if (ev.contact) desc += '\nContact: ' + ev.contact;
      lines.push('BEGIN:VEVENT', 'UID:' + ev.id + '@campus-pulse', 'DTSTAMP:' + stamp,
        'DTSTART;TZID=Asia/Kolkata:' + d + 'T' + ev.start.replace(':', '') + '00',
        'DTEND;TZID=Asia/Kolkata:' + d + 'T' + ev.end.replace(':', '') + '00',
        'SUMMARY:' + icsText(ev.title + ' (' + ev.clubName + ')'),
        'LOCATION:' + icsText(ev.venue + ', Bennett University'),
        'DESCRIPTION:' + icsText(desc), 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /* ---------- Filtering ---------- */
  function matches(ev, f, skipTab) {
    if (!skipTab && ev.bucket !== f.tab) return false;
    if (f.club && ev.club !== f.club) return false;
    if (f.category && ev.category !== f.category) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (!q.split(/\s+/).every((w) => ev.hay.includes(w))) return false; }
    return true;
  }
  const filtersActive = (f) => !!(f.q || f.club || f.category);
  function bestTab(f) {
    const order = ['today', 'upcoming', 'past'];
    for (const t of order) if (state.events.some((e) => e.bucket === t && matches(e, Object.assign({}, f, { tab: t })))) return t;
    return 'upcoming';
  }
  function groupByDate(list) {
    const map = new Map();
    list.forEach((e) => { if (!map.has(e.date)) map.set(e.date, []); map.get(e.date).push(e); });
    return Array.from(map.entries());
  }

  /* ---------- Entrance animations ---------- */
  function disconnectReveals() { if (state.io) { state.io.disconnect(); state.io = null; } }

  function revealCard(card, delay) {
    const poster = $('.will-poster', card);
    const text = $('.will-text', card);
    if (poster) {
      play(poster, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], { duration: 750, delay, easing: EASE_IO })
        .then(() => poster.classList.remove('will-poster'));
    }
    if (text) {
      play(text, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: delay + 300, easing: 'ease-out' })
        .then(() => text.classList.remove('will-text'));
    }
  }
  function revealRow(row, delay) {
    play(row, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay, easing: 'ease-out' })
      .then(() => row.classList.remove('will-row'));
  }

  function activateReveals(root) {
    if (!motion || !root) return;
    disconnectReveals();
    const targets = $$('.card, .will-row', root);
    let count = 0; let last = 0;
    state.io = new IntersectionObserver((entries, obs) => {
      const now = performance.now();
      if (now - last > 250) count = 0;
      last = now;
      entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
        .forEach((e) => {
          const delay = Math.min(count, 8) * 70; count++;
          if (e.target.classList.contains('card')) revealCard(e.target, delay); else revealRow(e.target, delay);
          obs.unobserve(e.target);
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
    targets.forEach((t) => state.io.observe(t));

    // Page head and toolbar
    const title = $('.page-title__in', root);
    if (title) play(title, [{ transform: 'translateY(105%)' }, { transform: 'translateY(0)' }], { duration: 800, easing: EASE_OUT });
    $$('.will-fade', root).forEach((el, i) => {
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 250 + i * 90, easing: 'ease-out' }).then(() => el.classList.remove('will-fade'));
    });
  }

  function clearHidden(root) {
    $$('.will-poster, .will-text, .will-row, .will-fade', root).forEach((el) => el.classList.remove('will-poster', 'will-text', 'will-row', 'will-fade'));
  }

  /* ---------- Views ---------- */
  const view = () => $('#view');

  function cardHtml(ev) {
    const href = '#/event/' + encodeURIComponent(ev.id);
    const full = ev.capacity > 0 && ev.registered >= ev.capacity;
    const left = ev.capacity - ev.registered;
    let status = '';
    if (ev.bucket === 'past') status = '<span class="status status--quiet">Ended</span>';
    else if (full) status = '<span class="status">Full</span>';
    else if (ev.capacity > 0 && left <= 5) status = '<span class="status">' + left + (left === 1 ? ' seat left' : ' seats left') + '</span>';
    else status = '<span></span>';
    const saveBtn = ev.bucket === 'past' ? '' :
      '<button type="button" class="btn btn--ghost btn--small" data-save="' + esc(ev.id) + '" aria-pressed="' + isSaved(ev.id) + '">' + (isSaved(ev.id) ? 'Saved' : 'Save') + '</button>';
    return `<article class="card">
      <a class="card__link" href="${href}" data-open>
        <div class="poster-frame will-poster">${posterSvg(ev, 'c', true)}</div>
        <div class="card__body will-text">
          <p class="card__when">${esc(timeRange(ev))}</p>
          <h3 class="card__title">${esc(ev.title)}</h3>
          <p class="card__where">${esc(ev.venue)}</p>
          <p class="card__club"><span class="swatch" style="background:${ev.color}"></span>${esc(ev.clubName)}</p>
        </div>
      </a>
      <div class="card__foot">${status}${saveBtn}</div>
    </article>`;
  }

  function pageHead(title, sub) {
    return `<div class="container page-head">
      <h1 class="page-title"><span class="page-title__in">${esc(title)}</span></h1>
      <p class="page-sub will-fade">${esc(sub)}</p>
    </div>`;
  }

  /* Events */
  function renderEvents(params) {
    const f = state.f;
    f.q = ''; f.category = '';
    f.club = clubById.has(params.get('club') || '') ? params.get('club') : '';
    f.tab = bestTab(f);

    const clubOpts = CLUBS.map((c) => `<option value="${esc(c.id)}"${c.id === f.club ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    const catOpts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    view().innerHTML = `<section>
      ${pageHead("What's on at Bennett", fmtLong(TODAY) + '. Every club event, with the time and the room.')}
      <div class="container toolbar will-fade">
        <div class="tabs" role="group" aria-label="When">
          <button type="button" class="tab" data-tab="today"></button>
          <button type="button" class="tab" data-tab="upcoming"></button>
          <button type="button" class="tab" data-tab="past"></button>
          <span class="tab-indicator" aria-hidden="true"></span>
        </div>
        <div class="filters">
          <label class="field field--search"><span>Search</span><input type="search" id="f-q" placeholder="Event, club or room" autocomplete="off" maxlength="60"></label>
          <label class="field"><span>Club</span><select id="f-club"><option value="">All clubs</option>${clubOpts}</select></label>
          <label class="field"><span>Category</span><select id="f-cat"><option value="">All categories</option>${catOpts}</select></label>
          <button type="button" class="link-btn" id="f-clear" hidden>Clear filters</button>
        </div>
      </div>
      <div class="container">
        <p class="results-meta" id="results-meta" aria-live="polite"></p>
        <div id="results"></div>
      </div>
    </section>`;
    renderResults('none', true);
  }

  function renderResults(mode, initial) {
    const f = state.f;
    const root = view();
    const results = $('#results', root);
    if (!results) return;

    // tab labels and counts (counts respect the other filters)
    ['today', 'upcoming', 'past'].forEach((t) => {
      const n = state.events.filter((e) => e.bucket === t && matches(e, Object.assign({}, f, { tab: t }))).length;
      const btn = $('[data-tab="' + t + '"]', root);
      btn.innerHTML = (t === 'today' ? 'Today' : t === 'upcoming' ? 'Upcoming' : 'Past') + '<span class="tab__count">' + n + '</span>';
      btn.setAttribute('aria-pressed', String(f.tab === t));
    });
    $('#f-clear', root).hidden = !filtersActive(f);

    const list = state.events.filter((e) => matches(e, f));
    if (f.tab === 'past') list.reverse();

    const noun = f.tab === 'today' ? 'today' : f.tab === 'upcoming' ? 'coming up' : 'in the past';
    $('#results-meta', root).textContent = list.length + (list.length === 1 ? ' event ' : ' events ') + noun + (filtersActive(f) ? ' that match your filters' : '');

    if (!list.length) {
      const hasFilters = filtersActive(f);
      results.innerHTML = `<div class="empty"><h2>${hasFilters ? 'No events match these filters' : f.tab === 'today' ? 'Nothing on today' : f.tab === 'upcoming' ? 'Nothing scheduled yet' : 'No past events'}</h2>
        <p>${hasFilters ? 'Try a different club or category, or clear the search.' : f.tab === 'today' ? 'Check what is coming up in the next few days.' : 'Clubs post new events here as soon as they are confirmed.'}</p>
        ${hasFilters ? '<button type="button" class="btn" data-act="clear">Clear filters</button>' : f.tab === 'today' ? '<button type="button" class="btn" data-act="to-upcoming">See upcoming events</button>' : ''}</div>`;
    } else {
      const groups = groupByDate(list);
      results.innerHTML = groups.map(([date, evs]) =>
        `<section class="day"><h2 class="day__title">${esc(dayHeading(date))}</h2><div class="grid">${evs.map(cardHtml).join('')}</div></section>`).join('');
    }

    placeTabIndicator(!initial);
    if (mode === 'mask') activateReveals(results);
    else if (mode === 'fade') { clearHidden(results); play(results, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }); }
    else if (!initial) clearHidden(results);
  }

  /* Clubs */
  function recruitmentTag(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'open') return '<span class="tag tag--open">Open for members</span>';
    if (s === 'auditions') return '<span class="tag tag--auditions">Auditions on</span>';
    if (s === 'closed') return '<span class="tag tag--closed">Not recruiting</span>';
    return status ? '<span class="tag">' + esc(status) + '</span>' : '';
  }

  function renderClubs() {
    state.clubCat = 'All';
    const chips = ['All'].concat(CATEGORIES).map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === 'All'}">${esc(c)}</button>`).join('');
    view().innerHTML = `<section>
      ${pageHead('Clubs', CLUBS.length + ' clubs on campus. Pick one to see what it has coming up.')}
      <div class="container">
        <div class="chips will-fade" role="group" aria-label="Category">${chips}</div>
        <div class="club-list" id="club-list"></div>
      </div>
    </section>`;
    renderClubList('none', true);
  }

  function renderClubList(mode, initial) {
    const list = $('#club-list');
    if (!list) return;
    $$('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === state.clubCat)));
    const shown = CLUBS.filter((c) => state.clubCat === 'All' || c.category === state.clubCat);
    list.innerHTML = shown.map((c) => {
      const n = state.events.filter((e) => e.club === c.id && e.bucket !== 'past').length;
      return `<a class="club-row will-row" href="#/?club=${encodeURIComponent(c.id)}">
        <span class="club-row__name"><span class="swatch" style="background:${c.color}"></span>
          <span><span class="club-row__title">${esc(c.name)}</span><span class="club-row__tagline">${esc(c.tagline)}</span></span></span>
        <span class="club-row__meets">${c.meets ? 'Meets ' + esc(c.meets) : ''}</span>
        <span class="club-row__side">${recruitmentTag(c.recruitment)}<span class="club-row__count">${n ? n + ' coming up' : 'Nothing scheduled'}</span></span>
      </a>`;
    }).join('');
    if (mode === 'mask') activateReveals(list);
    else if (!initial) clearHidden(list);
  }

  /* My schedule */
  function savedEvents() {
    return saved.map(eventById).filter(Boolean).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
  function findClashes(list) {
    const pairs = []; const ids = new Set();
    const live = list.filter((e) => e.bucket !== 'past');
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)) { pairs.push([a, b]); ids.add(a.id); ids.add(b.id); }
      }
    }
    return { pairs, ids };
  }

  function renderSchedule() {
    view().innerHTML = `<section>
      ${pageHead('My schedule', 'Events you saved. They stay on this device, so there is nothing to sign in to.')}
      <div class="container" id="sched"></div>
    </section>`;
    renderScheduleList(true);
  }

  function renderScheduleList(initial) {
    const box = $('#sched');
    if (!box) return;
    const list = savedEvents();
    if (!list.length) {
      box.innerHTML = `<div class="empty"><h2>Nothing saved yet</h2><p>Save an event and it shows up here. If two saved events overlap, you get a warning.</p><a class="btn" href="#/">Browse events</a></div>`;
      return;
    }
    const clash = findClashes(list);
    const upcoming = list.filter((e) => e.bucket !== 'past');
    const notice = clash.pairs.length ? `<div class="notice" role="alert"><h2>${clash.pairs.length === 1 ? 'Two of your saved events overlap' : clash.pairs.length + ' clashes in your saved events'}</h2><ul>${
      clash.pairs.map(([a, b]) => `<li>${esc(fmtShort(a.date))}: ${esc(a.title)} (${esc(timeRange(a))}) and ${esc(b.title)} (${esc(timeRange(b))}).</li>`).join('')}</ul></div>` : '';
    box.innerHTML = `${notice}
      <div class="sched-head"><p class="results-meta" style="margin:0">${list.length} saved${upcoming.length !== list.length ? ', ' + upcoming.length + ' still to come' : ''}</p>
        ${upcoming.length ? '<button type="button" class="btn btn--ghost btn--small" data-act="ics-all">Add all to calendar</button>' : ''}</div>
      <ul class="sched-list">${list.map((ev) => `<li class="sched-row${ev.bucket === 'past' ? ' is-past' : ''}${initial ? ' will-row' : ''}" data-id="${esc(ev.id)}">
        <div><span class="sched-day">${esc(dayHeading(ev.date))}</span><span class="sched-time">${esc(timeRange(ev))}</span></div>
        <a class="sched-main" href="#/event/${encodeURIComponent(ev.id)}" data-open><span class="sched-title">${esc(ev.title)}</span><span class="sched-meta">${esc(ev.clubName)}, ${esc(ev.venue)}${ev.bucket === 'past' ? ', ended' : ''}</span></a>
        <div class="sched-actions">${clash.ids.has(ev.id) ? '<span class="tag tag--clash">Clash</span>' : ''}<button type="button" class="btn btn--ghost btn--small" data-remove="${esc(ev.id)}">Remove</button></div>
      </li>`).join('')}</ul>`;
    if (initial) activateReveals(box);
  }

  /* ---------- Save / badge ---------- */
  function updateBadges() {
    $$('.js-saved-badge').forEach((b) => { b.hidden = saved.length === 0; b.textContent = String(saved.length); });
    placeNavIndicator(false);
  }
  function refreshSaveUI() {
    $$('[data-save]').forEach((b) => {
      const on = isSaved(b.dataset.save);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = b.hasAttribute('data-long') ? (on ? 'Saved. Remove from schedule' : 'Save to my schedule') : (on ? 'Saved' : 'Save');
    });
    updateBadges();
  }
  function toggleSave(id) {
    if (!eventById(id)) return;
    saved = isSaved(id) ? saved.filter((x) => x !== id) : saved.concat(id);
    persist();
    refreshSaveUI();
  }

  /* ---------- Indicators ---------- */
  function placeNavIndicator(animate) {
    const nav = $('#nav'); const ind = $('.nav-indicator'); if (!nav || !ind) return;
    const active = $('a[aria-current="page"]', nav);
    if (!animate) ind.classList.add('no-anim');
    if (!active) ind.style.width = '0px';
    else { ind.style.width = active.offsetWidth + 'px'; ind.style.transform = 'translateX(' + active.offsetLeft + 'px)'; }
    if (!animate) { void ind.offsetWidth; ind.classList.remove('no-anim'); }
  }
  function placeTabIndicator(animate) {
    const ind = $('.tab-indicator'); if (!ind) return;
    const active = $('.tab[aria-pressed="true"]'); if (!active) return;
    if (!animate) ind.classList.add('no-anim');
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + active.offsetLeft + 'px)';
    if (!animate) { void ind.offsetWidth; ind.classList.remove('no-anim'); }
  }
  function setNav(name) {
    $$('[data-nav]').forEach((a) => { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    placeNavIndicator(true);
  }

  /* ---------- Detail panel ---------- */
  function panelHtml(ev) {
    const past = ev.bucket === 'past';
    const full = ev.capacity > 0 && ev.registered >= ev.capacity;
    const seats = ev.capacity > 0 ? (full ? 'Full, all ' + ev.capacity + ' seats taken' : ev.registered + ' of ' + ev.capacity + ' taken, ' + (ev.capacity - ev.registered) + ' left') : '';
    const mail = ev.contact ? `<a href="mailto:${esc(ev.contact)}">${esc(ev.contact)}</a>` : '';
    let action = '';
    if (past) action = '<p class="note">This event has ended.</p>';
    else if (full) action = '<p class="note">Registration is full.</p>';
    else if (ev.link) action = `<a class="btn" href="${esc(ev.link)}" target="_blank" rel="noopener noreferrer">Register</a>`;
    return `<div class="panel__inner">
      <div class="panel__bar will-fade">
        <p class="panel__club"><span class="swatch" style="background:${ev.color}"></span>${esc(ev.clubName)}</p>
        <button type="button" class="btn btn--ghost btn--small" data-close>Close</button>
      </div>
      <div class="panel__poster"><div class="poster-frame" id="panel-poster">${posterSvg(ev, 'p', false)}</div></div>
      <div class="panel__body">
        <h2 class="panel__title will-fade" id="panel-title">${esc(ev.title)}</h2>
        <dl class="facts will-fade">
          <dt>Date</dt><dd>${esc(fmtLong(ev.date))}</dd>
          <dt>Time</dt><dd>${esc(timeRange(ev))}</dd>
          <dt>Room</dt><dd>${esc(ev.venue)}</dd>
          ${seats ? '<dt>Seats</dt><dd>' + esc(seats) + '</dd>' : ''}
          ${mail ? '<dt>Contact</dt><dd>' + mail + '</dd>' : ''}
        </dl>
        ${ev.description ? '<p class="panel__desc will-fade">' + esc(ev.description) + '</p>' : ''}
        <div class="panel__actions will-fade">
          ${action}
          ${past ? '' : `<button type="button" class="btn btn--ghost" data-save="${esc(ev.id)}" data-long aria-pressed="${isSaved(ev.id)}">${isSaved(ev.id) ? 'Saved. Remove from schedule' : 'Save to my schedule'}</button>
          <button type="button" class="btn btn--ghost" data-ics="${esc(ev.id)}">Add to calendar</button>`}
          <button type="button" class="btn btn--ghost" data-copy="${esc(ev.id)}">Copy link</button>
        </div>
      </div>
    </div>`;
  }

  const setInert = (on) => ['.site-header', 'main', '.site-footer'].forEach((s) => { const el = $(s); if (el) { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); } });

  function openPanel(ev) {
    const root = $('#panel-root'); const panel = $('#panel');
    if (!state.panelOpen) state.lastFocus = document.activeElement;
    const wasOpen = state.panelOpen;
    state.panelOpen = true; state.panelId = ev.id; state.closing = false;
    $('#panel-content').innerHTML = panelHtml(ev);
    root.hidden = false;
    document.documentElement.classList.add('is-locked');
    setInert(true);
    document.title = ev.title + ' | Campus Pulse';

    if (canAnimate && !wasOpen) {
      play($('#panel-backdrop'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
      play(panel, [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 520, easing: EASE_OUT });
      play($('#panel-poster'), [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], { duration: 800, delay: 250, easing: EASE_IO });
      $$('.will-fade', panel).forEach((el, i) => {
        play(el, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 500, delay: 300 + i * 80, easing: EASE_OUT })
          .then(() => el.classList.remove('will-fade'));
      });
    } else clearHidden(panel);
    panel.scrollTop = 0;
    const closeBtn = $('[data-close]', panel);
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function finishClose() {
    const root = $('#panel-root');
    root.hidden = true; $('#panel-content').innerHTML = '';
    document.documentElement.classList.remove('is-locked');
    setInert(false);
    state.panelOpen = false; state.panelId = ''; state.closing = false; state.openedInApp = false;
    const lf = state.lastFocus;
    if (lf && document.contains(lf) && typeof lf.focus === 'function') lf.focus({ preventScroll: true });
    state.lastFocus = null;
    document.title = pageTitle(state.viewName);
    if (state.viewName === 'schedule') renderScheduleList(false);
  }

  async function closePanel(animated) {
    if (!state.panelOpen || state.closing) return;
    state.closing = true;
    if (animated && canAnimate) {
      await Promise.all([
        play($('#panel'), [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: 340, easing: EASE_IO }),
        play($('#panel-backdrop'), [{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: 'ease-in' })
      ]);
    }
    finishClose();
  }

  function requestClose() {
    if (!state.panelOpen) return;
    if (state.openedInApp) history.back();
    else location.replace(state.baseHash);
  }

  /* ---------- Routing and transitions ---------- */
  const TITLES = { events: 'Events', clubs: 'Clubs', schedule: 'My schedule' };
  const pageTitle = (name) => (TITLES[name] || 'Events') + ' | Campus Pulse';

  function parseRoute() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const parts = raw.split('?');
    const path = parts[0] || '/';
    const params = new URLSearchParams(parts[1] || '');
    let m;
    if ((m = /^\/event\/(.+)$/.exec(path))) {
      let id = m[1]; try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
      return { name: 'event', id };
    }
    const name = path === '/clubs' ? 'clubs' : path === '/schedule' ? 'schedule' : 'events';
    const key = name === 'events' ? ('/' + (params.get('club') ? '?club=' + encodeURIComponent(params.get('club')) : '')) : path;
    return { name, key, params };
  }

  function renderRoute(r) {
    disconnectReveals();
    if (r.name === 'clubs') renderClubs();
    else if (r.name === 'schedule') renderSchedule();
    else renderEvents(r.params);
    window.scrollTo(0, 0);
    state.viewKey = r.key; state.viewName = r.name; state.baseHash = '#' + r.key;
    document.title = pageTitle(r.name);
    setNav(r.name);
    closeDrawer();
  }

  async function transition(label, doRender) {
    const wipe = $('#wipe'); const text = $('#wipe-label');
    text.textContent = label;
    await play(wipe, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 420, easing: EASE_IO });
    doRender();
    await wait(60);
    const exit = play(wipe, [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: 520, easing: EASE_IO });
    await wait(180);
    activateReveals(view());
    await exit;
    wipe.getAnimations().forEach((a) => a.cancel());
  }

  async function onRoute(initial) {
    if (state.busy) { state.pending = true; return; }
    const r = parseRoute();
    state.busy = true;
    try {
      if (r.name === 'event') {
        const ev = eventById(r.id);
        if (!ev) { state.busy = false; location.replace(state.viewKey ? state.baseHash : '#/'); return; }
        if (!state.viewKey) {
          renderRoute({ name: 'events', key: '/', params: new URLSearchParams() });
          if (initial) await state.introPromise;
          activateReveals(view());
        }
        openPanel(ev);
      } else if (r.key === state.viewKey) {
        if (state.panelOpen) await closePanel(true);
      } else if (!state.viewKey || !canAnimate) {
        if (state.panelOpen) await closePanel(false);
        renderRoute(r);
        if (initial) await state.introPromise;
        activateReveals(view());
      } else {
        if (state.panelOpen) await closePanel(false);
        await transition(TITLES[r.name] || 'Events', () => renderRoute(r));
      }
    } finally {
      state.busy = false;
      if (state.pending) { state.pending = false; onRoute(false); }
    }
  }

  /* ---------- Mobile menu ---------- */
  function closeDrawer() {
    const d = $('#drawer'); const b = $('#menu-btn'); if (!d) return;
    d.classList.remove('is-open'); d.setAttribute('inert', '');
    b.setAttribute('aria-expanded', 'false'); b.textContent = 'Menu';
  }
  function toggleDrawer() {
    const d = $('#drawer'); const b = $('#menu-btn');
    const open = !d.classList.contains('is-open');
    d.classList.toggle('is-open', open);
    if (open) d.removeAttribute('inert'); else d.setAttribute('inert', '');
    b.setAttribute('aria-expanded', String(open)); b.textContent = open ? 'Close' : 'Menu';
  }

  /* ---------- Intro ---------- */
  function runIntro() {
    const intro = $('#intro');
    if (!intro) return Promise.resolve();
    let seen = false; try { seen = sessionStorage.getItem('cp_intro') === '1'; } catch (e) { /* ignore */ }
    if (!canAnimate || seen) { intro.remove(); return Promise.resolve(); }
    try { sessionStorage.setItem('cp_intro', '1'); } catch (e) { /* ignore */ }
    play($('.intro__word', intro), [{ transform: 'translateY(105%)' }, { transform: 'translateY(0)' }], { duration: 750, easing: EASE_OUT });
    play($('.intro__sub', intro), [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 450, easing: 'ease-out' });
    const out = play(intro, [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: 800, delay: 1250, easing: EASE_IO });
    out.then(() => intro.remove());
    return wait(1250 + 350);
  }

  /* ---------- Events (clicks, inputs, keys) ---------- */
  async function copyLink(id, btn) {
    const url = location.href.split('#')[0] + '#/event/' + encodeURIComponent(id);
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
      const t = document.createElement('textarea'); t.value = url; t.setAttribute('readonly', '');
      t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
    }
    btn.textContent = ok ? 'Link copied' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
  }

  document.addEventListener('click', (e) => {
    if (e.target.id === 'panel-backdrop') { requestClose(); return; }
    const t = e.target.closest('a, button');
    if (!t) return;
    if (t.matches('a[data-open]')) { state.openedInApp = true; return; }
    if (t.id === 'menu-btn') { toggleDrawer(); return; }
    if (t.hasAttribute('data-close')) { requestClose(); return; }
    if (t.dataset.save) { toggleSave(t.dataset.save); return; }
    if (t.dataset.ics) { const ev = eventById(t.dataset.ics); if (ev) downloadText(slug(ev.title) + '.ics', buildIcs([ev])); return; }
    if (t.dataset.copy) { copyLink(t.dataset.copy, t); return; }
    if (t.dataset.tab) { state.f.tab = t.dataset.tab; renderResults('mask'); return; }
    if (t.dataset.cat) { state.clubCat = t.dataset.cat; renderClubList('mask'); return; }
    if (t.dataset.remove) {
      const row = t.closest('.sched-row');
      play(row, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in' }).then(() => { toggleSave(t.dataset.remove); renderScheduleList(false); });
      return;
    }
    if (t.dataset.act === 'clear' || t.id === 'f-clear') {
      Object.assign(state.f, { q: '', club: '', category: '' });
      $('#f-q').value = ''; $('#f-club').value = ''; $('#f-cat').value = '';
      renderResults('mask'); return;
    }
    if (t.dataset.act === 'to-upcoming') { state.f.tab = 'upcoming'; renderResults('mask'); return; }
    if (t.dataset.act === 'ics-all') {
      const list = savedEvents().filter((ev) => ev.bucket !== 'past');
      if (list.length) downloadText('campus-pulse-schedule.ics', buildIcs(list));
    }
  });

  let searchTimer = 0;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'f-q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.f.q = clean(e.target.value, 60); renderResults('none'); }, 120);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'f-club') { state.f.club = e.target.value; renderResults('mask'); }
    if (e.target.id === 'f-cat') { state.f.category = e.target.value; renderResults('mask'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.panelOpen) requestClose(); });

  window.addEventListener('hashchange', () => onRoute(false));
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { placeNavIndicator(false); placeTabIndicator(false); }, 100);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeNavIndicator(false); placeTabIndicator(false); });

  /* ---------- Start ---------- */
  async function init() {
    state.introPromise = runIntro();
    const yr = $('#year'); if (yr) yr.textContent = String(new Date().getFullYear());
    $('#drawer').setAttribute('inert', '');
    state.events = normalizeEvents(await loadRawEvents());
    updateBadges();
    await onRoute(true);
  }
  init();
})();
