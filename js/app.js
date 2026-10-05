import { store, isShared } from './store.js';
import {
  newMatch, applyTurn, evalDarts, undo, canUndo, legInfo, legsWon, evaluate, dartsOptions,
  checkoutRoutes, currentLeg, effective, uid,
} from './game.js';
import { playerStats, matchSummary } from './stats.js';

// ---------- hjälpare ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = (n) => (n ? n.toFixed(1).replace('.', ',') : '–');
const fmtDate = (iso) => new Date(iso).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

const S = {
  players: [], matches: [], loaded: false, error: null,
  setup: null, entry: '', darts: [], mult: 1, inputMode: (() => { try { return localStorage.getItem('ci-darts-input') || 'darts'; } catch { return 'darts'; } })(), modal: null, sort: 'wins', modeFilter: null, saving: false,
};

const playerName = (id, fallback) => S.players.find((p) => p.id === id)?.name ?? fallback ?? '?';
const getMatch = (id) => S.matches.find((m) => m.id === id);

// ---------- data ----------
async function refresh({ quiet = false } = {}) {
  try {
    const [players, matches] = await Promise.all([store.players(), store.matches()]);
    S.players = players;
    // Behåll lokalt nyare version av en match vi håller på att spela in
    const local = new Map(S.matches.map((m) => [m.id, m]));
    S.matches = matches.map((m) => {
      const l = local.get(m.id);
      return l && l.rev > m.rev && S.saving ? l : m;
    });
    S.error = null;
  } catch (e) {
    S.error = e;
    if (!quiet) toast('Kunde inte hämta data – kontrollera uppkopplingen');
  }
  S.loaded = true;
  if (!(S.modal || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT')) render();
}

async function saveMatch(m) {
  const i = S.matches.findIndex((x) => x.id === m.id);
  i >= 0 ? (S.matches[i] = m) : S.matches.unshift(m);
  S.saving = true;
  render();
  try {
    await store.saveMatch(m);
  } catch (e) {
    toast('Sparandet misslyckades – försöker igen vid nästa poäng');
  } finally {
    S.saving = false;
  }
}

// ---------- routing ----------
function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  return { name: parts[0] || 'home', id: parts[1] };
}
window.addEventListener('hashchange', () => { S.entry = ''; S.darts = []; S.mult = 1; S.modal = null; render(); window.scrollTo(0, 0); });

const NAV = [
  ['home', 'Start', '◉'],
  ['historik', 'Historik', '☰'],
  ['spelare', 'Spelare', '♟'],
];

// ---------- rendering ----------
function render() {
  const r = route();
  const active = r.name === 'ny' || r.name === 'match' ? 'home' : r.name;
  $('#nav').innerHTML = NAV.map(([k, l]) => `<a href="#/${k === 'home' ? '' : k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')
    + `<a href="#/ny" class="${r.name === 'ny' ? 'on' : ''}">Ny match</a>`;
  $('#tabbar').innerHTML = [
    ['', 'Start', '◉', 'home'], ['ny', 'Ny match', '＋', 'ny'], ['historik', 'Historik', '☰', 'historik'], ['spelare', 'Spelare', '♟', 'spelare'],
  ].map(([h, l, i, k]) => `<a href="#/${h}" class="${active === k || r.name === k ? 'on' : ''}"><b>${i}</b>${l}</a>`).join('');
  $('#banner').innerHTML = isShared ? '' : '<div class="bn">Lokalt läge – data delas inte mellan telefoner (se README)</div>';

  const app = $('#app');
  if (!S.loaded) { app.innerHTML = '<p class="empty">Laddar…</p>'; }
  else if (r.name === 'ny') app.innerHTML = viewSetup();
  else if (r.name === 'match') app.innerHTML = viewMatch(r.id);
  else if (r.name === 'historik') app.innerHTML = viewHistory();
  else if (r.name === 'spelare' && r.id) app.innerHTML = viewPlayer(r.id);
  else if (r.name === 'spelare') app.innerHTML = viewPlayers();
  else app.innerHTML = viewHome();
  renderModal();
}

function matchTitle(m) {
  return m.teams.map((t) => esc(t.name)).join(' <b>vs</b> ');
}
function modeLabel(m) {
  return `${m.mode} · ${m.outRule === 'double' ? 'dubbel ut' : 'rak ut'} · först till ${m.legsToWin}`;
}
function matchCard(m) {
  const w = legsWon(m);
  const live = m.status === 'active';
  const score = m.teams.map((_, i) => w[i]).join(' – ');
  return `<a class="mcard ${live ? 'live' : ''}" href="#/match/${m.id}">
    <div class="row spread"><span class="vs">${matchTitle(m)}</span>
      ${live ? '<span class="pill live">Pågår</span>' : `<span class="pill ${'win'}">${esc(m.teams[m.winner]?.name ?? '')} vann</span>`}</div>
    <div class="row spread small muted"><span>${modeLabel(m)}</span><span>${live ? 'Leg ' + m.legs.length + ' · ' : ''}${score} · ${fmtDate(m.finished_at || m.created_at)}</span></div>
  </a>`;
}

// ----- Start -----
function leaderboard(mode = null) {
  return S.players.map((p) => ({ p, s: playerStats(p.id, S.matches, mode) }))
    .filter((x) => x.s.matches > 0);
}
function viewHome() {
  const active = S.matches.filter((m) => m.status === 'active');
  const done = S.matches.filter((m) => m.status === 'finished').slice(0, 5);
  const top = leaderboard().sort((a, b) => b.s.wins - a.s.wins || b.s.avg - a.s.avg).slice(0, 5);
  return `<section class="hero"><h1>Dags för <i>en match?</i></h1>
    <p class="muted">101, 301 eller 501 – ensam eller i lag. All statistik sparas och är öppen för alla.</p>
    <a class="btn big" href="#/ny">Starta ny match →</a></section>
  <div class="grid c2">
    <section class="stack"><h2>Pågående</h2>
      ${active.length ? active.map(matchCard).join('') : '<div class="card empty">Inga pågående matcher.</div>'}
      <h2 style="margin-top:1.5rem">Senaste matcher</h2>
      ${done.length ? done.map(matchCard).join('') : '<div class="card empty">Inga spelade matcher än.</div>'}
      ${done.length ? '<a class="link" href="#/historik">Visa all historik →</a>' : ''}
    </section>
    <section><h2>Ställning</h2>
      ${top.length ? `<div class="card tablewrap"><table><thead><tr><th>Spelare</th><th class="num">Vinster</th><th class="num">Snitt</th></tr></thead><tbody>
        ${top.map(({ p, s }) => `<tr class="click" data-go="#/spelare/${p.id}"><td>${esc(p.name)}</td><td class="num">${s.wins}/${s.matches}</td><td class="num">${fmt1(s.avg)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">Spela en match så dyker topplistan upp här.</div>'}
      <p><a class="link" href="#/spelare">Alla spelare →</a></p>
    </section></div>`;
}

// ----- Ny match -----
function initSetup(from) {
  S.setup = from || { mode: 501, outRule: 'double', legsToWin: 1, format: 'solo', solo: [], teams: [[null, null], [null, null]], adding: '' };
}
function viewSetup() {
  if (!S.setup) initSetup();
  const u = S.setup;
  const used = u.format === 'solo' ? u.solo : u.teams.flat().filter(Boolean);
  const chip = (cond, attr, label) => `<button class="chip ${cond ? 'on' : ''}" ${attr}>${label}</button>`;
  const opts = (sel) => `<option value="">Välj spelare…</option>` + S.players.map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const newPlayerBox = `<div class="row" style="margin-top:.8rem"><input type="text" id="newname" placeholder="Ny spelare – namn" maxlength="30" value="${esc(u.adding)}" autocomplete="off" data-enter="addplayer">
      <button class="btn ghost sm" data-act="addplayer">Lägg till</button></div>`;
  let who;
  if (u.format === 'solo') {
    who = `<div class="chips">${S.players.map((p) => {
      const i = u.solo.indexOf(p.id);
      return `<button class="chip ${i >= 0 ? 'on' : ''}" data-act="togglesolo" data-id="${p.id}">${i >= 0 ? `<span class="n">${i + 1}</span>` : ''}${esc(p.name)}</button>`;
    }).join('') || '<span class="muted">Inga spelare än – lägg till nedan.</span>'}</div>
    <p class="small muted">Tryck i den ordning ni kastar. Första börjar.</p>`;
  } else {
    who = u.teams.map((t, ti) => `<div class="teamrow" style="margin-bottom:.5rem">
      <select data-team="${ti}" data-slot="0" aria-label="Lag ${ti + 1} spelare 1">${opts(t[0])}</select>
      <select data-team="${ti}" data-slot="1" aria-label="Lag ${ti + 1} spelare 2">${opts(t[1])}</select>
      ${u.teams.length > 2 ? `<button class="btn ghost sm" data-act="rmteam" data-i="${ti}" aria-label="Ta bort lag">✕</button>` : '<span></span>'}</div>`).join('')
      + (u.teams.length < 4 ? '<button class="btn ghost sm" data-act="addteam">+ Lägg till lag</button>' : '');
  }
  const ready = canStart();
  return `<h1>Ny <i>match</i></h1>
  <div class="card">
    <label class="f" style="margin-top:0">Spel</label>
    <div class="chips">${[101, 301, 501].map((n) => chip(u.mode === n, `data-act="mode" data-v="${n}"`, n)).join('')}</div>
    <label class="f">Avslut</label>
    <div class="chips">${chip(u.outRule === 'double', 'data-act="out" data-v="double"', 'Dubbel ut')}${chip(u.outRule === 'straight', 'data-act="out" data-v="straight"', 'Rak ut')}</div>
    <label class="f">Antal legs (först till)</label>
    <div class="chips">${[1, 2, 3, 4].map((n) => chip(u.legsToWin === n, `data-act="legs" data-v="${n}"`, n === 1 ? '1 leg' : n + ' legs')).join('')}</div>
    <label class="f">Format</label>
    <div class="chips">${chip(u.format === 'solo', 'data-act="format" data-v="solo"', 'Var och en för sig')}${chip(u.format === 'teams', 'data-act="format" data-v="teams"', 'Lag (2 + 2)')}</div>
    <label class="f">${u.format === 'solo' ? 'Spelare' : 'Lag'}</label>
    ${who}
    ${newPlayerBox}
    <div class="row" style="margin-top:1.5rem">
      <button class="btn big grow" data-act="start" ${ready ? '' : 'disabled'}>Kör igång →</button>
      <button class="btn ghost" data-act="shuffle" ${used.length < 2 ? 'disabled' : ''}>Slumpa ordning</button>
    </div>
    ${ready ? '' : `<p class="small muted">${u.format === 'solo' ? 'Välj minst två spelare.' : 'Varje lag behöver två olika spelare, och minst två lag.'}</p>`}
  </div>`;
}
function canStart() {
  const u = S.setup;
  if (u.format === 'solo') return u.solo.length >= 2;
  const all = u.teams.flat();
  return u.teams.length >= 2 && all.every(Boolean) && new Set(all).size === all.length;
}
function startMatch() {
  const u = S.setup;
  const P = (id) => ({ id, name: playerName(id) });
  const teams = u.format === 'solo'
    ? u.solo.map((id) => ({ name: playerName(id), players: [P(id)] }))
    : u.teams.map((t) => ({ name: t.map((id) => playerName(id)).join(' & '), players: t.map(P) }));
  const m = newMatch({ mode: u.mode, outRule: u.outRule, legsToWin: u.legsToWin, teams });
  S.setup = null;
  saveMatch(m);
  location.hash = `#/match/${m.id}`;
}
async function addPlayerFromInput() {
  const input = $('#newname');
  const name = (input?.value || '').trim();
  if (!name) return;
  if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast('Det namnet finns redan'); return; }
  const p = { id: uid(), name, created_at: new Date().toISOString() };
  try {
    await store.addPlayer(p);
  } catch (e) {
    toast(e.status === 409 ? 'Det namnet finns redan' : 'Kunde inte spara spelaren');
    return;
  }
  S.players.push(p);
  S.players.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  if (S.setup) {
    S.setup.adding = '';
    if (S.setup.format === 'solo') S.setup.solo.push(p.id);
  }
  toast(`${name} är tillagd`);
  render();
}

// ----- Match -----
function viewMatch(id) {
  const m = getMatch(id);
  if (!m) return '<p class="empty">Hittar inte matchen.</p><p class="empty"><a class="link" href="#/">Till startsidan</a></p>';
  if (m.status === 'finished') return viewMatchDone(m);
  const leg = currentLeg(m);
  const info = legInfo(m, leg);
  const won = legsWon(m);
  const cur = info.next;
  const curRem = info.rem[cur.team];
  const val = S.entry === '' ? null : parseInt(S.entry, 10);
  const ev = val == null ? null : evaluate(curRem, val, m.outRule);
  const boards = m.teams.map((t, i) => {
    const turns = leg.turns.filter((x) => x.t === i);
    const pts = turns.reduce((a, x) => a + effective(x), 0);
    const d = turns.reduce((a, x) => a + x.d, 0);
    const last = turns.slice(-3).map((x) => x.bust ? `<span class="bust">${x.s}</span>` : x.s).join(' · ');
    return `<div class="board ${i === cur.team ? 'turn' : ''}">
      <span class="legs" title="Vunna legs">${won[i]}</span>
      <div class="name">${esc(t.name)}</div>
      <div class="rem">${info.rem[i]}</div>
      <div class="meta"><span>Snitt ${fmt1(d ? (pts / d) * 3 : 0)}</span><span>${d} pilar</span></div>
      <div class="last">${last || '&nbsp;'}</div></div>`;
  }).join('');
  return `<div class="row spread"><div><span class="muted small">${modeLabel(m)} · Leg ${m.legs.length}</span></div>
      <div class="row"><button class="btn ghost sm" data-act="undo" ${canUndo(m) ? '' : 'disabled'}>↶ Ångra</button>
      <button class="btn ghost sm" data-act="abort" data-id="${m.id}">Avbryt match</button></div></div>
    <div class="gamegrid">
      <div><div class="boards" style="margin-top:.8rem">${boards}</div></div>
      <div>
        <div class="now"><h2>${esc(cur.player.name)}<i>s</i> tur</h2><span class="muted small">${m.teams.length > 2 || m.teams[0].players.length > 1 ? esc(m.teams[cur.team].name) : ''}</span></div>
        ${S.inputMode === 'sum' ? hintHtml(m, curRem, 3) + sumPanel(curRem, val, ev) : dartPanel(m, curRem)}
      </div></div>`;
}


function hintHtml(m, rem, dartsLeft) {
  const max = m.outRule === 'double' ? 170 : 180;
  if (rem > max || rem < 2) return '';
  const routes = checkoutRoutes(rem, dartsLeft, m.outRule);
  if (!routes.length) return `<div class="hint none">Inget avslut på ${rem} med ${dartsLeft === 1 ? 'en pil' : dartsLeft + ' pilar'} – sätt upp nästa runda</div>`;
  return `<div class="hint"><span class="hl">Avslut på ${rem}</span>${routes.map((r) => `<span class="route">${r.join(' <i>›</i> ')}</span>`).join('')}</div>`;
}
const dartLabel = (n, mult) => (mult === 3 ? 'T' : mult === 2 ? 'D' : 'S') + n;
function dartPanel(m, rem) {
  const r = evalDarts(rem, S.darts, m.outRule);
  const done = r.state !== 'open';
  const slots = [0, 1, 2].map((i) => {
    const d = S.darts[i];
    return `<div class="dslot ${d ? 'has' : ''}">${d ? `<b>${d.l}</b><small>${d.v}</small>` : '<small>–</small>'}</div>`;
  }).join('');
  const msg = r.state === 'bust' ? '<span class="bad">Bust – rundan räknas inte</span>'
    : r.state === 'checkout' ? '<span class="good">Avslut! 🎯</span>'
    : `Kvar efter rundan: <b>${r.left}</b>`;
  const mult = [[1, 'Singel'], [2, 'Dubbel'], [3, 'Trippel']].map(([k, l]) =>
    `<button class="${S.mult === k ? 'on' : ''}" data-act="mult" data-v="${k}" ${done ? 'disabled' : ''}>${l}</button>`).join('');
  const nums = Array.from({ length: 20 }, (_, i) => i + 1).map((n) =>
    `<button data-act="dart" data-v="${n}" ${done ? 'disabled' : ''}>${n}</button>`).join('');
  const hint = r.state === 'open' ? hintHtml(m, r.left, 3 - S.darts.length) : '';
  return `<div class="dslots">${slots}</div>
    <div class="dmsg">${msg}</div>${hint}
    <div class="mult" role="group" aria-label="Singel, dubbel eller trippel">${mult}</div>
    <div class="dgrid">${nums}</div>
    <div class="dspecial">
      <button data-act="dart25" ${done ? 'disabled' : ''}>25</button>
      <button data-act="bull" ${done ? 'disabled' : ''}>Bull 50</button>
      <button data-act="miss" ${done ? 'disabled' : ''}>Miss</button></div>
    <div class="dactions">
      <button class="ghostb" data-act="dback" ${S.darts.length ? '' : 'disabled'} aria-label="Ta bort senaste pilen">⌫ Ta bort pil</button>
      <button class="ok" data-act="dok" ${done ? '' : 'disabled'}>${S.darts.length && !done ? 'Fyll i 3 pilar' : 'OK'}</button></div>
    <p class="small muted" style="text-align:center"><button class="link" data-act="inputmode" data-v="sum">Skriv in summan istället</button></p>`;
}
function sumPanel(curRem, val, ev) {
  const quick = [26, 41, 45, 60, 81, 85, 100, 121, 140, 180];
  return `<div class="entry ${ev === 'invalid' ? 'err' : ''}"><small>${ev === 'invalid' ? 'Går inte att kasta' : ev === 'bust' ? 'Bust – 0 poäng' : 'Summa 3 pilar'}</small><span>${S.entry || '0'}</span></div>
        <div class="quick">${quick.map((q) => `<button data-act="quick" data-v="${q}">${q}</button>`).join('')}<button class="zero" data-act="quick" data-v="0">0 / bust</button></div>
        <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="digit" data-v="${n}">${n}</button>`).join('')}
          <button data-act="back" aria-label="Radera">⌫</button><button data-act="digit" data-v="0">0</button>
          <button class="ok" data-act="submit" ${val == null || ev === 'invalid' ? 'disabled' : ''}>OK</button></div>
        <p class="small muted" style="text-align:center"><button class="link" data-act="inputmode" data-v="darts">Mata in pil för pil istället</button></p>`;
}
function addDart(v, mult, base) {
  const m = getMatch(route().id);
  if (!m || m.status !== 'active') return;
  const info = legInfo(m);
  if (evalDarts(info.rem[info.next.team], S.darts, m.outRule).state !== 'open') return;
  const l = base === 'bull' ? 'Bull' : base === 'miss' ? 'Miss' : dartLabel(base, mult);
  S.darts.push({ v, dbl: base === 'bull' || mult === 2, l: base === 'miss' ? 'Miss' : l });
  S.mult = 1;
}
function submitDarts() {
  const m = getMatch(route().id);
  if (!m || m.status !== 'active') return;
  const info = legInfo(m);
  const r = evalDarts(info.rem[info.next.team], S.darts, m.outRule);
  if (r.state === 'open') return;
  const ds = S.darts.map((d) => d.l);
  S.darts = []; S.mult = 1;
  if (r.state === 'checkout') commit(applyTurn(m, 'checkout', r.sum, r.n, ds));
  else if (r.state === 'bust') { commit(applyTurn(m, 'bust', r.sum, 3, ds)); toast('Bust!'); }
  else commit(applyTurn(m, 'ok', r.sum, 3, ds));
}

function submitScore() {
  const m = getMatch(route().id);
  if (!m || m.status !== 'active' || S.entry === '') return;
  const s = parseInt(S.entry, 10);
  const info = legInfo(m);
  const rem = info.rem[info.next.team];
  const ev = evaluate(rem, s, m.outRule);
  if (ev === 'invalid') return;
  S.entry = '';
  if (ev === 'checkout') { S.modal = { type: 'checkout', s, rem }; render(); return; }
  commit(applyTurn(m, ev === 'bust' ? 'bust' : 'ok', s));
  if (ev === 'bust') toast('Bust!');
}
function commit(next) {
  const wasLeg = legsWon(getMatch(next.id));
  saveMatch(next);
  const nowLeg = legsWon(next);
  if (next.status === 'finished') toast('Match avgjord!');
  else if (nowLeg.some((v, i) => v > wasLeg[i])) toast('Leg vunnet!');
}

function renderModal() {
  const el = $('#modal');
  const mo = S.modal;
  if (!mo) { el.innerHTML = ''; return; }
  const m = getMatch(route().id);
  if (mo.type === 'checkout' && m) {
    const opts = dartsOptions(mo.rem, m.outRule);
    el.innerHTML = `<div class="overlay" data-act="closemodal"><div class="dialog" role="dialog" aria-modal="true">
      <h2>Avslut på ${mo.s}!</h2>
      <p class="muted">${m.outRule === 'double' ? 'Hur många pilar behövdes, med sista på dubbel?' : 'Hur många pilar behövdes?'}</p>
      <div class="bigbtns">${[1, 2, 3].map((n) => `<button class="btn" data-act="checkout" data-v="${n}" ${opts.includes(n) ? '' : 'disabled'}>${n}</button>`).join('')}</div>
      <div class="row spread">${m.outRule === 'double' ? '<button class="btn ghost" data-act="nodouble">Ingen dubbel (bust)</button>' : '<span></span>'}
      <button class="link" data-act="closemodal">Avbryt</button></div></div></div>`;
  } else if (mo.type === 'rename') {
    el.innerHTML = '';
  }
  el.querySelector('button:not(:disabled)')?.focus?.();
}

function viewMatchDone(m) {
  const w = legsWon(m);
  const sum = matchSummary(m);
  const winner = m.teams[m.winner];
  // tur-för-tur
  const legs = m.legs.map((leg, li) => {
    const rem = m.teams.map(() => m.mode);
    const rows = leg.turns.map((t) => {
      if (t.co) rem[t.t] = 0; else if (!t.bust) rem[t.t] -= t.s;
      const who = m.teams[t.t].players.find((p) => p.id === t.p);
      return `<tr><td>${esc(playerName(t.p, who?.name))}${t.ds ? `<div class="small muted">${t.ds.join(' · ')}</div>` : ''}</td><td class="num ${t.bust ? 'muted' : ''}">${t.bust ? `<s>${t.s}</s> bust` : t.s}</td><td class="num">${rem[t.t]}</td></tr>`;
    }).join('');
    return `<details ${li === m.legs.length - 1 ? 'open' : ''}><summary><b>Leg ${li + 1}</b> – ${leg.winner != null ? esc(m.teams[leg.winner].name) + ' vann' : 'ej klart'}</summary>
      <table class="turns"><thead><tr><th>Spelare</th><th class="num">Poäng</th><th class="num">Kvar</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }).join('');
  return `<div class="winbanner"><h2>${esc(winner.name)} vann!</h2><div>${m.teams.map((t, i) => `${esc(t.name)} ${w[i]}`).join(' – ')} · ${modeLabel(m)}</div>
      <div class="small" style="opacity:.85;margin-top:.3rem">${fmtDate(m.finished_at || m.created_at)}</div></div>
    <div class="row" style="margin:1rem 0">
      <button class="btn" data-act="rematch" data-id="${m.id}">Spela igen</button>
      <button class="btn ghost" data-act="undo">↶ Ångra sista kastet</button>
      <button class="btn ghost" data-act="delete" data-id="${m.id}">Ta bort match</button></div>
    <div class="card tablewrap"><table><thead><tr><th>Lag</th><th class="num">Legs</th><th class="num">Snitt</th><th class="num">Högsta</th><th class="num">180</th></tr></thead><tbody>
      ${m.teams.map((t, i) => `<tr><td>${esc(t.name)}</td><td class="num">${w[i]}</td><td class="num">${fmt1(sum[i].avg)}</td><td class="num">${sum[i].high}</td><td class="num">${sum[i].n180}</td></tr>`).join('')}</tbody></table></div>
    <h2 style="margin-top:1.5rem">Kast för kast</h2><div class="card stack">${legs}</div>`;
}

// ----- Historik -----
function viewHistory() {
  const list = S.matches;
  const pid = S.histPlayer || '';
  const shown = pid ? list.filter((m) => m.teams.some((t) => t.players.some((p) => p.id === pid))) : list;
  return `<div class="row spread"><h1>Hist<i>orik</i></h1>
    <select data-filter="histPlayer" aria-label="Filtrera på spelare"><option value="">Alla spelare</option>${S.players.map((p) => `<option value="${p.id}" ${pid === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="stack">${shown.length ? shown.map(matchCard).join('') : '<div class="card empty">Inga matcher att visa.</div>'}</div>`;
}

// ----- Spelare -----
const SORTS = {
  wins: ['Vinster', (a, b) => b.s.wins - a.s.wins || b.s.winPct - a.s.winPct],
  winPct: ['Vinst %', (a, b) => b.s.winPct - a.s.winPct || b.s.matches - a.s.matches],
  avg: ['Snitt', (a, b) => b.s.avg - a.s.avg],
  matches: ['Matcher', (a, b) => b.s.matches - a.s.matches],
  high: ['Högsta', (a, b) => b.s.highTurn - a.s.highTurn],
};
function modeChips(cur) {
  return `<div class="chips">${[null, 101, 301, 501].map((n) => `<button class="chip ${cur === n ? 'on' : ''}" data-act="modefilter" data-v="${n ?? ''}">${n ?? 'Alla'}</button>`).join('')}</div>`;
}
function viewPlayers() {
  const rows = S.players.map((p) => ({ p, s: playerStats(p.id, S.matches, S.modeFilter) }));
  rows.sort(SORTS[S.sort][1]);
  const th = (k, label, num = true) => `<th class="sortable ${num ? 'num' : ''} ${S.sort === k ? 'sorted' : ''}" data-act="sort" data-v="${k}">${label}${S.sort === k ? ' ▾' : ''}</th>`;
  return `<h1>Spel<i>are</i></h1>
    ${modeChips(S.modeFilter)}
    <div class="card tablewrap" style="margin-top:1rem"><table><thead><tr><th>Namn</th>${th('matches', 'Matcher')}${th('wins', 'Vinster')}${th('winPct', 'Vinst %')}${th('avg', 'Snitt')}${th('high', 'Högsta')}</tr></thead><tbody>
      ${rows.map(({ p, s }) => `<tr class="click" data-go="#/spelare/${p.id}"><td><b>${esc(p.name)}</b></td><td class="num">${s.matches}</td><td class="num">${s.wins}</td><td class="num">${s.matches ? s.winPct + '%' : '–'}</td><td class="num">${fmt1(s.avg)}</td><td class="num">${s.highTurn || '–'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Inga spelare än.</td></tr>'}
    </tbody></table></div>
    <div class="card" style="margin-top:1rem"><h3>Ny spelare</h3><div class="row"><input type="text" id="newname" placeholder="Namn" maxlength="30" autocomplete="off" data-enter="addplayer"><button class="btn" data-act="addplayer">Lägg till</button></div></div>`;
}
function sparkline(form) {
  if (form.length < 2) return '<p class="muted small">Spela fler matcher för att se formkurvan.</p>';
  const pts = form.slice(-20);
  const max = Math.max(...pts.map((f) => f.avg), 1), min = Math.min(...pts.map((f) => f.avg));
  const W = 400, H = 90, pad = 8;
  const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v) => H - pad - ((v - min) / Math.max(max - min, 1)) * (H - 2 * pad);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Snitt per match">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.map((f, i) => `${x(i)},${y(f.avg)}`).join(' ')}"/>
    ${pts.map((f, i) => `<circle cx="${x(i)}" cy="${y(f.avg)}" r="3.5" fill="${f.won ? 'var(--accent)' : 'var(--card)'}" stroke="var(--accent)" stroke-width="1.5"><title>${fmt1(f.avg)} – ${f.won ? 'vinst' : 'förlust'}</title></circle>`).join('')}</svg>
    <p class="muted small">Snitt per match, senaste ${pts.length}. Fylld prick = vinst.</p>`;
}
function viewPlayer(id) {
  const p = S.players.find((x) => x.id === id);
  if (!p) return '<p class="empty">Hittar inte spelaren.</p>';
  const s = playerStats(id, S.matches, S.modeFilter);
  const mine = S.matches.filter((m) => m.teams.some((t) => t.players.some((q) => q.id === id)) && (!S.modeFilter || m.mode === S.modeFilter)).slice(0, 8);
  const h2h = Object.values(s.h2h).sort((a, b) => b.w + b.l - (a.w + a.l));
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  return `<p><a class="link" href="#/spelare">← Alla spelare</a></p>
  <div class="row spread"><h1>${esc(p.name)}</h1><button class="btn ghost sm" data-act="rename" data-id="${p.id}">Byt namn</button></div>
  ${modeChips(S.modeFilter)}
  <div class="stats" style="margin-top:1rem">
    ${stat(s.matches, 'Matcher')}${stat(s.wins, 'Vinster')}${stat(s.matches ? s.winPct + '%' : '–', 'Vinst %')}${stat(fmt1(s.avg), '3-pilssnitt')}
    ${stat(s.highTurn || '–', 'Högsta runda')}${stat(s.highCheckout || '–', 'Högsta avslut')}${stat(s.bestLeg ?? '–', 'Bästa leg (pilar)')}${stat(`${s.legsWon}/${s.legsPlayed}`, 'Legs vunna')}
    ${stat(s.n100, '100+ rundor')}${stat(s.n140, '140+ rundor')}${stat(s.n180, '180')}${stat(s.darts, 'Pilar kastade')}
  </div>
  <div class="grid c2" style="margin-top:1.2rem">
    <div class="card"><h3>Form</h3>${sparkline(s.form)}</div>
    <div class="card"><h3>Mot andra spelare</h3>${h2h.length ? `<table><tbody>${h2h.map((o) => `<tr class="click" data-go="#/spelare/${o.id}"><td>${esc(playerName(o.id, o.name))}</td><td class="num">${o.w} V</td><td class="num">${o.l} F</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Inga avgjorda matcher än.</p>'}</div>
  </div>
  <h2 style="margin-top:1.5rem">Senaste matcher</h2><div class="stack">${mine.length ? mine.map(matchCard).join('') : '<div class="card empty">Inga matcher än.</div>'}</div>`;
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]');
  if (go && !e.target.closest('[data-act]')) { location.hash = go.dataset.go; return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act, v = el.dataset.v;
  const u = S.setup;
  switch (a) {
    case 'mode': u.mode = +v; break;
    case 'out': u.outRule = v; break;
    case 'legs': u.legsToWin = +v; break;
    case 'format': u.format = v; break;
    case 'togglesolo': { const i = u.solo.indexOf(el.dataset.id); i >= 0 ? u.solo.splice(i, 1) : u.solo.push(el.dataset.id); break; }
    case 'addteam': u.teams.push([null, null]); break;
    case 'rmteam': u.teams.splice(+el.dataset.i, 1); break;
    case 'shuffle':
      if (u.format === 'solo') u.solo.sort(() => Math.random() - 0.5); else u.teams.sort(() => Math.random() - 0.5);
      toast('Ordningen är slumpad'); break;
    case 'addplayer': await addPlayerFromInput(); return;
    case 'start': if (canStart()) startMatch(); return;
    case 'mult': S.mult = +v; break;
    case 'dart': addDart(+v * S.mult, S.mult, +v); break;
    case 'dart25': addDart(25, 1, 25); break;
    case 'bull': addDart(50, 2, 'bull'); break;
    case 'miss': addDart(0, 1, 'miss'); break;
    case 'dback': S.darts.pop(); break;
    case 'dok': submitDarts(); return;
    case 'inputmode':
      S.inputMode = v; S.entry = ''; S.darts = [];
      try { localStorage.setItem('ci-darts-input', v); } catch {}
      break;
    case 'digit': if (S.entry.length < 3) S.entry = (S.entry + v).replace(/^0+(?=\d)/, ''); break;
    case 'back': S.entry = S.entry.slice(0, -1); break;
    case 'quick': S.entry = v; submitScore(); return;
    case 'submit': submitScore(); return;
    case 'undo': {
      const m = getMatch(route().id);
      if (m && canUndo(m)) { S.entry = ''; S.darts = []; saveMatch(undo(m)); toast('Senaste kastet ångrat'); return; }
      break;
    }
    case 'checkout': {
      const m = getMatch(route().id);
      const { s } = S.modal; S.modal = null;
      commit(applyTurn(m, 'checkout', s, +v)); return;
    }
    case 'nodouble': {
      const m = getMatch(route().id);
      const { s } = S.modal; S.modal = null;
      commit(applyTurn(m, 'bust', s)); toast('Ingen dubbel – bust'); return;
    }
    case 'closemodal':
      if (el.classList.contains('overlay') && e.target !== el) return; // klick inne i dialogen
      S.modal = null; break;
    case 'abort': case 'delete':
      if (confirm(a === 'abort' ? 'Avbryta och ta bort den här matchen?' : 'Ta bort matchen och dess statistik för alla?')) {
        const id = el.dataset.id;
        try { await store.deleteMatch(id); S.matches = S.matches.filter((m) => m.id !== id); location.hash = '#/'; }
        catch { toast('Kunde inte ta bort matchen'); }
      }
      return;
    case 'rematch': {
      const m = getMatch(el.dataset.id);
      const ids = m.teams.map((t) => t.players.map((p) => p.id));
      const solo = m.teams.every((t) => t.players.length === 1);
      const rot = (arr) => [...arr.slice(1), arr[0]];
      initSetup({ mode: m.mode, outRule: m.outRule, legsToWin: m.legsToWin, format: solo ? 'solo' : 'teams', solo: solo ? rot(ids.flat()) : [], teams: solo ? [[null, null], [null, null]] : rot(ids), adding: '' });
      location.hash = '#/ny'; return;
    }
    case 'modefilter': S.modeFilter = v ? +v : null; break;
    case 'sort': S.sort = v; break;
    case 'rename': {
      const p = S.players.find((x) => x.id === el.dataset.id);
      const name = (prompt('Nytt namn', p.name) || '').trim();
      if (name && name !== p.name) {
        try { await store.renamePlayer(p.id, name); p.name = name; toast('Namnet ändrat – äldre matcher visar det gamla namnet'); }
        catch { toast('Kunde inte byta namn (finns det redan?)'); }
      }
      break;
    }
  }
  render();
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel) return;
  if (sel.dataset.team != null) { S.setup.teams[+sel.dataset.team][+sel.dataset.slot] = sel.value || null; render(); }
  else if (sel.dataset.filter) { S[sel.dataset.filter] = sel.value; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'newname' && S.setup) S.setup.adding = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (e.target.dataset?.enter === 'addplayer' && e.key === 'Enter') { addPlayerFromInput(); return; }
  if (route().name !== 'match' || S.modal || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const m = getMatch(route().id);
  if (!m || m.status !== 'active') return;
  if (S.inputMode !== 'sum') { if (e.key === 'Enter') submitDarts(); else if (e.key === 'Backspace') S.darts.pop(); else return; render(); return; }
  if (/^\d$/.test(e.key) && S.entry.length < 3) S.entry = (S.entry + e.key).replace(/^0+(?=\d)/, '');
  else if (e.key === 'Backspace') S.entry = S.entry.slice(0, -1);
  else if (e.key === 'Enter') { submitScore(); return; }
  else return;
  render();
});

// ---------- start ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
refresh();
// Håll vyn färsk så att andra kan följa en match från sin egen mobil.
setInterval(() => { if (isShared && !document.hidden && !S.modal && !S.saving) refresh({ quiet: true }); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({ quiet: true }); });
