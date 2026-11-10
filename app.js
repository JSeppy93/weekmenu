'use strict';

/* ================================================================
 * Weekmenu – planner voor het avondeten
 * Alles wordt lokaal opgeslagen (localStorage). Geen server, geen account.
 * ================================================================ */

const STORE_KEY = 'weekmenu.v1';
const GV_PORTIONS = 2; // glutenvrije porties per kookmoment: vriendin x 2 dagen
const RECIPE_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));
const SLOT_BY_KEY = Object.fromEntries(SLOTS.map(s => [s.key, s]));
const DAY_SHORT = { maandag: 'ma', dinsdag: 'di', woensdag: 'wo', donderdag: 'do', vrijdag: 'vr', zaterdag: 'za', zondag: 'zo' };

/* ---------------------------------------------------------------- datum */

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}
function iso(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function weeksBetween(a, b) {
  return Math.round((b - a) / (7 * 864e5));
}
const fmtDayMonth = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const fmtDay = new Intl.DateTimeFormat('nl-NL', { day: 'numeric' });
function weekLabel(monday) {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  return `${sameMonth ? fmtDay.format(monday) : fmtDayMonth.format(monday)} – ${fmtDayMonth.format(sunday)}`;
}

/* ---------------------------------------------------------------- opslag */

function defaultState() {
  return {
    version: 1,
    rotationAnchor: iso(mondayOf(new Date())), // deze maandag = rotatieweek 1
    portions: Object.fromEntries(SLOTS.map(s => [s.key, s.portions])),
    overrides: {}, // { '2026-11-09': { ma: 'chili' } }
    checked: {},   // { '2026-11-09': { 'Ui|st': true } }
    extras: {},    // { '2026-11-09': [{ id, text }] }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}

function normalizeState(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  return {
    version: 1,
    rotationAnchor: typeof s.rotationAnchor === 'string' ? s.rotationAnchor : d.rotationAnchor,
    portions: { ...d.portions, ...(s.portions || {}) },
    overrides: s.overrides || {},
    checked: s.checked || {},
    extras: s.extras || {},
  };
}

let state = loadState();
let saveFailed = false;

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    saveFailed = false;
  } catch (e) {
    if (!saveFailed) toast('Opslaan lukt niet in deze browser');
    saveFailed = true;
  }
}

// Vraag iOS/Chrome om de opslag niet automatisch op te ruimen.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

/* ---------------------------------------------------------------- planning */

const ui = {
  monday: mondayOf(new Date()),
  openSwap: null,
  navCount: 0,
};

function rotationIndex(monday) {
  const n = weeksBetween(parseIso(state.rotationAnchor), monday);
  return ((n % ROTATION.length) + ROTATION.length) % ROTATION.length;
}

function planFor(monday) {
  const base = ROTATION[rotationIndex(monday)];
  const ov = state.overrides[iso(monday)] || {};
  const plan = {};
  for (const s of SLOTS) {
    const id = ov[s.key] || base[s.key];
    plan[s.key] = RECIPE_BY_ID[id] ? id : base[s.key];
  }
  return plan;
}

function isOverridden(monday, slotKey) {
  const ov = state.overrides[iso(monday)];
  return !!(ov && ov[slotKey] && ov[slotKey] !== ROTATION[rotationIndex(monday)][slotKey]);
}

// Kandidaten om te wisselen: zelfde soort (vega/vis/soep), en niet in de vorige, huidige of volgende week.
function swapCandidates(monday, slotKey) {
  const plan = planFor(monday);
  const current = RECIPE_BY_ID[plan[slotKey]];
  const used = new Set();
  for (const m of [addDays(monday, -7), monday, addDays(monday, 7)]) {
    Object.values(planFor(m)).forEach(id => used.add(id));
  }
  return RECIPES.filter(r => r.type === current.type && !used.has(r.id));
}

function setOverride(monday, slotKey, recipeId) {
  const key = iso(monday);
  const ov = { ...(state.overrides[key] || {}) };
  if (!recipeId || recipeId === ROTATION[rotationIndex(monday)][slotKey]) delete ov[slotKey];
  else ov[slotKey] = recipeId;
  if (Object.keys(ov).length) state.overrides[key] = ov;
  else delete state.overrides[key];
  save();
}

/* ---------------------------------------------------------------- hoeveelheden */

function scaledQty(ing, portions) {
  if (ing.fixed || ing.s === 'gv') return ing.q;
  if (ing.s === 'normaal') return ing.q * Math.max(0, portions - GV_PORTIONS) / 2;
  return ing.q * portions / 4;
}

const UNITS = {
  st: ['', ''],
  teen: ['teen', 'tenen'],
  blik: ['blik', 'blikken'],
  blikje: ['blikje', 'blikjes'],
  stengel: ['stengel', 'stengels'],
  knol: ['knol', 'knollen'],
  pak: ['pak', 'pakken'],
  bos: ['bos', 'bossen'],
  g: ['g', 'g'],
  ml: ['ml', 'ml'],
  el: ['el', 'el'],
  tl: ['tl', 'tl'],
};

function fmtNum(x) {
  const whole = Math.floor(x + 1e-9);
  const frac = x - whole;
  const options = [[0, ''], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']];
  let best = options[0];
  let bestDiff = Infinity;
  for (const o of options) {
    const diff = Math.abs(frac - o[0]);
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  }
  const w = whole + (best[0] === 1 ? 1 : 0);
  if (!best[1]) return String(w);
  return w ? `${w}${best[1]}` : best[1];
}

function roundMass(q) {
  return q < 100 ? Math.round(q / 5) * 5 : Math.round(q / 10) * 10;
}

function qtyText(q, u) {
  if (u === 'snuf') return 'naar smaak';
  if (u === 'teen') q = Math.ceil(q - 1e-9); // halve teentjes bestaan niet
  const num = (u === 'g' || u === 'ml') ? String(roundMass(q)) : fmtNum(q);
  const labels = UNITS[u] || [u, u];
  const label = q >= 2 ? labels[1] : labels[0];
  return label ? `${num} ${label}` : num;
}

// Verdeling over dag 1 en dag 2: dag 2 is altijd voor 2 personen, de rest is voor dag 1.
function daySplit(portions) {
  const d2 = Math.min(2, portions);
  return [Math.max(0, portions - d2), d2];
}

function shareWord(part, total) {
  if (total <= 0 || part <= 0) return 'niets';
  if (part === total) return 'alles';
  const words = { '1/2': 'de helft', '1/3': 'een derde', '2/3': 'twee derde', '1/4': 'een kwart', '3/4': 'driekwart', '1/5': 'een vijfde', '2/5': 'twee vijfde', '3/5': 'drie vijfde', '4/5': 'vier vijfde' };
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(part, total);
  return words[`${part / g}/${total / g}`] || `${part} van de ${total} porties`;
}

// Vult {d1} (deel voor vandaag) en {d2} (deel voor dag 2) in de recepttekst in.
function fill(text, portions) {
  const [d1, d2] = daySplit(portions);
  return text.replace(/\{d1\}/g, shareWord(d1, portions)).replace(/\{d2\}/g, shareWord(d2, portions));
}

// In de winkel: naar boven afronden op hele stuks en ronde grammen.
function shopQty(q, u) {
  if (u === 'g' || u === 'ml') return q < 100 ? Math.ceil(q / 10 - 1e-9) * 10 : Math.ceil(q / 50 - 1e-9) * 50;
  if (u === 'el' || u === 'tl' || u === 'snuf') return q;
  return Math.ceil(q - 1e-9);
}

function ingName(ing) {
  return ing.note ? `${ing.n} (${ing.note})` : ing.n;
}

/* ---------------------------------------------------------------- boodschappenlijst */

function shoppingList(monday) {
  const plan = planFor(monday);
  const items = new Map();
  for (const slot of SLOTS) {
    const recipe = RECIPE_BY_ID[plan[slot.key]];
    const portions = state.portions[slot.key];
    for (const ing of recipe.ingredients) {
      const key = `${ing.n}|${ing.u}`;
      if (!items.has(key)) {
        items.set(key, { key, n: ing.n, u: ing.u, c: ing.c, note: ing.note, q: 0, days: [] });
      }
      const it = items.get(key);
      it.q += scaledQty(ing, portions);
      const day = DAY_SHORT[slot.day1];
      if (!it.days.includes(day)) it.days.push(day);
    }
  }
  const list = [...items.values()].map(it => ({ ...it, q: shopQty(it.q, it.u) }));
  for (const x of state.extras[iso(monday)] || []) {
    list.push({ key: `x:${x.id}`, n: x.text, c: 'eigen', extraId: x.id });
  }
  list.sort((a, b) => a.n.localeCompare(b.n, 'nl'));
  return list;
}

function shoppingText(monday) {
  const list = shoppingList(monday);
  const checked = state.checked[iso(monday)] || {};
  const lines = [`*Boodschappen ${weekLabel(monday)}*`];
  for (const cat of CATEGORIES) {
    const items = list.filter(i => i.c === cat.key && !checked[i.key]);
    if (!items.length) continue;
    lines.push('', `*${cat.label}*`);
    for (const i of items) lines.push(`• ${i.n}${i.u ? ` – ${qtyText(i.q, i.u)}` : ''}`);
  }
  return lines.join('\n');
}

/* ---------------------------------------------------------------- recepttekst voor WhatsApp */

function forWhomText(recipe, slot, portions) {
  if (!slot) return `${portions} porties`;
  if (slot.soup) return `Zondag · ${portions} porties (2 om te eten, ${Math.max(0, portions - 2)} voor de vriezer)`;
  const [d1, d2] = daySplit(portions);
  return `${cap(slot.day1)} voor ${d1} en ${slot.day2} voor ${d2} personen · ${portions} porties`;
}

function freshText(recipe, slot, portions) {
  if (!recipe.fresh) return '';
  const [d1, d2] = daySplit(portions);
  const day1 = slot ? slot.day1 : 'dag 1';
  const day2 = slot ? slot.day2 : 'dag 2';
  let t = `Bereid ${recipe.fresh} elke dag vers: ${d1} van de ${portions} porties op ${day1}, ${d2} op ${day2}.`;
  if (recipe.type === 'vis') t += ` Diepvries: haal het deel voor ${day2} de avond ervoor naar de koelkast.`;
  return t;
}

function recipeText(recipe, slot, portions) {
  const lines = [`*${recipe.name}*`, forWhomText(recipe, slot, portions), `⏱ ca. ${recipe.time} minuten`, '', '*Ingrediënten*'];
  for (const ing of recipe.ingredients) {
    lines.push(`• ${ingName(ing)}: ${qtyText(scaledQty(ing, portions), ing.u)}`);
  }
  lines.push('', '*Bereiding*');
  recipe.steps.forEach((s, i) => lines.push(`${i + 1}. ${fill(s, portions)}`));
  const fresh = freshText(recipe, slot, portions);
  if (fresh) lines.push('', `*Vers per dag:* ${fresh}`);
  if (recipe.day2 && !(slot && slot.soup)) lines.push('', `*Dag 2${slot ? ` (${slot.day2})` : ''}:* ${fill(recipe.day2, portions)}`);
  if (recipe.gfNote) lines.push('', `*Let op, glutenvrij:* ${recipe.gfNote}`);
  return lines.join('\n');
}

/* ---------------------------------------------------------------- hulpjes */

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

const TYPE_LABEL = { vega: 'Vega', vis: 'Vis', soep: 'Soep' };
function typeChip(type) {
  return `<span class="chip ${type}">${TYPE_LABEL[type]}</span>`;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

async function shareText(text, title) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Gekopieerd naar klembord');
  } catch (e) {
    toast('Delen lukt niet op dit apparaat');
  }
}

/* ---------------------------------------------------------------- views */

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');

function setChrome(title, tab, showBack) {
  titleEl.textContent = title;
  document.title = title === 'Weekmenu' ? 'Weekmenu' : `${title} · Weekmenu`;
  backBtn.hidden = !showBack;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
}

function weekNav() {
  const thisMonday = mondayOf(new Date());
  const offset = weeksBetween(thisMonday, ui.monday);
  const rel = offset === 0 ? 'Deze week' : offset === 1 ? 'Volgende week' : offset === -1 ? 'Vorige week' : offset > 0 ? `Over ${offset} weken` : `${-offset} weken geleden`;
  return `
    <div class="weeknav">
      <button class="iconbtn" data-action="week-prev" aria-label="Vorige week">‹</button>
      <div class="label"><strong>${rel}</strong><span>${weekLabel(ui.monday)} · rotatieweek ${rotationIndex(ui.monday) + 1}</span></div>
      <button class="iconbtn" data-action="week-next" aria-label="Volgende week">›</button>
    </div>
    ${offset !== 0 ? '<button class="today-link" data-action="week-today">Terug naar deze week</button>' : ''}`;
}

function renderWeek() {
  setChrome('Weekmenu', 'week', false);
  const plan = planFor(ui.monday);
  const today = new Date();
  const todayIso = iso(today);
  const cards = SLOTS.map(slot => {
    const r = RECIPE_BY_ID[plan[slot.key]];
    const portions = state.portions[slot.key];
    const d1 = addDays(ui.monday, slot.offset);
    const d2 = slot.soup ? null : addDays(d1, 1);
    const isToday = iso(d1) === todayIso || (d2 && iso(d2) === todayIso);
    const dates = d2 ? `${DAY_SHORT[slot.day1]} ${fmtDay.format(d1)} & ${DAY_SHORT[slot.day2]} ${fmtDay.format(d2)}` : `zo ${fmtDay.format(d1)}`;
    const href = `#/recept/${r.id}?w=${iso(ui.monday)}&s=${slot.key}`;
    const swapOpen = ui.openSwap === slot.key;
    let swap = '';
    if (swapOpen) {
      const cands = swapCandidates(ui.monday, slot.key);
      swap = `<div class="swap-list">
        ${cands.length ? `<div class="hint">Kies een ander ${r.type === 'soep' ? 'soeprecept' : r.type === 'vis' ? 'visgerecht' : 'vegagerecht'} (niet in de vorige, deze of volgende week):</div>` : '<div class="hint">Geen ander gerecht beschikbaar zonder herhaling binnen twee weken. Tijd voor nieuwe recepten!</div>'}
        ${cands.map(c => `<button data-action="swap-pick" data-slot="${slot.key}" data-id="${c.id}"><strong>${esc(c.name)}</strong><br><span class="hint">${esc(c.cuisine)} · ${c.time} min</span></button>`).join('')}
      </div>`;
    }
    return `
      <article class="card slot${isToday ? ' is-today' : ''}">
        <div class="when"><b>${slot.title}</b><span>${dates}</span></div>
        <a class="dish" href="${href}">${esc(r.name)}</a>
        <div class="meta">
          ${typeChip(r.type)}
          <span class="chip plain">⏱ ${r.time} min</span>
          <span class="chip plain">${portions} porties</span>
          ${slot.note ? `<span>${esc(slot.note)}</span>` : ''}
        </div>
        <div class="actions">
          <a class="btn small" href="${href}">Recept</a>
          <button class="btn small" data-action="swap-toggle" data-slot="${slot.key}">${swapOpen ? 'Sluiten' : '⇄ Wissel'}</button>
          ${isOverridden(ui.monday, slot.key) ? `<button class="btn small" data-action="swap-reset" data-slot="${slot.key}">Standaard</button>` : ''}
        </div>
        ${swap}
      </article>`;
  }).join('');
  const hero = `
    <figure class="hero">
      <img src="keuken.svg" width="640" height="424" alt="Jeroen staat te koken in zijn keuken">
    </figure>`;
  view.innerHTML = hero + weekNav() + cards + `
    <a class="btn primary block" href="#/lijst">🛒 Boodschappenlijst voor deze week</a>`;
}

function renderRecipe(id, params) {
  const recipe = RECIPE_BY_ID[id];
  if (!recipe) { location.hash = '#/recepten'; return; }
  const slot = SLOT_BY_KEY[params.get('s')] || null;
  const fromWeek = !!slot;
  if (ui.recipePortions == null || ui.recipeKey !== location.hash) {
    ui.recipeKey = location.hash;
    ui.recipePortions = slot ? state.portions[slot.key] : 4;
  }
  const portions = ui.recipePortions;
  setChrome(recipe.name, fromWeek ? 'week' : 'recepten', true);

  const ingredients = recipe.ingredients.map(ing => `
    <li><span class="q">${esc(qtyText(scaledQty(ing, portions), ing.u))}</span><span>${esc(ingName(ing))}</span></li>`).join('');
  const steps = recipe.steps.map(s => `<li>${esc(fill(s, portions))}</li>`).join('');
  const fresh = freshText(recipe, slot, portions);
  const showDay2 = recipe.day2 && !(slot && slot.soup);

  view.innerHTML = `
    <div class="recipe-head">
      <div class="meta">${typeChip(recipe.type)}<span class="chip plain">⏱ ca. ${recipe.time} min</span><span class="chip plain">${esc(recipe.cuisine)}</span></div>
      <h2>${esc(recipe.name)}</h2>
      <p>${esc(recipe.intro)}</p>
      <div class="for-whom">${esc(forWhomText(recipe, slot, portions))}</div>
      <div class="portions">
        <span>Porties</span>
        <button class="iconbtn" data-action="portions-dec" aria-label="Minder porties">−</button>
        <output>${portions}</output>
        <button class="iconbtn" data-action="portions-inc" aria-label="Meer porties">+</button>
      </div>
    </div>

    <div class="btnrow share">
      <a class="btn whatsapp" href="${whatsappUrl(recipeText(recipe, slot, portions))}" target="_blank" rel="noopener">Stuur via WhatsApp</a>
      <button class="btn" data-action="share-recipe">Delen…</button>
    </div>

    <h3>Ingrediënten</h3>
    <div class="card"><ul class="ingredients">${ingredients}</ul></div>

    <h3>Bereiding <span class="muted">· ca. ${recipe.time} min</span></h3>
    <ol class="steps">${steps}</ol>

    ${fresh ? `<div class="note fresh"><b>Vers per dag</b>${esc(fresh)}</div>` : ''}
    ${showDay2 ? `<div class="note day2"><b>Dag 2${slot ? ` · ${slot.day2}` : ''} (ca. ${recipe.day2Time || 15} min)</b>${esc(fill(recipe.day2, portions))}</div>` : ''}
    ${recipe.gfNote ? `<div class="note gf"><b>Let op, glutenvrij</b>${esc(recipe.gfNote)}</div>` : ''}
  `;

  view.onShareRecipe = () => shareText(recipeText(recipe, slot, portions), recipe.name);
}

function renderRecipes() {
  setChrome('Recepten', 'recepten', false);
  const groups = [
    ['vega', 'Vega hoofdgerechten'],
    ['vis', 'Visgerechten'],
    ['soep', 'Soepen'],
  ];
  view.innerHTML = `
    <p class="muted">${RECIPES.length} recepten. Alle hoofdgerechten zijn voor twee dagen, met een glutenvrije saus.</p>
    ${groups.map(([type, label]) => `
      <div class="section-title">${label}</div>
      ${RECIPES.filter(r => r.type === type).map(r => `
        <a class="list-link" href="#/recept/${r.id}">
          <span><strong>${esc(r.name)}</strong><small>${esc(r.cuisine)} · ${r.time} min</small></span>
          <span class="arrow">›</span>
        </a>`).join('')}
    `).join('')}`;
}

function renderList() {
  setChrome('Boodschappen', 'lijst', false);
  const wk = iso(ui.monday);
  const list = shoppingList(ui.monday);
  const checked = state.checked[wk] || {};
  const countable = list.filter(i => i.c !== 'voorraad');
  const done = countable.filter(i => checked[i.key]).length;
  const pct = countable.length ? Math.round(done / countable.length * 100) : 0;

  const itemHtml = i => `
    <li class="${checked[i.key] ? 'done' : ''}">
      <label>
        <input type="checkbox" data-action="check" data-key="${esc(i.key)}" ${checked[i.key] ? 'checked' : ''}>
        <span class="txt">${esc(i.n)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ''}${i.days && i.days.length ? `<span class="for">${i.days.join(' · ')}</span>` : ''}</span>
        ${i.u ? `<span class="amt">${esc(qtyText(i.q, i.u))}</span>` : ''}
        ${i.extraId ? `<button class="del" data-action="extra-del" data-id="${esc(i.extraId)}" aria-label="Verwijder">×</button>` : ''}
      </label>
    </li>`;

  const groups = CATEGORIES.filter(c => c.key !== 'voorraad' && c.key !== 'eigen').map(cat => {
    const items = list.filter(i => i.c === cat.key);
    if (!items.length) return '';
    const open = items.filter(i => !checked[i.key]).length;
    return `
      <section class="shop-group">
        <h3>${cat.label} <small>${open ? `${open} te gaan` : 'klaar ✓'}</small></h3>
        <ul class="shop-items">${items.map(itemHtml).join('')}</ul>
      </section>`;
  }).join('');

  const extras = list.filter(i => i.c === 'eigen');
  const pantry = list.filter(i => i.c === 'voorraad');

  view.innerHTML = weekNav() + `
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="progress-label">${done} van ${countable.length} afgevinkt</div>
    ${groups}
    <section class="shop-group">
      <h3>Eigen items <small>ontbijt, lunch, etc.</small></h3>
      ${extras.length ? `<ul class="shop-items">${extras.map(itemHtml).join('')}</ul>` : ''}
      <form class="addrow" data-action="extra-add">
        <input name="text" placeholder="Bijv. melk, havermout…" autocomplete="off" enterkeyhint="done" aria-label="Eigen item toevoegen">
        <button class="btn" type="submit">Toevoegen</button>
      </form>
    </section>
    <section class="shop-group">
      <details class="pantry">
        <summary>Check je voorraad <small>· olie, kruiden, specerijen (${pantry.length})</small></summary>
        <ul class="shop-items">${pantry.map(itemHtml).join('')}</ul>
      </details>
    </section>
    <div class="btnrow share">
      <button class="btn" data-action="share-list">Lijst delen…</button>
      <button class="btn danger" data-action="clear-checks">Vinkjes wissen</button>
    </div>`;
}

function renderSettings() {
  setChrome('Instellingen', 'instellingen', false);
  const thisMonday = mondayOf(new Date());
  const current = rotationIndex(thisMonday) + 1;
  view.innerHTML = `
    <section class="card">
      <h2>Rotatie</h2>
      <p class="muted">De 16 recepten draaien in een schema van 4 weken. Hier kies je welke rotatieweek deze week is.</p>
      <div class="setting">
        <span>Deze week (${weekLabel(thisMonday)})</span>
        <select data-action="rotation">
          ${ROTATION.map((_, i) => `<option value="${i + 1}" ${i + 1 === current ? 'selected' : ''}>Rotatieweek ${i + 1}</option>`).join('')}
        </select>
      </div>
    </section>

    <section class="card">
      <h2>Porties</h2>
      <p class="muted">Aantal porties per kookmoment. Glutenvrije pasta en brood blijven altijd voor ${GV_PORTIONS} porties.</p>
      ${SLOTS.map(s => `
        <div class="setting">
          <span>${s.title}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span>
          <input type="number" min="2" max="12" step="1" inputmode="numeric" value="${state.portions[s.key]}" data-action="portions" data-slot="${s.key}" aria-label="Porties ${s.title}">
        </div>`).join('')}
    </section>

    <section class="card">
      <h2>Back-up</h2>
      <p class="muted">iOS kan gegevens van web-apps wissen als je de app een paar weken niet opent. Maak af en toe een back-up (bijvoorbeeld naar Bestanden of iCloud Drive).</p>
      <div class="btnrow">
        <button class="btn" data-action="export">Back-up maken</button>
        <label class="btn">Back-up terugzetten<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
    </section>

    <section class="card">
      <h2>Op je beginscherm</h2>
      <p class="muted">Open deze pagina in Safari, tik op het deelicoon <b>⬆︎</b> en kies <b>Zet op beginscherm</b>. Daarna werkt de app ook zonder internet, handig in de winkel.</p>
    </section>

    <section class="card">
      <h2>Alles wissen</h2>
      <p class="muted">Zet de app terug naar de beginstand: rotatie, wissels, porties en vinkjes.</p>
      <button class="btn danger" data-action="reset">Alles wissen</button>
    </section>`;
}

/* ---------------------------------------------------------------- router */

function route() {
  const hash = location.hash || '#/week';
  const [path, qs] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  if (parts[0] !== 'recept') ui.recipePortions = null;
  if (params.get('w')) ui.monday = mondayOf(parseIso(params.get('w')));

  switch (parts[0]) {
    case 'recept': renderRecipe(parts[1], params); break;
    case 'recepten': renderRecipes(); break;
    case 'lijst': renderList(); break;
    case 'instellingen': renderSettings(); break;
    default: renderWeek();
  }
}

function rerender(keepScroll = true) {
  const y = window.scrollY;
  route();
  if (keepScroll) window.scrollTo(0, y);
}

window.addEventListener('hashchange', () => {
  ui.navCount++;
  ui.openSwap = null;
  route();
  window.scrollTo(0, 0);
});

backBtn.addEventListener('click', () => {
  if (ui.navCount > 0) history.back();
  else location.hash = '#/week';
});

/* ---------------------------------------------------------------- acties */

view.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;

  switch (a) {
    case 'week-prev': ui.monday = addDays(ui.monday, -7); ui.openSwap = null; rerender(false); break;
    case 'week-next': ui.monday = addDays(ui.monday, 7); ui.openSwap = null; rerender(false); break;
    case 'week-today': ui.monday = mondayOf(new Date()); ui.openSwap = null; rerender(false); break;
    case 'swap-toggle': ui.openSwap = ui.openSwap === el.dataset.slot ? null : el.dataset.slot; rerender(); break;
    case 'swap-pick':
      setOverride(ui.monday, el.dataset.slot, el.dataset.id);
      ui.openSwap = null;
      toast('Gerecht gewisseld');
      rerender();
      break;
    case 'swap-reset':
      setOverride(ui.monday, el.dataset.slot, null);
      toast('Terug naar het standaardschema');
      rerender();
      break;
    case 'portions-dec': ui.recipePortions = Math.max(2, ui.recipePortions - 1); rerender(); break;
    case 'portions-inc': ui.recipePortions = Math.min(12, ui.recipePortions + 1); rerender(); break;
    case 'share-recipe': view.onShareRecipe && view.onShareRecipe(); break;
    case 'share-list': shareText(shoppingText(ui.monday), 'Boodschappen'); break;
    case 'clear-checks':
      if (confirm('Alle vinkjes voor deze week wissen?')) {
        delete state.checked[iso(ui.monday)];
        save();
        rerender();
      }
      break;
    case 'extra-del': {
      e.preventDefault();
      const wk = iso(ui.monday);
      state.extras[wk] = (state.extras[wk] || []).filter(x => x.id !== el.dataset.id);
      if (state.checked[wk]) delete state.checked[wk][`x:${el.dataset.id}`];
      save();
      rerender();
      break;
    }
    case 'export': exportBackup(); break;
    case 'reset':
      if (confirm('Weet je het zeker? Alle wissels, porties en vinkjes worden gewist.')) {
        state = defaultState();
        save();
        toast('Alles is gewist');
        rerender(false);
      }
      break;
  }
});

view.addEventListener('change', e => {
  const el = e.target;
  const a = el.dataset.action;
  if (a === 'check') {
    const wk = iso(ui.monday);
    state.checked[wk] = state.checked[wk] || {};
    if (el.checked) state.checked[wk][el.dataset.key] = true;
    else delete state.checked[wk][el.dataset.key];
    save();
    rerender();
  } else if (a === 'rotation') {
    const n = Number(el.value);
    state.rotationAnchor = iso(addDays(mondayOf(new Date()), -(n - 1) * 7));
    save();
    toast(`Deze week is nu rotatieweek ${n}`);
  } else if (a === 'portions') {
    const n = Math.round(Number(el.value));
    if (n >= 2 && n <= 12) {
      state.portions[el.dataset.slot] = n;
      save();
      toast('Porties opgeslagen');
    } else {
      el.value = state.portions[el.dataset.slot];
      toast('Kies tussen 2 en 12 porties');
    }
  } else if (a === 'import') {
    importBackup(el.files && el.files[0]);
    el.value = '';
  }
});

view.addEventListener('submit', e => {
  const form = e.target.closest('[data-action="extra-add"]');
  if (!form) return;
  e.preventDefault();
  const text = form.elements.text.value.trim();
  if (!text) return;
  const wk = iso(ui.monday);
  state.extras[wk] = state.extras[wk] || [];
  state.extras[wk].push({ id: Date.now().toString(36), text: text.slice(0, 80) });
  save();
  rerender();
  const input = view.querySelector('.addrow input');
  if (input) input.focus();
});

/* ---------------------------------------------------------------- back-up */

async function exportBackup() {
  const data = JSON.stringify({ app: 'weekmenu', exported: new Date().toISOString(), state }, null, 2);
  const name = `weekmenu-backup-${iso(new Date())}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Weekmenu back-up' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'weekmenu' || !data.state) throw new Error('geen weekmenu-back-up');
    state = normalizeState(data.state);
    save();
    toast('Back-up teruggezet');
    rerender(false);
  } catch (e) {
    toast('Dit bestand is geen geldige back-up');
  }
}

/* ---------------------------------------------------------------- start */

route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
