'use strict';

/* ================================================================
 * Weekmenu – planner voor het avondeten
 * Alles wordt lokaal opgeslagen (localStorage). Geen server, geen account.
 *
 * Een week loopt van vrijdag t/m donderdag (boodschappen op donderdagavond).
 * Per week maak je een menu: de app kiest gerechten die je het langst niet
 * gegeten hebt, rekening houdend met dagen dat je uit eet of restjes eet.
 * ================================================================ */

const STORE_KEY = 'weekmenu.v1';
const RECIPE_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));
const SLOT_BY_KEY = Object.fromEntries(SLOTS.map(s => [s.key, s]));
const DAYS = [
  { key: 'vr', name: 'vrijdag' },
  { key: 'za', name: 'zaterdag' },
  { key: 'zo', name: 'zondag' },
  { key: 'ma', name: 'maandag' },
  { key: 'di', name: 'dinsdag' },
  { key: 'wo', name: 'woensdag' },
  { key: 'do', name: 'donderdag' },
].map((d, i) => ({ ...d, offset: i }));
const DAY_BY_KEY = Object.fromEntries(DAYS.map(d => [d.key, d]));
const STATUS_LABEL = { uit: 'uit eten', restjes: 'restjes', leeg: 'niet gepland' };
const MIN_PER_TYPE = { vega: 6, vis: 3, soep: 3 };

/* ---------------------------------------------------------------- datum */

function dayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date, n) {
  const d = dayStart(date);
  d.setDate(d.getDate() + n);
  return d;
}
// De vrijdag waarop de week van deze datum begint.
function weekStart(date) {
  return addDays(date, -((date.getDay() - 5 + 7) % 7));
}
function mondayOf(date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}
function iso(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function parseIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const fmtDayMonth = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const fmtDay = new Intl.DateTimeFormat('nl-NL', { day: 'numeric' });
function weekLabel(weekKey) {
  const start = parseIso(weekKey);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  return `vr ${sameMonth ? fmtDay.format(start) : fmtDayMonth.format(start)} – do ${fmtDayMonth.format(end)}`;
}
function curKey() { return iso(weekStart(new Date())); }
function nextKey() { return iso(addDays(weekStart(new Date()), 7)); }
function shiftKey(weekKey, weeks) { return iso(addDays(parseIso(weekKey), weeks * 7)); }
function dayDate(weekKey, dayKey) { return addDays(parseIso(weekKey), DAY_BY_KEY[dayKey].offset); }

/* ---------------------------------------------------------------- opslag */

function defaultState() {
  return {
    version: 2,
    portions: Object.fromEntries(SLOTS.map(s => [s.key, s.portions])),
    weeks: {},    // { '2026-11-13': { status: 'concept'|'vast', days: { vr: { s: 'thuis', n: 4 }, … }, slots: { vr: 'chili', … } } }
    checked: {},  // { '2026-11-13': { 'Ui|st': true } }
    extras: {},   // { '2026-11-13': [{ id, text }] }
    removed: [],  // id's van recepten die je niet meer wilt
    pantry: {},   // voorraadcheck per week: { '2026-11-13': { 'Olijfolie': 'heb' | 'koop' } }
  };
}

// Standaardbezetting: dag 2 van een blok is voor 2 eters, de rest eet op dag 1. Zondag telt in porties soep.
function defaultDays(portions) {
  const days = {};
  for (const s of SLOTS) {
    const p = portions[s.key];
    if (s.soup) {
      days[s.days[0]] = { s: 'thuis', n: p };
    } else {
      const d2 = Math.min(2, p);
      days[s.days[0]] = { s: 'thuis', n: Math.max(1, p - d2) };
      days[s.days[1]] = { s: 'thuis', n: d2 };
    }
  }
  return days;
}

function normalizeWeek(w, portions) {
  const base = defaultDays(portions);
  const days = {};
  for (const d of DAYS) {
    const src = (w.days || {})[d.key] || {};
    const n = Math.round(Number(src.n));
    days[d.key] = {
      s: ['thuis', 'uit', 'restjes', 'leeg'].includes(src.s) ? src.s : 'thuis',
      n: n >= 1 && n <= 12 ? n : base[d.key].n,
    };
  }
  const slots = {};
  for (const s of SLOTS) {
    const id = (w.slots || {})[s.key];
    if (typeof id === 'string' && RECIPE_BY_ID[id]) slots[s.key] = id;
  }
  return { status: w.status === 'vast' ? 'vast' : 'concept', days, slots };
}

function normalizeState(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  if (s.version !== 2) return migrateV1(s);
  const portions = { ...d.portions, ...(s.portions || {}) };
  const weeks = {};
  for (const [k, w] of Object.entries(s.weeks || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && w && typeof w === 'object') weeks[k] = normalizeWeek(w, portions);
  }
  return {
    version: 2,
    portions,
    weeks,
    checked: s.checked || {},
    extras: s.extras || {},
    removed: Array.isArray(s.removed) ? s.removed.filter(id => typeof id === 'string') : [],
    pantry: s.pantry && typeof s.pantry === 'object' ? s.pantry : {},
  };
}

// Oude versie (vast schema van 4 weken, week vanaf maandag) omzetten: de lopende week wordt het eerste vastgelegde menu.
function migrateV1(s) {
  const st = defaultState();
  st.portions = { ...st.portions, ...(s.portions || {}) };
  if (typeof s.rotationAnchor !== 'string') return st;
  const anchor = parseIso(s.rotationAnchor);
  const cur = weekStart(new Date());
  const week = { status: 'vast', days: defaultDays(st.portions), slots: {} };
  let any = false;
  for (const slot of SLOTS) {
    const date = addDays(cur, slot.offset);
    if (date < anchor) { // van vóór de app: niet verzinnen wat er gegeten is
      slot.days.forEach(k => { week.days[k].s = 'leeg'; });
      continue;
    }
    const mon = mondayOf(date);
    const n = Math.round((mon - anchor) / (7 * 864e5));
    const base = ROTATION[((n % ROTATION.length) + ROTATION.length) % ROTATION.length];
    const ov = (s.overrides || {})[iso(mon)] || {};
    week.slots[slot.key] = RECIPE_BY_ID[ov[slot.key]] ? ov[slot.key] : base[slot.key];
    any = true;
  }
  if (any) st.weeks[iso(cur)] = week;
  for (const field of ['extras', 'checked']) {
    for (const [k, v] of Object.entries(s[field] || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) st[field][iso(weekStart(parseIso(k)))] = v;
    }
  }
  return st;
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
save(); // legt een eventuele omzetting van de oude versie meteen vast

// Vraag iOS/Chrome om de opslag niet automatisch op te ruimen.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

/* ---------------------------------------------------------------- weekmenu */

const ui = {
  weekSel: 'cur',
  openSwap: null,
  navCount: 0,
};

function activeRecipes() {
  return RECIPES.filter(r => !state.removed.includes(r.id));
}

function fixedWeek(key) {
  const w = state.weeks[key];
  return w && w.status === 'vast' ? w : null;
}

// Porties per dag van een kookblok: [dag 1, dag 2]. Een dag telt alleen mee als er thuis gegeten wordt.
function slotSplit(week, slot) {
  const n = k => (k && week.days[k].s === 'thuis' ? week.days[k].n : 0);
  return [n(slot.days[0]), n(slot.days[1])];
}

function slotInfo(week, slot) {
  const split = slotSplit(week, slot);
  const portions = split[0] + split[1];
  const single = !slot.soup && (split[0] === 0 || split[1] === 0);
  return {
    split,
    portions,
    single,
    cookDay: split[0] > 0 || slot.soup ? slot.days[0] : slot.days[1],
    recipe: portions > 0 ? RECIPE_BY_ID[week.slots[slot.key]] || null : null,
  };
}

// Kookcontext voor een recept: hoeveel porties, verdeeld over welke dagen.
function makeCtx(slot, split, single) {
  return {
    slot,
    split,
    single,
    portions: split[0] + split[1],
    gv: slot && !slot.soup && single ? 1 : 2, // glutenvrije porties: vriendin x aantal dagen
    cookDay: slot ? DAY_BY_KEY[split[0] > 0 || slot.soup ? slot.days[0] : slot.days[1]].name : null,
  };
}

function weekDishes(week) {
  const out = [];
  for (const slot of SLOTS) {
    const info = slotInfo(week, slot);
    if (info.recipe) out.push({ slot, info, id: info.recipe.id });
  }
  return out;
}

// Alles wat in vastgelegde weken gekookt is of gaat worden.
function eatenLog() {
  const log = [];
  for (const [key, week] of Object.entries(state.weeks)) {
    if (week.status !== 'vast') continue;
    for (const d of weekDishes(week)) log.push({ id: d.id, weekKey: key, date: iso(dayDate(key, d.info.cookDay)) });
  }
  return log;
}

function lastEatenBefore(weekKey) {
  const last = {};
  for (const e of eatenLog()) {
    if (e.weekKey < weekKey && (!last[e.id] || e.date > last[e.id])) last[e.id] = e.date;
  }
  return last;
}

function idsInWeek(key) {
  const w = state.weeks[key];
  return w ? weekDishes(w).map(d => d.id) : [];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Kies een recept van dit type: niet uit de vorige week, liefst het langst geleden gegeten en een andere keuken.
function pickRecipe(weekKey, type, usedIds, usedCuisines) {
  const pool = activeRecipes().filter(r => r.type === type);
  const recent = new Set(idsInWeek(shiftKey(weekKey, -1)));
  let elig = pool.filter(r => !usedIds.has(r.id) && !recent.has(r.id));
  if (!elig.length) elig = pool.filter(r => !usedIds.has(r.id));
  if (!elig.length) return null;
  const last = lastEatenBefore(weekKey);
  const sorted = shuffle(elig).sort((a, b) => (last[a.id] || '').localeCompare(last[b.id] || ''));
  const top = sorted.slice(0, 3);
  const otherCuisine = top.filter(r => !usedCuisines.has(r.cuisine));
  const from = otherCuisine.length ? otherCuisine : top;
  return from[Math.floor(Math.random() * from.length)];
}

// Vult de kookblokken zonder gerecht. Met reroll worden alle gerechten opnieuw gekozen.
function fillWeek(weekKey, reroll) {
  const week = state.weeks[weekKey];
  const active = SLOTS.filter(s => slotInfo(week, s).portions > 0);
  if (reroll) active.forEach(s => { delete week.slots[s.key]; });
  const has = s => !!RECIPE_BY_ID[week.slots[s.key]];
  const usedIds = new Set(active.filter(has).map(s => week.slots[s.key]));
  const usedCuisines = new Set([...usedIds].map(id => RECIPE_BY_ID[id].cuisine));
  const mains = active.filter(s => !s.soup);
  const hasFish = mains.some(s => has(s) && RECIPE_BY_ID[week.slots[s.key]].type === 'vis');
  const emptyMains = mains.filter(s => !has(s));
  const fishSlot = !hasFish && emptyMains.length ? emptyMains[Math.floor(Math.random() * emptyMains.length)] : null;
  for (const slot of active) {
    if (has(slot)) continue;
    const types = slot.soup ? ['soep'] : slot === fishSlot ? ['vis', 'vega'] : ['vega', 'vis'];
    let r = null;
    for (const t of types) { r = pickRecipe(weekKey, t, usedIds, usedCuisines); if (r) break; }
    if (!r) continue;
    week.slots[slot.key] = r.id;
    usedIds.add(r.id);
    usedCuisines.add(r.cuisine);
  }
}

function ensureDraft(weekKey) {
  if (!state.weeks[weekKey]) {
    state.weeks[weekKey] = { status: 'concept', days: defaultDays(state.portions), slots: {} };
    fillWeek(weekKey, false);
    save();
  }
  return state.weeks[weekKey];
}

// Kandidaten om te wisselen: niet in de vorige, deze of volgende week. Langst geleden gegeten bovenaan.
function swapCandidates(weekKey, slot) {
  const used = new Set([...idsInWeek(shiftKey(weekKey, -1)), ...idsInWeek(weekKey), ...idsInWeek(shiftKey(weekKey, 1))]);
  const last = lastEatenBefore(weekKey);
  return activeRecipes()
    .filter(r => (slot.soup ? r.type === 'soep' : r.type !== 'soep') && !used.has(r.id))
    .sort((a, b) => (last[a.id] || '').localeCompare(last[b.id] || '') || a.name.localeCompare(b.name, 'nl'))
    .map(r => ({ r, last: last[r.id] }));
}

// De boodschappenlijst hoort bij het laatst vastgelegde menu.
function listWeekKey() {
  if (fixedWeek(nextKey())) return nextKey();
  if (fixedWeek(curKey())) return curKey();
  return null;
}

/* ---------------------------------------------------------------- hoeveelheden */

function scaledQty(ing, portions, gv = 2) {
  if (ing.fixed) return ing.q;
  if (ing.s === 'gv') return ing.q * gv / 2;
  if (ing.s === 'normaal') return ing.q * Math.max(0, portions - gv) / 2;
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

// Standaardverdeling over dag 1 en dag 2: dag 2 is voor 2 personen, de rest is voor dag 1.
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
function fill(text, ctx) {
  const d1 = ctx.single ? ctx.portions : ctx.split[0];
  const d2 = ctx.single ? 0 : ctx.split[1];
  return text.replace(/\{d1\}/g, shareWord(d1, ctx.portions)).replace(/\{d2\}/g, shareWord(d2, ctx.portions));
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

// Indeling van de winkellijst. Voorraad (olie, kruiden) staat er alleen op als je bij de check 'Kopen' koos.
const LIST_CATS = [
  ...CATEGORIES.filter(c => c.key !== 'voorraad' && c.key !== 'eigen'),
  { key: 'aanvullen', label: 'Voorraad aanvullen' },
];

// Voorraadartikelen die de gerechten van deze week nodig hebben, met de status uit de check.
function pantryItems(weekKey) {
  const marks = state.pantry[weekKey] || {};
  const items = new Map();
  for (const { info } of weekDishes(state.weeks[weekKey])) {
    for (const ing of info.recipe.ingredients) {
      if (ing.c !== 'voorraad') continue;
      if (!items.has(ing.n)) items.set(ing.n, { n: ing.n, days: [], mark: marks[ing.n] || null });
      const it = items.get(ing.n);
      if (!it.days.includes(info.cookDay)) it.days.push(info.cookDay);
    }
  }
  return [...items.values()].sort((a, b) => a.n.localeCompare(b.n, 'nl'));
}

function shoppingList(weekKey) {
  const week = state.weeks[weekKey];
  const items = new Map();
  for (const { slot, info } of weekDishes(week)) {
    const ctx = makeCtx(slot, info.split, info.single);
    for (const ing of info.recipe.ingredients) {
      if (ing.c === 'voorraad') continue;
      const q = scaledQty(ing, ctx.portions, ctx.gv);
      if (q <= 0) continue;
      const key = `${ing.n}|${ing.u}`;
      if (!items.has(key)) {
        items.set(key, { key, n: ing.n, u: ing.u, c: ing.c, note: ing.note, q: 0, days: [] });
      }
      const it = items.get(key);
      it.q += q;
      if (!it.days.includes(info.cookDay)) it.days.push(info.cookDay);
    }
  }
  const list = [...items.values()].map(it => ({ ...it, q: shopQty(it.q, it.u) }));
  for (const p of pantryItems(weekKey)) {
    if (p.mark === 'koop') list.push({ key: `v:${p.n}`, n: p.n, c: 'aanvullen', days: p.days });
  }
  for (const x of state.extras[weekKey] || []) {
    list.push({ key: `x:${x.id}`, n: x.text, c: 'eigen', extraId: x.id });
  }
  list.sort((a, b) => a.n.localeCompare(b.n, 'nl'));
  return list;
}

function shoppingText(weekKey) {
  const list = shoppingList(weekKey);
  const checked = state.checked[weekKey] || {};
  const lines = [`*Boodschappen ${weekLabel(weekKey)}*`];
  for (const cat of [...LIST_CATS, { key: 'eigen', label: 'Eigen items' }]) {
    const items = list.filter(i => i.c === cat.key && !checked[i.key]);
    if (!items.length) continue;
    lines.push('', `*${cat.label}*`);
    for (const i of items) lines.push(`• ${i.n}${i.u ? ` – ${qtyText(i.q, i.u)}` : ''}`);
  }
  return lines.join('\n');
}

/* ---------------------------------------------------------------- recepttekst */

function portionWord(n) { return n === 1 ? '1 portie' : `${n} porties`; }
function personWord(n) { return n === 1 ? '1 persoon' : `${n} personen`; }

function forWhomText(ctx) {
  const { slot, portions } = ctx;
  if (!slot) return portionWord(portions);
  if (slot.soup) return `Zondag · ${portionWord(portions)} (2 om te eten, ${Math.max(0, portions - 2)} voor de vriezer)`;
  if (ctx.single) return `Alleen ${ctx.cookDay}, voor ${personWord(portions)} · ${portionWord(portions)}`;
  return `${cap(slot.day1)} voor ${ctx.split[0]} en ${slot.day2} voor ${personWord(ctx.split[1])} · ${portionWord(portions)}`;
}

function singleText(ctx) {
  if (!ctx.single) return '';
  return 'Deze week kook je dit gerecht voor één dag. Je hoeft niets apart te houden: sla de aanwijzingen over bewaren voor dag 2 over.';
}

function freshText(recipe, ctx) {
  if (!recipe.fresh || ctx.single) return '';
  const { slot, portions } = ctx;
  const [d1, d2] = ctx.split;
  const day1 = slot ? slot.day1 : 'dag 1';
  const day2 = slot ? slot.day2 : 'dag 2';
  let t = `Bereid ${recipe.fresh} elke dag vers: ${d1} van de ${portions} porties op ${day1}, ${d2} op ${day2}.`;
  if (recipe.type === 'vis') t += ` Diepvries: haal het deel voor ${day2} de avond ervoor naar de koelkast.`;
  return t;
}

function showDay2(recipe, ctx) {
  return !!recipe.day2 && !ctx.single && !(ctx.slot && ctx.slot.soup);
}

function recipeText(recipe, ctx) {
  const lines = [`*${recipe.name}*`, forWhomText(ctx), `⏱ ca. ${recipe.time} minuten`, '', '*Ingrediënten*'];
  for (const ing of recipe.ingredients) {
    const q = scaledQty(ing, ctx.portions, ctx.gv);
    if (q > 0) lines.push(`• ${ingName(ing)}: ${qtyText(q, ing.u)}`);
  }
  lines.push('', '*Bereiding*');
  recipe.steps.forEach((s, i) => lines.push(`${i + 1}. ${fill(s, ctx)}`));
  const single = singleText(ctx);
  if (single) lines.push('', `*Eén dag:* ${single}`);
  const fresh = freshText(recipe, ctx);
  if (fresh) lines.push('', `*Vers per dag:* ${fresh}`);
  if (showDay2(recipe, ctx)) lines.push('', `*Dag 2${ctx.slot ? ` (${ctx.slot.day2})` : ''}:* ${fill(recipe.day2, ctx)}`);
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
  document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
}

function relLabel(weekKey) {
  return weekKey === curKey() ? 'Deze week' : weekKey === nextKey() ? 'Volgende week' : 'Week';
}

function weekHead(weekKey, extra) {
  return `<div class="weekhead"><strong>${relLabel(weekKey)}</strong><span>${weekLabel(weekKey)}${extra ? ` · ${extra}` : ''}</span></div>`;
}

// Kaart voor één kookblok. Met edit erbij: wisselknop (in het planscherm).
function slotCard(weekKey, week, slot, edit) {
  const info = slotInfo(week, slot);
  const todayIso = iso(new Date());
  const dayBits = slot.days.map(k => ({ k, d: week.days[k], date: dayDate(weekKey, k) }));
  const on = dayBits.filter(b => b.d.s === 'thuis');
  const offText = dayBits.filter(b => b.d.s !== 'thuis').map(b => `${DAY_BY_KEY[b.k].name} ${STATUS_LABEL[b.d.s]}`).join(', ');
  const dates = (on.length ? on : dayBits).map(b => `${b.k} ${fmtDay.format(b.date)}`).join(' & ');
  const when = `<div class="when"><b>${slot.title}</b><span>${dates}</span></div>`;

  if (!info.portions) {
    // Leeg blok: aantikken om er zelf een gerecht in te zetten.
    const fillOpen = ui.openFill === slot.key;
    const options = fillOpen ? activeRecipes()
      .filter(c => (slot.soup ? c.type === 'soep' : c.type !== 'soep'))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'nl')) : [];
    return `
      <article class="card slot off" data-action="fill-toggle" data-slot="${slot.key}">
        ${when}
        <div class="offtext">${esc(cap(offText))}</div>
        <div class="actions"><button class="btn small">${fillOpen ? 'Sluiten' : 'Gerecht kiezen'}</button></div>
        ${fillOpen ? `<div class="swap-list">
          <div class="hint">Kies wat er in dit blok gegeten is of wordt. De dagen komen dan op thuis eten te staan.</div>
          ${options.map(c => `<button data-action="fill-pick" data-week="${weekKey}" data-slot="${slot.key}" data-id="${c.id}"><strong>${esc(c.name)}</strong><br><span class="hint">${TYPE_LABEL[c.type]} · ${esc(c.cuisine)} · ${c.time} min</span></button>`).join('')}
        </div>` : ''}
      </article>`;
  }

  const r = info.recipe;
  const isToday = on.some(b => iso(b.date) === todayIso);
  const swapOpen = edit && ui.openSwap === slot.key;
  let swap = '';
  if (swapOpen) {
    const cands = swapCandidates(weekKey, slot);
    swap = `<div class="swap-list">
      ${cands.length ? '<div class="hint">Kies een ander gerecht. Bovenaan staat wat je het langst niet gegeten hebt.</div>' : '<div class="hint">Geen ander gerecht beschikbaar zonder herhaling. Tijd voor nieuwe recepten!</div>'}
      ${cands.map(c => `<button data-action="swap-pick" data-slot="${slot.key}" data-id="${c.r.id}"><strong>${esc(c.r.name)}</strong><br><span class="hint">${TYPE_LABEL[c.r.type]} · ${esc(c.r.cuisine)} · ${c.r.time} min · ${c.last ? `laatst ${fmtDayMonth.format(parseIso(c.last))}` : 'nog niet gegeten'}</span></button>`).join('')}
    </div>`;
  }
  const swapBtn = edit ? `<button class="btn small" data-action="swap-toggle" data-slot="${slot.key}">${swapOpen ? 'Sluiten' : 'Wissel'}</button>` : '';

  if (!r) {
    return `<article class="card slot">${when}<div class="offtext">Geen recept beschikbaar voor dit blok.</div><div class="actions">${swapBtn}</div>${swap}</article>`;
  }
  const href = `#/recept/${r.id}?w=${weekKey}&s=${slot.key}`;
  const notes = [];
  if (info.single) notes.push(`Alleen ${DAY_BY_KEY[info.cookDay].name} koken · ${offText}`);
  else if (slot.note) notes.push(slot.note);
  return `
    <article class="card slot${isToday ? ' is-today' : ''}">
      ${when}
      <a class="dish" href="${href}">${esc(r.name)}</a>
      <div class="meta">
        ${typeChip(r.type)}
        <span class="chip plain">⏱ ${r.time} min</span>
        <span class="chip plain">${portionWord(info.portions)}</span>
        ${notes.map(n => `<span>${esc(n)}</span>`).join('')}
      </div>
      <div class="actions">
        <a class="btn small" href="${href}">Recept</a>
        ${swapBtn}
      </div>
      ${swap}
    </article>`;
}

function nextWeekCta() {
  const nk = nextKey();
  const draft = state.weeks[nk];
  return `
    <section class="card cta">
      <h2>Menu voor volgende week</h2>
      <p class="muted">${weekLabel(nk)}. ${draft ? 'Je concept staat klaar.' : 'Maak het menu vóór je boodschappen doet.'}</p>
      <a class="btn primary block" href="#/plan/${nk}">${draft ? 'Verder met het concept' : 'Menu maken'}</a>
    </section>`;
}

function renderWeek() {
  setChrome('Weekmenu', 'week', false);
  const ck = curKey();
  const nk = nextKey();
  const hasNext = !!fixedWeek(nk);
  const sel = ui.weekSel === 'next' && hasNext ? nk : ck;
  const week = fixedWeek(sel);
  const dow = new Date().getDay();
  const ctaFirst = dow === 3 || dow === 4; // woensdag en donderdag: plannen staat bovenaan

  const hero = `
    <figure class="hero">
      <img src="keuken.svg" width="640" height="424" alt="Jeroen staat te koken in zijn keuken">
    </figure>`;
  const switcher = hasNext ? `
    <div class="seg wide" role="group" aria-label="Week kiezen">
      <button data-action="week-sel" data-sel="cur" class="${sel === ck ? 'on' : ''}">Deze week</button>
      <button data-action="week-sel" data-sel="next" class="${sel === nk ? 'on' : ''}">Volgende week</button>
    </div>` : '';
  const cta = hasNext ? '' : nextWeekCta();

  let body;
  if (week) {
    body = SLOTS.map(slot => slotCard(sel, week, slot, false)).join('') + `
      <div class="btnrow">
        ${listWeekKey() === sel ? '<a class="btn primary" href="#/lijst">Boodschappenlijst</a>' : ''}
        <a class="btn" href="#/plan/${sel}">Menu aanpassen</a>
      </div>`;
  } else {
    const draft = state.weeks[sel];
    body = `
      <section class="card empty">
        <p>Er is nog geen menu voor deze week.</p>
        <a class="btn block" href="#/plan/${sel}">${draft ? 'Verder met het concept' : 'Menu maken voor deze week'}</a>
      </section>`;
  }
  view.innerHTML = hero + (ctaFirst ? cta : '') + switcher + weekHead(sel) + body + (ctaFirst ? '' : cta);
}

function renderPlan(weekKey) {
  if (weekKey !== curKey() && weekKey !== nextKey()) { location.replace('#/week'); return; }
  const week = ensureDraft(weekKey);
  ui.planKey = weekKey;
  const isDraft = week.status !== 'vast';
  setChrome(isDraft ? 'Menu maken' : 'Menu aanpassen', 'week', true);

  const dayRows = SLOTS.map(slot => `
    <div class="daygroup">
      ${slot.days.map(k => {
        const d = week.days[k];
        const hint = k === 'zo' ? 'porties soep' : 'eters';
        return `
        <div class="dayrow">
          <div class="dayname"><b>${cap(DAY_BY_KEY[k].name)}</b><span>${fmtDayMonth.format(dayDate(weekKey, k))}</span></div>
          <div class="seg" role="group" aria-label="${cap(DAY_BY_KEY[k].name)}">
            ${[['thuis', 'Thuis'], ['uit', 'Uit eten'], ['restjes', 'Restjes']].map(([s, label]) => `<button data-action="day-status" data-day="${k}" data-s="${s}" class="${d.s === s ? 'on' : ''}" aria-pressed="${d.s === s}">${label}</button>`).join('')}
          </div>
          ${d.s === 'thuis' ? `
          <div class="stepper">
            <span>${hint}</span>
            <button class="iconbtn" data-action="day-dec" data-day="${k}" aria-label="Minder ${hint}">−</button>
            <output>${d.n}</output>
            <button class="iconbtn" data-action="day-inc" data-day="${k}" aria-label="Meer ${hint}">+</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('');

  view.innerHTML = weekHead(weekKey, isDraft ? 'concept' : 'vastgelegd') + `
    <h3>Wie eet wanneer?</h3>
    <p class="muted">Geef aan wat er deze week afwijkt. Bij uit eten of restjes kookt de app alleen voor de andere dag van het blok.</p>
    <section class="card days">${dayRows}</section>

    <h3>Menu</h3>
    ${SLOTS.map(slot => slotCard(weekKey, week, slot, true)).join('')}

    <div class="btnrow">
      <button class="btn" data-action="reroll">Opnieuw kiezen</button>
      ${isDraft ? '<button class="btn primary" data-action="plan-fix">Menu vastleggen</button>' : '<a class="btn primary" href="#/week">Klaar</a>'}
    </div>
    ${isDraft ? '<button class="today-link" data-action="plan-discard">Concept weggooien</button>' : ''}`;
}

function renderRecipe(id, params) {
  const recipe = RECIPE_BY_ID[id];
  if (!recipe) { location.hash = '#/recepten'; return; }
  const week = state.weeks[params.get('w')];
  const slot = week ? SLOT_BY_KEY[params.get('s')] || null : null;
  const base = slot ? slotInfo(week, slot) : null;
  const inPlan = !!(base && base.portions);
  if (ui.recipeSplit == null || ui.recipeKey !== location.hash) {
    ui.recipeKey = location.hash;
    ui.recipeSplit = inPlan ? base.split.slice() : daySplit(4);
  }
  const ctx = makeCtx(inPlan ? slot : null, ui.recipeSplit, inPlan && base.single);
  const portions = ctx.portions;
  const removed = state.removed.includes(id);
  setChrome(recipe.name, inPlan ? 'week' : 'recepten', true);

  const ingredients = recipe.ingredients
    .map(ing => [ing, scaledQty(ing, portions, ctx.gv)])
    .filter(([, q]) => q > 0)
    .map(([ing, q]) => `<li><span class="q">${esc(qtyText(q, ing.u))}</span><span>${esc(ingName(ing))}</span></li>`).join('');
  const steps = recipe.steps.map(s => `<li>${esc(fill(s, ctx))}</li>`).join('');
  const single = singleText(ctx);
  const fresh = freshText(recipe, ctx);
  const log = eatenLog().filter(e => e.id === id && e.date <= iso(new Date())).map(e => e.date).sort();
  const eaten = log.length ? `Laatst gegeten op ${fmtDayMonth.format(parseIso(log[log.length - 1]))} · ${log.length}× in totaal` : 'Nog niet gegeten';

  view.innerHTML = `
    <div class="recipe-head">
      <div class="meta">${typeChip(recipe.type)}<span class="chip plain">⏱ ca. ${recipe.time} min</span><span class="chip plain">${esc(recipe.cuisine)}</span></div>
      <h2>${esc(recipe.name)}</h2>
      <p>${esc(recipe.intro)}</p>
      <div class="for-whom">${esc(forWhomText(ctx))}</div>
      <div class="portions">
        <span>Porties</span>
        <button class="iconbtn" data-action="portions-dec" aria-label="Minder porties">−</button>
        <output>${portions}</output>
        <button class="iconbtn" data-action="portions-inc" aria-label="Meer porties">+</button>
      </div>
    </div>

    <div class="btnrow share">
      <a class="btn whatsapp" href="${whatsappUrl(recipeText(recipe, ctx))}" target="_blank" rel="noopener">Stuur via WhatsApp</a>
      <button class="btn" data-action="share-recipe">Delen…</button>
    </div>

    ${single ? `<div class="note gf"><b>Eén dag</b>${esc(single)}</div>` : ''}

    <h3>Ingrediënten</h3>
    <div class="card"><ul class="ingredients">${ingredients}</ul></div>

    <h3>Bereiding <span class="muted">· ca. ${recipe.time} min</span></h3>
    <ol class="steps">${steps}</ol>

    ${fresh ? `<div class="note fresh"><b>Vers per dag</b>${esc(fresh)}</div>` : ''}
    ${showDay2(recipe, ctx) ? `<div class="note day2"><b>Dag 2${ctx.slot ? ` · ${ctx.slot.day2}` : ''} (ca. ${recipe.day2Time || 15} min)</b>${esc(fill(recipe.day2, ctx))}</div>` : ''}
    ${recipe.gfNote ? `<div class="note gf"><b>Let op, glutenvrij</b>${esc(recipe.gfNote)}</div>` : ''}

    <section class="manage">
      <p class="muted">${eaten}${removed ? ' · Dit recept is verwijderd en komt niet meer in nieuwe menu’s.' : ''}</p>
      ${removed
        ? `<button class="btn" data-action="recipe-restore" data-id="${id}">Recept terugzetten</button>`
        : `<button class="btn danger" data-action="recipe-remove" data-id="${id}">Recept verwijderen</button>`}
    </section>
  `;

  view.onShareRecipe = () => shareText(recipeText(recipe, ctx), recipe.name);
}

function renderRecipes() {
  setChrome('Recepten', 'recepten', false);
  const todayIso = iso(new Date());
  const stats = {};
  for (const e of eatenLog()) {
    if (e.date > todayIso) continue;
    const s = stats[e.id] || (stats[e.id] = { n: 0, last: '' });
    s.n++;
    if (e.date > s.last) s.last = e.date;
  }
  const active = activeRecipes();
  const removed = RECIPES.filter(r => state.removed.includes(r.id));
  const groups = [
    ['vega', 'Vega hoofdgerechten', 'vegagerechten'],
    ['vis', 'Visgerechten', 'visgerechten'],
    ['soep', 'Soepen', 'soepen'],
  ];
  const count = type => active.filter(r => r.type === type).length;
  const short = groups.filter(([type]) => count(type) < MIN_PER_TYPE[type]);
  const item = r => {
    const s = stats[r.id];
    return `
      <a class="list-link" href="#/recept/${r.id}">
        <span><strong>${esc(r.name)}</strong><small>${esc(r.cuisine)} · ${r.time} min · ${s ? `laatst ${fmtDayMonth.format(parseIso(s.last))} · ${s.n}×` : 'nog niet gegeten'}</small></span>
        <span class="arrow">›</span>
      </a>`;
  };

  view.innerHTML = `
    <section class="card">
      <div class="stats">
        ${groups.map(([type]) => `<div class="${count(type) < MIN_PER_TYPE[type] ? 'low' : ''}"><b>${count(type)}</b><span>${TYPE_LABEL[type]}</span></div>`).join('')}
        <div><b>${active.length}</b><span>Totaal</span></div>
      </div>
      ${short.map(([type, , plural]) => `<p class="warn">Weinig ${plural}: met minder dan ${MIN_PER_TYPE[type]} komt hetzelfde gerecht snel terug.</p>`).join('')}
      <p class="muted">Nieuwe recepten maak je op je laptop met het commando <b>/nieuwe-recepten</b> in Claude. Verwijderen doe je onderaan een recept.</p>
    </section>
    ${groups.map(([type, label]) => `
      <div class="section-title">${label} · ${count(type)}</div>
      ${active.filter(r => r.type === type).map(item).join('') || '<p class="muted">Geen recepten.</p>'}
    `).join('')}
    ${removed.length ? `
      <details class="pantry removed">
        <summary>Verwijderde recepten <small>· ${removed.length}</small></summary>
        ${removed.map(item).join('')}
      </details>` : ''}`;
}

function renderList() {
  setChrome('Boodschappen', 'lijst', false);
  const wk = listWeekKey();
  if (!wk) {
    const nk = nextKey();
    view.innerHTML = `
      <section class="card empty">
        <p>Er is nog geen vastgelegd menu. Maak eerst het menu, dan staat hier je boodschappenlijst.</p>
        <a class="btn primary block" href="#/plan/${nk}">Menu maken voor volgende week</a>
      </section>`;
    return;
  }
  const list = shoppingList(wk);
  const checked = state.checked[wk] || {};
  const countable = list;
  const pantry = pantryItems(wk);
  const unchecked = pantry.filter(p => !p.mark).length;
  const toBuy = pantry.filter(p => p.mark === 'koop').length;
  const pantryNote = !pantry.length ? '' : unchecked
    ? `<a class="pantry-note todo" href="#/voorraad/${wk}"><span><b>Voorraad nog niet gecheckt</b>${unchecked} van ${pantry.length} artikelen (olie, kruiden). Doe dit thuis.</span><span class="arrow">›</span></a>`
    : `<a class="pantry-note" href="#/voorraad/${wk}"><span>Voorraad gecheckt · ${toBuy ? `${toBuy} op de lijst` : 'niets nodig'}</span><span class="arrow">Aanpassen ›</span></a>`;
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

  const groups = LIST_CATS.map(cat => {
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

  view.innerHTML = weekHead(wk) + pantryNote + `
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
    <div class="btnrow share">
      <button class="btn" data-action="share-list">Lijst delen…</button>
      <button class="btn danger" data-action="clear-checks">Vinkjes wissen</button>
    </div>`;
}

// Voorraadcheck: thuis per artikel aangeven of je het hebt of moet kopen. Niets staat vooraf ingevuld.
function renderPantry(weekKey) {
  if (!fixedWeek(weekKey)) { location.replace('#/lijst'); return; }
  ui.pantryKey = weekKey;
  setChrome('Voorraad checken', 'lijst', true);
  const items = pantryItems(weekKey);
  const open = items.filter(p => !p.mark).length;
  view.innerHTML = weekHead(weekKey) + `
    <p class="muted">Kijk thuis of je dit in huis hebt. Alleen wat je op Kopen zet, komt op de boodschappenlijst.</p>
    <div class="progress-label">${open ? `Nog ${open} van ${items.length} te checken` : `Alle ${items.length} gecheckt`}</div>
    <section class="card pantry-check">
      ${items.map(p => `
        <div class="dayrow">
          <div class="dayname"><b>${esc(p.n)}</b><span>${p.days.join(' · ')}</span></div>
          <div class="seg" role="group" aria-label="${esc(p.n)}">
            <button data-action="pantry-mark" data-n="${esc(p.n)}" data-mark="heb" class="${p.mark === 'heb' ? 'on' : ''}" aria-pressed="${p.mark === 'heb'}">Heb ik</button>
            <button data-action="pantry-mark" data-n="${esc(p.n)}" data-mark="koop" class="${p.mark === 'koop' ? 'on buy' : ''}" aria-pressed="${p.mark === 'koop'}">Kopen</button>
          </div>
        </div>`).join('') || '<p class="muted">Deze week is er niets uit de voorraad nodig.</p>'}
    </section>
    <a class="btn primary block" href="#/lijst">Naar de boodschappenlijst</a>`;
}

function renderHistory() {
  setChrome('Terugblik', 'terugblik', false);
  const ck = curKey();
  const keys = Object.keys(state.weeks).filter(k => k <= ck && fixedWeek(k)).sort().reverse();
  if (!keys.length) {
    view.innerHTML = '<section class="card empty"><p>Hier zie je straks per week wat jullie gegeten hebben.</p></section>';
    return;
  }
  view.innerHTML = keys.map(key => {
    const week = state.weeks[key];
    const rows = SLOTS.map(slot => {
      const info = slotInfo(week, slot);
      const offs = slot.days.filter(k => week.days[k].s !== 'thuis').map(k => `${k} ${STATUS_LABEL[week.days[k].s]}`).join(', ');
      const dayLabel = info.portions ? (info.single ? info.cookDay : slot.days.join(' & ')) : slot.days.join(' & ');
      const dish = info.recipe
        ? `<a href="#/recept/${info.recipe.id}?w=${key}&s=${slot.key}">${esc(info.recipe.name)}</a>${offs ? `<small>${esc(offs)}</small>` : ''}`
        : `<span class="muted">${esc(cap(offs || 'geen gerecht'))}</span>`;
      return `<div class="hrow"><span class="hday">${dayLabel}</span><span class="hdish">${dish}</span></div>`;
    }).join('');
    return `
      <section class="card hist">
        <div class="when"><b>${key === ck ? 'Deze week' : weekLabel(key)}</b><span>${key === ck ? weekLabel(key) : ''}</span></div>
        ${rows}
      </section>`;
  }).join('');
}

function renderSettings() {
  setChrome('Instellingen', 'instellingen', false);
  view.innerHTML = `
    <section class="card">
      <h2>Standaardporties</h2>
      <p class="muted">Aantal porties per kookblok in een gewone week. Afwijkingen voor één week geef je aan bij het maken van het menu.</p>
      ${SLOTS.map(s => `
        <div class="setting">
          <span>${s.title}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span>
          <input type="number" min="2" max="12" step="1" inputmode="numeric" value="${state.portions[s.key]}" data-action="portions" data-slot="${s.key}" aria-label="Porties ${s.title}">
        </div>`).join('')}
    </section>

    <section class="card">
      <h2>Back-up</h2>
      <p class="muted">iOS kan gegevens van web-apps wissen als je de app een paar weken niet opent. Maak af en toe een back-up (bijvoorbeeld naar Bestanden of iCloud Drive). De terugblik zit erin.</p>
      <div class="btnrow">
        <button class="btn" data-action="export">Back-up maken</button>
        <label class="btn">Back-up terugzetten<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
    </section>

    <section class="card">
      <h2>Op je beginscherm</h2>
      <p class="muted">Open deze pagina in Safari, tik op het deelicoon en kies <b>Zet op beginscherm</b>. Daarna werkt de app ook zonder internet, handig in de winkel.</p>
    </section>

    <section class="card">
      <h2>Alles wissen</h2>
      <p class="muted">Zet de app terug naar de beginstand: menu’s, terugblik, porties, vinkjes en verwijderde recepten.</p>
      <button class="btn danger" data-action="reset">Alles wissen</button>
    </section>`;
}

/* ---------------------------------------------------------------- router */

function route() {
  const hash = location.hash || '#/week';
  const [path, qs] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  if (parts[0] !== 'recept') ui.recipeSplit = null;

  switch (parts[0]) {
    case 'recept': renderRecipe(parts[1], params); break;
    case 'plan': renderPlan(parts[1]); break;
    case 'recepten': renderRecipes(); break;
    case 'lijst': renderList(); break;
    case 'voorraad': renderPantry(parts[1]); break;
    case 'terugblik': renderHistory(); break;
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
  ui.openFill = null;
  route();
  window.scrollTo(0, 0);
});

backBtn.addEventListener('click', () => {
  if (ui.navCount > 0) history.back();
  else location.hash = '#/week';
});

/* ---------------------------------------------------------------- acties */

function stepSplit(delta) {
  const i = ui.recipeSplit[0] > 0 ? 0 : 1;
  ui.recipeSplit[i] = Math.min(12, Math.max(1, ui.recipeSplit[i] + delta));
}

view.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const planWeek = state.weeks[ui.planKey];

  switch (a) {
    case 'week-sel': ui.weekSel = el.dataset.sel; ui.openFill = null; rerender(); break;
    case 'day-status':
      planWeek.days[el.dataset.day].s = el.dataset.s;
      fillWeek(ui.planKey, false);
      save();
      rerender();
      break;
    case 'day-inc':
    case 'day-dec': {
      const d = planWeek.days[el.dataset.day];
      d.n = Math.min(12, Math.max(1, d.n + (a === 'day-inc' ? 1 : -1)));
      save();
      rerender();
      break;
    }
    case 'fill-toggle': ui.openFill = ui.openFill === el.dataset.slot ? null : el.dataset.slot; rerender(); break;
    case 'fill-pick': {
      const week = state.weeks[el.dataset.week];
      const slot = SLOT_BY_KEY[el.dataset.slot];
      slot.days.forEach(k => { week.days[k].s = 'thuis'; });
      week.slots[slot.key] = el.dataset.id;
      save();
      ui.openFill = null;
      toast('Gerecht ingevuld');
      rerender();
      break;
    }
    case 'swap-toggle': ui.openSwap = ui.openSwap === el.dataset.slot ? null : el.dataset.slot; rerender(); break;
    case 'swap-pick':
      planWeek.slots[el.dataset.slot] = el.dataset.id;
      save();
      ui.openSwap = null;
      toast('Gerecht gewisseld');
      rerender();
      break;
    case 'reroll':
      fillWeek(ui.planKey, true);
      save();
      ui.openSwap = null;
      toast('Nieuwe gerechten gekozen');
      rerender();
      break;
    case 'plan-fix':
      planWeek.status = 'vast';
      save();
      ui.weekSel = ui.planKey === nextKey() ? 'next' : 'cur';
      toast('Menu vastgelegd');
      location.hash = `#/voorraad/${ui.planKey}`;
      break;
    case 'pantry-mark': {
      const marks = state.pantry[ui.pantryKey] || (state.pantry[ui.pantryKey] = {});
      if (marks[el.dataset.n] === el.dataset.mark) delete marks[el.dataset.n]; // nog een keer tikken = weer leeg
      else marks[el.dataset.n] = el.dataset.mark;
      if (el.dataset.mark === 'heb' && state.checked[ui.pantryKey]) delete state.checked[ui.pantryKey][`v:${el.dataset.n}`];
      save();
      rerender();
      break;
    }
    case 'plan-discard':
      if (confirm('Dit concept weggooien?')) {
        delete state.weeks[ui.planKey];
        save();
        location.hash = '#/week';
      }
      break;
    case 'portions-dec': stepSplit(-1); rerender(); break;
    case 'portions-inc': stepSplit(1); rerender(); break;
    case 'share-recipe': view.onShareRecipe && view.onShareRecipe(); break;
    case 'recipe-remove':
      if (confirm('Dit recept verwijderen? Het komt dan niet meer in nieuwe menu’s. In de terugblik blijft het staan.')) {
        if (!state.removed.includes(el.dataset.id)) state.removed.push(el.dataset.id);
        save();
        toast('Recept verwijderd');
        rerender();
      }
      break;
    case 'recipe-restore':
      state.removed = state.removed.filter(id => id !== el.dataset.id);
      save();
      toast('Recept teruggezet');
      rerender();
      break;
    case 'share-list': shareText(shoppingText(listWeekKey()), 'Boodschappen'); break;
    case 'clear-checks':
      if (confirm('Alle vinkjes van deze lijst wissen?')) {
        delete state.checked[listWeekKey()];
        save();
        rerender();
      }
      break;
    case 'extra-del': {
      e.preventDefault();
      const wk = listWeekKey();
      state.extras[wk] = (state.extras[wk] || []).filter(x => x.id !== el.dataset.id);
      if (state.checked[wk]) delete state.checked[wk][`x:${el.dataset.id}`];
      save();
      rerender();
      break;
    }
    case 'export': exportBackup(); break;
    case 'reset':
      if (confirm('Weet je het zeker? Alle menu’s, de terugblik, porties en vinkjes worden gewist.')) {
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
    const wk = listWeekKey();
    state.checked[wk] = state.checked[wk] || {};
    if (el.checked) state.checked[wk][el.dataset.key] = true;
    else delete state.checked[wk][el.dataset.key];
    save();
    rerender();
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
  const wk = listWeekKey();
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
