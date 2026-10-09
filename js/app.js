import { store, isShared, DEFAULT_HOME } from './store.js';
import {
  newMatch, applyTurn, evalDarts, undo, canUndo, legInfo, legsWon,
  checkoutRoutes, currentLeg, effective, uid, specialVisit,
} from './game.js';
import { playerStats, matchSummary, matchHits } from './stats.js';

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
  homes: null, home: null, // hem (null = databasen saknar hem-stöd än)
  players: [], matches: [], loaded: false, error: null,
  setup: null, matchHeat: 'all', trendMetric: 'avg', trendRange: 30, darts: [], mult: 1, locked: false, timer: null, keybuf: '', modal: null, sort: 'wins', modeFilter: null, saving: false,
};

const playerName = (id, fallback) => S.players.find((p) => p.id === id)?.name ?? fallback ?? '?';
const getMatch = (id) => S.matches.find((m) => m.id === id);

// ---------- data ----------
async function refresh({ quiet = false } = {}) {
  try {
    const [players, matches] = await Promise.all([store.players(S.home), store.matches(S.home)]);
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

// ---------- hem ----------
const homeName = () => S.homes?.find((h) => h.id === S.home)?.name ?? '';
function homeBar() {
  if (!S.homes) return '';
  return `<select id="homesel" class="homesel" aria-label="Välj hem">${S.homes.map((h) => `<option value="${h.id}" ${h.id === S.home ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}<option value="__new">＋ Skapa nytt hem…</option></select>`;
}
function setHome(id, reload = true) {
  S.home = id;
  try { localStorage.setItem('ci-darts-home', id); } catch {}
  if (!reload) return;
  S.loaded = false; S.players = []; S.matches = []; S.setup = null;
  if (location.hash !== '#/') location.hash = '#/';
  render();
  refresh();
}
async function createHome() {
  const name = ($('#homename')?.value || '').trim();
  if (!name) return;
  if (S.homes.some((h) => h.name.toLowerCase() === name.toLowerCase())) { toast('Det hemmet finns redan'); return; }
  const h = { id: uid(), name, created_at: new Date().toISOString() };
  try {
    await store.addHome(h);
  } catch (e) {
    toast(e.status === 409 ? 'Det hemmet finns redan' : 'Kunde inte skapa hemmet');
    return;
  }
  S.homes.push(h);
  S.modal = null;
  setHome(h.id);
  toast(`Välkommen hem – ${name}`);
}
async function copyHomeLink() {
  const url = `${location.origin}${location.pathname}?home=${S.home}`;
  try { await navigator.clipboard.writeText(url); toast('Länken är kopierad – skicka den till familjen'); }
  catch { prompt('Kopiera länken till det här hemmet:', url); }
}

// ---------- routing ----------
function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  return { name: parts[0] || 'home', id: parts[1] };
}
window.addEventListener('hashchange', () => { S.matchHeat = 'all'; clearTimeout(S.timer); S.timer = null; S.locked = false; S.darts = []; S.mult = 1; S.modal = null; render(); window.scrollTo(0, 0); });

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
  const hb = homeBar();
  if (S.hb !== hb) { $('#homebar').innerHTML = hb; S.hb = hb; }
  $('#banner').innerHTML = isShared ? '' : '<div class="bn">Lokalt läge – data delas inte mellan telefoner (se README)</div>';

  const gm = r.name === 'match' ? getMatch(r.id) : null;
  document.body.classList.toggle('ingame', Boolean(gm && gm.status === 'active'));
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
  if (m.teams.length === 1) return `${esc(m.teams[0].name)} <b>·</b> övning`;
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
      ${live ? '<span class="pill live">Pågår</span>' : m.teams.length === 1 ? '<span class="pill">Övning</span>' : `<span class="pill win">${esc(m.teams[m.winner]?.name ?? '')} vann</span>`}</div>
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
  return `<section class="hero">${S.homes ? `<p class="small muted" style="margin:0 0 .3rem">Hem: <b>${esc(homeName())}</b> · <button class="link" data-act="copyhomelink">Kopiera länk till det här hemmet</button></p>` : ''}<h1>Dags för <i>en match?</i></h1>
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
  S.setup = from || { mode: 501, outRule: 'double', legsToWin: 1, format: 'solo', solo: [], teams: [], adding: '', random: false };
}
const selectedIds = (u) => (u.format === 'solo' ? u.solo : u.teams.flat());
function togglePlayer(id) {
  const u = S.setup;
  if (u.format === 'solo') {
    const i = u.solo.indexOf(id);
    i >= 0 ? u.solo.splice(i, 1) : u.solo.push(id);
    return;
  }
  const ti = u.teams.findIndex((t) => t.includes(id));
  if (ti >= 0) {
    u.teams[ti] = u.teams[ti].filter((x) => x !== id);
    if (!u.teams[ti].length) u.teams.splice(ti, 1);
  } else {
    const open = u.teams.find((t) => t.length < 2);
    if (open) open.push(id);
    else if (u.teams.length < 4) u.teams.push([id]);
    else toast('Max fyra lag');
  }
}
function setFormat(f) {
  const u = S.setup;
  if (f === u.format) return;
  if (f === 'teams' && !u.teams.length) {
    for (let i = 0; i < u.solo.length && u.teams.length < 4; i += 2) u.teams.push(u.solo.slice(i, i + 2));
  } else if (f === 'solo' && !u.solo.length) {
    u.solo = u.teams.flat();
  }
  u.format = f;
}
function canStart() {
  const u = S.setup;
  if (u.format === 'solo') return u.solo.length >= 1;
  return u.teams.length >= 2 && u.teams.every((t) => t.length === 2);
}
function viewSetup() {
  if (!S.setup) initSetup();
  const u = S.setup;
  const sel = new Set(selectedIds(u));
  const seg = (cur, act, items) => `<div class="seg" role="group">${items.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const pool = S.players.map((p) => `<button class="chip ${sel.has(p.id) ? 'on' : ''}" data-act="toggleplayer" data-id="${p.id}" aria-pressed="${sel.has(p.id)}">${sel.has(p.id) ? '✓ ' : ''}${esc(p.name)}</button>`).join('')
    || '<span class="muted">Inga spelare än – lägg till den första här under.</span>';
  let order;
  if (u.format === 'solo') {
    order = u.solo.length ? `<div class="olist" data-sort="solo">${u.solo.map((id, i) => `<div class="orow" data-i="${i}">
        <span class="handle" aria-label="Dra för att flytta">≡</span><span class="num">${i + 1}</span><span class="nm">${esc(playerName(id))}</span>
        ${i === 0 ? '<span class="pill live">Börjar</span>' : ''}
        <button class="x" data-act="toggleplayer" data-id="${id}" aria-label="Ta bort">✕</button></div>`).join('')}</div>`
      : '<p class="muted small">Tryck på namnen ovan för att välja vilka som spelar.</p>';
  } else {
    order = u.teams.length ? `<div class="olist" data-sort="teams">${u.teams.map((t, i) => `<div class="orow team ${i === 0 ? 'first' : ''}" data-i="${i}">
        <span class="handle" aria-label="Dra för att flytta">≡</span><span class="num">${i + 1}</span>
        <span class="nm">${t.map((id) => `<span class="tm">${esc(playerName(id))}<button class="x" data-act="toggleplayer" data-id="${id}" aria-label="Ta bort ${esc(playerName(id))}">✕</button></span>`).join('<span class="amp">&amp;</span>')}${t.length < 2 ? '<span class="tm ghost">välj en till…</span>' : ''}</span>
        ${t.length === 2 ? `<button class="x" data-act="swapteam" data-i="${i}" aria-label="Byt kastordning i laget" title="Byt vem som kastar först">⇄</button>` : ''}</div>`).join('')}</div>
      <p class="small muted" style="margin:.4rem 0 0">Lag 1 börjar. ⇄ byter vem i laget som kastar först.</p>`
      : '<p class="muted small">Tryck på namnen ovan – de två första blir lag 1, nästa två lag 2 och så vidare.</p>';
  }
  const ready = canStart();
  return `<h1>Ny <i>match</i></h1>
  <div class="card stack setupcard">
    <div class="setrow"><label class="f">Spel</label>${seg(u.mode, 'mode', [[101, '101'], [301, '301'], [501, '501']])}</div>
    <div class="setrow"><label class="f">Avslut</label>${seg(u.outRule, 'out', [['double', 'Dubbel ut'], ['straight', 'Rak ut']])}</div>
    <div class="setrow"><label class="f">Först till</label>${seg(u.legsToWin, 'legs', [[1, '1 leg'], [2, '2 legs'], [3, '3 legs'], [4, '4 legs']])}</div>
    <div class="setrow"><label class="f">Format</label>${seg(u.format, 'format', [['solo', 'Var och en'], ['teams', 'Lag (2 + 2)']])}</div>
    <div><label class="f">Vilka spelar? <span class="muted" style="text-transform:none;letter-spacing:0">Tryck för att välja</span></label>
      <div class="chips">${pool}</div>
      <div class="row" style="margin-top:.8rem"><input type="text" id="newname" placeholder="Ny spelare – skriv namn" maxlength="30" value="${esc(u.adding)}" autocomplete="off" data-enter="addplayer" class="grow">
        <button class="btn ghost sm" data-act="addplayer">+ Lägg till</button></div></div>
    <div><label class="f">${u.format === 'solo' ? 'Ordning' : 'Lag och ordning'} <span class="muted" style="text-transform:none;letter-spacing:0">Dra i ≡ för att välja vem som börjar</span></label>${order}</div>
    ${u.format === 'solo' && u.solo.length === 1 ? '<p class="small" style="margin:0;color:var(--accent);font-weight:600">Ensam spelare = övning. Räknas inte som vinst/förlust, men snitt och träffar sparas.</p>' : ''}
    <label class="check"><input type="checkbox" data-act="random" ${u.random ? 'checked' : ''}> Slumpa vem som börjar</label>
    <button class="btn big block" data-act="start" ${ready ? '' : 'disabled'}>Kör igång →</button>
    ${ready ? '' : `<p class="small muted" style="margin:0">${u.format === 'solo' ? 'Välj minst en spelare.' : 'Välj spelare så att det blir minst två fulla lag med två spelare i varje.'}</p>`}
  </div>`;
}
function startMatch() {
  const u = S.setup;
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const P = (id) => ({ id, name: playerName(id) });
  let teams;
  if (u.format === 'solo') {
    teams = (u.random ? shuffle(u.solo) : u.solo).map((id) => ({ name: playerName(id), players: [P(id)] }));
  } else {
    teams = (u.random ? shuffle(u.teams) : u.teams).map((t) => ({ name: t.map((id) => playerName(id)).join(' & '), players: t.map(P) }));
  }
  const m = newMatch({ mode: u.mode, outRule: u.outRule, legsToWin: u.legsToWin, teams });
  if (S.homes) m.home_id = S.home;
  S.setup = null;
  saveMatch(m);
  location.hash = `#/match/${m.id}`;
}
async function addPlayerFromInput() {
  const input = $('#newname');
  const name = (input?.value || '').trim();
  if (!name) return;
  if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast('Det namnet finns redan'); return; }
  const p = { id: uid(), name, created_at: new Date().toISOString(), ...(S.homes ? { home_id: S.home } : {}) };
  try {
    await store.addPlayer(p);
  } catch (e) {
    toast(e.status === 409 ? 'Det namnet finns redan' : 'Kunde inte spara spelaren');
    return;
  }
  S.players.push(p);
  S.players.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  if (S.setup) { S.setup.adding = ''; togglePlayer(p.id); }
  toast(`${name} är tillagd`);
  render();
}

// Dra-och-släpp-sortering (mus och touch) via ≡-handtaget.
function enableSort(e) {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  const item = handle.closest('.orow');
  const list = item.parentElement;
  e.preventDefault();
  item.classList.add('dragging');
  const move = (ev) => {
    const items = [...list.children].filter((c) => c !== item);
    const after = items.find((c) => { const r = c.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    after ? list.insertBefore(item, after) : list.appendChild(item);
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    item.classList.remove('dragging');
    const order = [...list.children].map((c) => +c.dataset.i);
    const u = S.setup, key = list.dataset.sort;
    u[key] = order.map((i) => u[key][i]);
    render();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}
document.addEventListener('pointerdown', enableSort);

// ----- Match -----
function hintHtml(m, rem, dartsLeft) {
  const max = m.outRule === 'double' ? 170 : 180;
  if (rem > max || rem < 2) return '<div class="hint empty-hint"></div>';
  const routes = checkoutRoutes(rem, dartsLeft, m.outRule);
  if (!routes.length) return `<div class="hint none">Inget avslut på ${rem} med ${dartsLeft === 1 ? 'en pil' : dartsLeft + ' pilar'}</div>`;
  const lab = (l) => `<b class="k${l === 'Bull' ? 'B' : /^\d/.test(l) ? 'S' : l[0]}">${l}</b>`;
  return `<div class="hint"><span class="hl">Avslut på ${rem}</span>${routes.map((r) => `<span class="route">${r.map(lab).join('<i>›</i>')}</span>`).join('')}</div>`;
}
const dartLabel = (n, mult) => (mult === 3 ? 'T' : mult === 2 ? 'D' : 'S') + n;

function viewMatch(id) {
  const m = getMatch(id);
  if (!m) return '<p class="empty">Hittar inte matchen.</p><p class="empty"><a class="link" href="#/">Till startsidan</a></p>';
  if (m.status === 'finished') return viewMatchDone(m);
  const leg = currentLeg(m);
  const info = legInfo(m, leg);
  const won = legsWon(m);
  const cur = info.next;
  const curRem = info.rem[cur.team];
  const r = evalDarts(curRem, S.darts, m.outRule);
  const multi = m.teams[cur.team].players.length > 1;
  const rows = m.teams.map((t, i) => {
    const isCur = i === cur.team;
    const turns = leg.turns.filter((x) => x.t === i);
    const pts = turns.reduce((a, x) => a + effective(x), 0);
    const d = turns.reduce((a, x) => a + x.d, 0);
    let boxes, total = '';
    if (isCur) {
      boxes = [0, 1, 2].map((k) => { const dd = S.darts[k]; return `<span class="db ${dd ? 'has' : ''}">${dd ? dd.l : ''}</span>`; }).join('');
      total = S.darts.length ? (r.state === 'bust' ? '<s>' + r.sum + '</s> bust' : r.sum) : '';
    } else {
      const last = turns[turns.length - 1];
      const ds = last?.ds || (last ? [String(last.s)] : []);
      boxes = [0, 1, 2].map((k) => `<span class="db past ${ds[k] ? 'has' : ''}">${ds[k] ?? ''}</span>`).join('');
      total = last ? (last.bust ? '<s>' + last.s + '</s> bust' : last.s) : '';
    }
    const shown = isCur ? r.left : info.rem[i];
    return `<div class="grow ${isCur ? 'turn' : ''}">
      <div class="g-rem"><b class="${isCur && r.state === 'bust' ? 'bad' : ''}">${shown}</b><span class="g-name">${esc(t.name)}</span>${isCur && multi ? `<span class="g-who">▸ ${esc(cur.player.name)}</span>` : ''}</div>
      <div class="g-darts"><div class="dbs">${boxes}</div><div class="g-total">${total}</div></div>
      <div class="g-stats"><span>Legs <b>${won[i]}</b></span><span>⌀ ${fmt1(d ? (pts / d) * 3 : 0)}</span></div></div>`;
  }).join('');
  const hint = r.state === 'open' ? hintHtml(m, r.left, 3 - S.darts.length) : '<div class="hint empty-hint"></div>';
  const nums = Array.from({ length: 20 }, (_, i) => i + 1).concat(25);
  const lock = S.locked ? 'disabled' : '';
  return `<div class="gtop"><a class="back" href="#/" aria-label="Till startsidan">‹</a>
      <span class="gmeta">${modeLabel(m)} · Leg ${m.legs.length}</span>
      <button class="btn ghost sm" data-act="abort" data-id="${m.id}">Avbryt</button></div>
    <div class="gamegrid">
      <div class="gboards">${rows}</div>
      <div class="gright">${hint}
        <div class="keypad">
          <div class="kgrid">${nums.map((n) => `<button data-act="dart" data-v="${n}" ${lock}>${n}</button>`).join('')}</div>
          <div class="krow">
            <button data-act="miss" ${lock}>0</button>
            <button class="dbl ${S.mult === 2 ? 'on' : ''}" data-act="mult" data-v="2" ${lock}>DOUBLE</button>
            <button class="trp ${S.mult === 3 ? 'on' : ''}" data-act="mult" data-v="3" ${lock}>TRIPLE</button>
            <button class="kundo" data-act="kundo" aria-label="Ångra" ${canUndo(m) || S.darts.length ? '' : 'disabled'}>↶</button>
          </div>
        </div>
      </div></div>`;
}

function addDart(base) {
  const m = getMatch(route().id);
  if (!m || m.status !== 'active' || S.locked) return;
  const info = legInfo(m);
  if (evalDarts(info.rem[info.next.team], S.darts, m.outRule).state !== 'open') return;
  let dart;
  if (base === 0) { dart = { v: 0, dbl: false, l: 'Miss' }; toast('Fan… kastar du verkligen med rätt hand? 🤨'); }
  else if (base === 25) dart = S.mult === 2 ? { v: 50, dbl: true, l: 'Bull' } : { v: 25, dbl: false, l: '25' };
  else dart = { v: base * S.mult, dbl: S.mult === 2, l: dartLabel(base, S.mult) };
  S.darts.push(dart);
  S.mult = 1;
  const r = evalDarts(info.rem[info.next.team], S.darts, m.outRule);
  if (r.state !== 'open') {
    // Visa sista pilen en kort stund, byt sedan automatiskt till nästa spelare. Ångra hinner avbryta.
    S.locked = true;
    S.timer = setTimeout(() => { S.timer = null; S.locked = false; submitDarts(); }, 650);
  }
  render();
}
function submitDarts() {
  const m = getMatch(route().id);
  if (!m || m.status !== 'active') return;
  const info = legInfo(m);
  const r = evalDarts(info.rem[info.next.team], S.darts, m.outRule);
  if (r.state === 'open') return;
  const ds = S.darts.map((d) => d.l);
  const thrower = info.next.player.name;
  S.darts = []; S.mult = 1;
  if (r.state === 'checkout') commit(applyTurn(m, 'checkout', r.sum, r.n, ds));
  else if (r.state === 'bust') { commit(applyTurn(m, 'bust', r.sum, 3, ds)); toast('Bust!'); }
  else commit(applyTurn(m, 'ok', r.sum, 3, ds));
  const sp = specialVisit(ds);
  if (sp) celebrate(sp, thrower);
}
// Stor animation när någon får tröja eller byxa.
function celebrate(kind, who) {
  const tro = kind === 'tröja';
  document.getElementById('celebrate')?.remove();
  const el = document.createElement('div');
  el.id = 'celebrate';
  el.setAttribute('role', 'alert');
  const colors = ['#ea4a1f', '#f2b12c', '#e8741c', '#692012', '#faf5ee', '#1f7a4d'];
  const bits = Array.from({ length: 46 }, () => `<i style="left:${Math.random() * 100}%;background:${colors[Math.floor(Math.random() * colors.length)]};animation-delay:${(Math.random() * 0.9).toFixed(2)}s;animation-duration:${(2 + Math.random() * 1.6).toFixed(2)}s;transform:rotate(${Math.floor(Math.random() * 360)}deg)"></i>`).join('');
  el.innerHTML = `<div class="confetti">${bits}</div><div class="cel-card"><div class="cel-emoji">${tro ? '👕' : '👖'}</div>
    <div class="cel-title">${tro ? 'TRÖJA!' : 'BYXA!'}</div>
    <div class="cel-sub">${esc(who)} – ${tro ? '20 · 5 · 1' : '19 · 7 · 3'}</div></div>`;
  const close = () => { clearTimeout(el.t); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', close);
  document.body.appendChild(el);
  el.t = setTimeout(close, 3600);
  try { navigator.vibrate?.([120, 60, 120, 60, 240]); } catch {}
}
function undoDart() {
  const m = getMatch(route().id);
  if (S.timer) { clearTimeout(S.timer); S.timer = null; S.locked = false; S.darts.pop(); return; }
  if (S.darts.length) { S.darts.pop(); return; }
  if (m && canUndo(m)) { saveMatch(undo(m)); toast('Senaste rundan ångrad'); }
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
  if (S.modal?.type !== 'newhome') { el.innerHTML = ''; return; }
  if (el.querySelector('#homename')) return; // behåll det som skrivits
  el.innerHTML = `<div class="overlay" data-act="closemodal"><div class="dialog" role="dialog" aria-modal="true">
    <h2>Skapa nytt hem</h2>
    <p class="muted">Ett hem har egna spelare, matcher och statistik, helt skilt från de andra hemmen. Alla ser vilka hem som finns och kan välja dem i listan.</p>
    <input type="text" id="homename" placeholder="T.ex. Jespers hem" maxlength="40" autocomplete="off" data-enter="createhome" style="width:100%">
    <div class="row spread" style="margin-top:1rem"><button class="link" data-act="closemodal">Avbryt</button><button class="btn" data-act="createhome">Skapa hem</button></div></div></div>`;
  el.querySelector('#homename').focus();
}

function matchHeatCard(m) {
  const people = [...new Map(m.teams.flatMap((t) => t.players).map((p) => [p.id, p])).values()];
  const sel = S.matchHeat === 'all' || !people.some((p) => p.id === S.matchHeat) ? 'all' : S.matchHeat;
  const chips = [['all', 'Alla'], ...people.map((p) => [p.id, playerName(p.id, p.name)])]
    .map(([v, l]) => `<button class="chip sm ${sel === v ? 'on' : ''}" data-act="matchheat" data-v="${v}">${esc(l)}</button>`).join('');
  const data = matchHits(m, sel === 'all' ? null : sel);
  return `<div class="card" style="margin-top:1.2rem"><h3>Heatmap – var pilarna landade i matchen</h3>
    ${people.length > 1 ? `<div class="chips" style="margin-bottom:.8rem">${chips}</div>` : ''}${heatmapCard(data)}</div>`;
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
      return `<tr><td>${esc(playerName(t.p, who?.name))}${t.ds ? `<div class="small muted">${t.ds.join(' · ')}${specialVisit(t.ds) ? ` <b class="sp">${specialVisit(t.ds) === 'tröja' ? '👕 tröja' : '👖 byxa'}</b>` : ''}</div>` : ''}</td><td class="num ${t.bust ? 'muted' : ''}">${t.bust ? `<s>${t.s}</s> bust` : t.s}</td><td class="num">${rem[t.t]}</td></tr>`;
    }).join('');
    return `<details ${li === m.legs.length - 1 ? 'open' : ''}><summary><b>Leg ${li + 1}</b> – ${leg.winner != null ? esc(m.teams[leg.winner].name) + ' vann' : 'ej klart'}</summary>
      <table class="turns"><thead><tr><th>Spelare</th><th class="num">Poäng</th><th class="num">Kvar</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }).join('');
  const practice = m.teams.length === 1;
  const totalDarts = m.legs.reduce((a, l) => a + l.turns.reduce((b, t) => b + t.d, 0), 0);
  return `<div class="winbanner"><h2>${practice ? `Klart, ${esc(winner.name)}!` : `${esc(winner.name)} vann!`}</h2><div>${practice ? `${m.mode} avklarat på ${totalDarts} pilar · snitt ${fmt1(sum[0].avg)}` : `${m.teams.map((t, i) => `${esc(t.name)} ${w[i]}`).join(' – ')} · ${modeLabel(m)}`}</div>
      <div class="small" style="opacity:.85;margin-top:.3rem">${fmtDate(m.finished_at || m.created_at)}</div></div>
    <div class="row" style="margin:1rem 0">
      <button class="btn" data-act="rematch" data-id="${m.id}">Spela igen</button>
      <button class="btn ghost" data-act="undo">↶ Ångra sista kastet</button>
      <button class="btn ghost" data-act="delete" data-id="${m.id}">Ta bort match</button></div>
    <div class="card tablewrap"><table><thead><tr><th>Lag</th><th class="num">Legs</th><th class="num">Snitt</th><th class="num">Högsta</th><th class="num">180</th></tr></thead><tbody>
      ${m.teams.map((t, i) => `<tr><td>${esc(t.name)}</td><td class="num">${w[i]}</td><td class="num">${fmt1(sum[i].avg)}</td><td class="num">${sum[i].high}</td><td class="num">${sum[i].n180}</td></tr>`).join('')}</tbody></table></div>
    ${matchHeatCard(m)}
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
// ----- Trend över tid -----
function trendSeries(form, metric) {
  const base = metric === 'avg' ? form : form.filter((f) => f.won !== null);
  const val = base.map((f) => (metric === 'avg' ? f.avg : f.won ? 100 : 0));
  const w = metric === 'avg' ? 5 : 10;
  return base.map((f, i) => {
    const win = val.slice(Math.max(0, i - w + 1), i + 1);
    return { f, v: val[i], ma: win.reduce((a, b) => a + b, 0) / win.length };
  });
}
function trendChart(form) {
  const metric = S.trendMetric, range = S.trendRange;
  const all = trendSeries(form, metric);
  const pts = range ? all.slice(-range) : all;
  const chips = (cur, act, items) => `<div class="chips">${items.map(([v, l]) => `<button class="chip sm ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const controls = `<div class="row spread" style="margin-bottom:.6rem">${chips(metric, 'trendmetric', [['avg', '3-pilssnitt'], ['win', 'Vinst-%']])}${chips(range, 'trendrange', [[10, '10'], [30, '30'], [0, 'Alla']])}</div>`;
  if (pts.length < 2) return controls + '<p class="muted">Spela minst två matcher för att se utvecklingen.</p>';
  const W = 640, H = 230, L = 38, R = 12, T = 14, B = 28;
  let lo, hi;
  if (metric === 'win') { lo = 0; hi = 100; }
  else {
    const vs = pts.flatMap((p) => [p.v, p.ma]);
    lo = Math.max(0, Math.floor((Math.min(...vs) - 2) / 5) * 5);
    hi = Math.ceil((Math.max(...vs) + 2) / 5) * 5;
    if (hi - lo < 10) hi = lo + 10;
  }
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const unit = metric === 'win' ? '%' : '';
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${Math.round(t)}${unit}</text>`).join('');
  const line = pts.map((p, i) => `${x(i)},${y(p.ma)}`).join(' ');
  const dots = pts.map((p, i) => {
    const label = `${fmtDay(p.f.date)}: ${metric === 'avg' ? fmt1(p.v) : (p.f.won ? 'Vinst' : 'Förlust')}`;
    return `<circle cx="${x(i)}" cy="${y(p.v)}" r="${metric === 'avg' ? 4 : 3.5}" fill="${p.f.won === false ? 'var(--card)' : 'var(--accent)'}" stroke="var(--accent)" stroke-width="1.5" opacity="${metric === 'avg' ? 0.55 : 0.4}"><title>${label}</title></circle>`;
  }).join('');
  // utveckling: snitt av senaste 5 mot de 5 före
  let delta = '';
  if (metric === 'avg' && all.length >= 6) {
    const last = all.slice(-5), prev = all.slice(-10, -5);
    const a = last.reduce((t, p) => t + p.v, 0) / last.length, b = prev.length ? prev.reduce((t, p) => t + p.v, 0) / prev.length : null;
    if (b != null) { const d = a - b; delta = `<p class="trendnote">Senaste 5 matcherna: <b>${fmt1(a)}</b> <span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${fmt1(Math.abs(d))}</span> mot de 5 före</p>`; }
  }
  return `${controls}${delta}<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Utveckling över tid">${grid}
    <polyline fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${line}"/>${dots}
    <text x="${L}" y="${H - 8}" class="ax">${fmtDay(pts[0].f.date)}</text><text x="${W - R}" y="${H - 8}" text-anchor="end" class="ax">${fmtDay(pts[pts.length - 1].f.date)}</text></svg>
    <p class="muted small" style="margin:.3rem 0 0">Linjen är glidande medelvärde (${metric === 'avg' ? '5' : '10'} matcher). Prickarna är enskilda matcher${metric === 'avg' ? '; fylld = vinst, ofylld = förlust' : ''}.</p>`;
}

// ----- Heatmap över träffar -----
const BOARD = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
function polar(r, deg) { const a = ((deg - 90) * Math.PI) / 180; return [r * Math.cos(a), r * Math.sin(a)]; }
function wedgePath(r1, r2, a1, a2) {
  const [x1, y1] = polar(r2, a1), [x2, y2] = polar(r2, a2), [x3, y3] = polar(r1, a2), [x4, y4] = polar(r1, a1);
  const f = (n) => n.toFixed(2);
  return `M${f(x1)} ${f(y1)}A${r2} ${r2} 0 0 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r1} ${r1} 0 0 0 ${f(x4)} ${f(y4)}Z`;
}
function heatmap(hits) {
  const get = (k) => hits[k] || 0;
  const max = Math.max(1, ...BOARD.flatMap((n) => [get('S' + n), get('D' + n), get('T' + n)]), get('25'), get('Bull'));
  const style = (n, i, label) => {
    if (!n) return `fill="var(--line)" fill-opacity="${i % 2 ? 0.35 : 0.6}"`;
    return `fill="var(--accent)" fill-opacity="${(0.15 + 0.85 * Math.sqrt(n / max)).toFixed(2)}"`;
  };
  const RING = { in: [22, 90], tr: [90, 110], out: [110, 150], db: [150, 172] };
  let g = '';
  BOARD.forEach((n, i) => {
    const a1 = i * 18 - 9, a2 = i * 18 + 9;
    const sN = get('S' + n);
    const seg = (ring, kind, cnt, name) => `<path d="${wedgePath(...RING[ring], a1, a2)}" ${style(cnt, i)} stroke="var(--card)" stroke-width="1"><title>${name}: ${cnt}</title></path>`;
    g += seg('in', 'S', sN, 'Singel ' + n) + seg('out', 'S', sN, 'Singel ' + n) + seg('tr', 'T', get('T' + n), 'Trippel ' + n) + seg('db', 'D', get('D' + n), 'Dubbel ' + n);
    const [tx, ty] = polar(188, i * 18);
    g += `<text x="${tx.toFixed(1)}" y="${(ty + 5).toFixed(1)}" text-anchor="middle" class="bn">${n}</text>`;
  });
  g += `<circle r="22" ${style(get('25'), 0)} stroke="var(--card)" stroke-width="1"><title>25: ${get('25')}</title></circle>`;
  g += `<circle r="10" ${style(get('Bull'), 0)} stroke="var(--card)" stroke-width="1"><title>Bull: ${get('Bull')}</title></circle>`;
  return `<svg class="board-svg" viewBox="-205 -205 410 410" role="img" aria-label="Heatmap över träffar">${g}</svg>`;
}
const SEG_NAME = (k) => (k === 'Bull' ? 'Bull' : k === '25' ? '25' : ({ S: 'Singel ', D: 'Dubbel ', T: 'Trippel ' }[k[0]] + k.slice(1)));
function heatmapCard(s) {
  if (!s.dartsTracked) return '<p class="muted">Ingen pildata än. Heatmapen fylls på när du spelar matcher med pil-för-pil-inmatning.</p>';
  const rank = Object.entries(s.hits).filter(([k]) => k !== 'Miss').sort((a, b) => b[1] - a[1]).slice(0, 5);
  const miss = s.hits.Miss || 0;
  return `<div class="heatwrap">${heatmap(s.hits)}
    <div class="heatside"><div class="small muted">Pilar med data</div><div class="big">${s.dartsTracked}</div>
      <div class="small muted" style="margin-top:.6rem">Mest träffat</div>
      <ol class="toplist">${rank.map(([k, n]) => `<li><b>${SEG_NAME(k)}</b> <span>${n} (${Math.round((n / s.dartsTracked) * 100)}%)</span></li>`).join('')}</ol>
      <div class="small muted" style="margin-top:.6rem">Miss: ${miss} (${Math.round((miss / s.dartsTracked) * 100)}%)</div></div></div>
    <div class="legend"><span>Färre</span><i></i><span>Fler träffar</span></div>`;
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
    ${stat('👕 ' + s.troja, 'Tröjor (20·5·1)')}${stat('👖 ' + s.byxa, 'Byxor (19·7·3)')}${stat(s.practice, 'Övningspass')}${stat(s.dartsTracked, 'Pilar med träffdata')}
  </div>
  <div class="card" style="margin-top:1.2rem"><h3>Utveckling över tid</h3>${trendChart(s.form)}</div>
  <div class="grid c2" style="margin-top:1rem">
    <div class="card"><h3>Heatmap – var du träffar</h3>${heatmapCard(s)}</div>
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
    case 'format': setFormat(v); break;
    case 'toggleplayer': togglePlayer(el.dataset.id); break;
    case 'swapteam': u.teams[+el.dataset.i].reverse(); break;
    case 'addplayer': await addPlayerFromInput(); return;
    case 'start': if (canStart()) startMatch(); return;
    case 'mult': S.mult = S.mult === +v ? 1 : +v; break;
    case 'dart': addDart(+v); return;
    case 'miss': addDart(0); return;
    case 'kundo': undoDart(); break;
    case 'undo': {
      const m = getMatch(route().id);
      if (m && canUndo(m)) { S.darts = []; saveMatch(undo(m)); toast('Senaste rundan ångrad'); return; }
      break;
    }
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
      initSetup({ mode: m.mode, outRule: m.outRule, legsToWin: m.legsToWin, format: solo ? 'solo' : 'teams', solo: solo ? rot(ids.flat()) : [], teams: solo ? [] : rot(ids), adding: '', random: false });
      location.hash = '#/ny'; return;
    }
    case 'createhome': await createHome(); return;
    case 'copyhomelink': await copyHomeLink(); return;
    case 'matchheat': S.matchHeat = v; break;
    case 'trendmetric': S.trendMetric = v; break;
    case 'trendrange': S.trendRange = +v; break;
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
  if (e.target.id === 'homesel') {
    if (e.target.value === '__new') { e.target.value = S.home; S.modal = { type: 'newhome' }; render(); }
    else setHome(e.target.value);
    return;
  }
  if (e.target.dataset?.act === 'random') { S.setup.random = e.target.checked; return; }
  const sel = e.target.closest('select');
  if (!sel) return;
  if (sel.dataset.filter) { S[sel.dataset.filter] = sel.value; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'newname' && S.setup) S.setup.adding = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (e.target.dataset?.enter === 'addplayer' && e.key === 'Enter') { addPlayerFromInput(); return; }
  if (e.target.dataset?.enter === 'createhome' && e.key === 'Enter') { createHome(); return; }
  if (route().name !== 'match' || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.metaKey || e.ctrlKey) return;
  const m = getMatch(route().id);
  if (!m || m.status !== 'active') return;
  // Dator: siffror (1–20), d = dubbel, t = trippel, b = bull, 0 = miss, Backspace = ångra
  const flush = () => { clearTimeout(S.keyTimer); const n = S.keybuf; S.keybuf = ''; if (n) addDart(+n); };
  if (/^\d$/.test(e.key)) {
    const next = (S.keybuf || '') + e.key;
    if (+next > 20) { S.keybuf = ''; clearTimeout(S.keyTimer); return; }
    S.keybuf = next;
    clearTimeout(S.keyTimer);
    if (+next >= 3 || next === '0' || +next * 10 > 20) flush(); else S.keyTimer = setTimeout(flush, 500);
    return;
  }
  if (e.key === 'Enter') { flush(); return; }
  if (e.key === 'd') S.mult = S.mult === 2 ? 1 : 2;
  else if (e.key === 't') S.mult = S.mult === 3 ? 1 : 3;
  else if (e.key === 'b') { S.mult = 2; addDart(25); return; }
  else if (e.key === 'Backspace') undoDart();
  else return;
  render();
});

// ---------- start ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
async function init() {
  render();
  const homes = await store.homes();
  if (homes) {
    S.homes = homes;
    const param = new URLSearchParams(location.search).get('home');
    let saved = null;
    try { saved = localStorage.getItem('ci-darts-home'); } catch {}
    setHome([param, saved, DEFAULT_HOME].find((id) => id && homes.some((h) => h.id === id)) || homes[0]?.id || null, false);
    if (param) history.replaceState(null, '', location.pathname + location.hash);
  }
  await refresh();
}
init();
// Håll vyn färsk så att andra kan följa en match från sin egen mobil.
setInterval(() => { if (isShared && !document.hidden && !S.modal && !S.saving) refresh({ quiet: true }); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({ quiet: true }); });
