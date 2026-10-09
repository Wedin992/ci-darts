// Ren spellogik – inga beroenden mot DOM/nätverk så att den går att testa i Node.

// Summor som inte går att kasta med tre pilar.
export const IMPOSSIBLE = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179]);
// Rester som inte går att checka ut med dubbel (≤170).
const NO_CHECKOUT = new Set([159, 162, 163, 165, 166, 168, 169]);

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const canCheckout = (rem) => rem >= 2 && rem <= 170 && !NO_CHECKOUT.has(rem);

/**
 * teams: [{ name, players: [{id, name}] }]
 */
export function newMatch({ mode, outRule, legsToWin, teams }) {
  return {
    id: uid(),
    rev: 1,
    created_at: new Date().toISOString(),
    status: 'active',
    mode,
    outRule, // 'double' | 'straight'
    legsToWin,
    teams,
    legs: [{ starter: 0, turns: [], winner: null }],
    winner: null,
  };
}

export const currentLeg = (m) => m.legs[m.legs.length - 1];

export function legInfo(m, leg = currentLeg(m)) {
  const n = m.teams.length;
  const rem = m.teams.map(() => m.mode);
  const darts = m.teams.map(() => 0);
  for (const t of leg.turns) {
    darts[t.t] += t.d;
    if (t.co) rem[t.t] = 0;
    else if (!t.bust) rem[t.t] -= t.s;
  }
  const i = leg.turns.length;
  const team = (leg.starter + i) % n;
  const members = m.teams[team].players;
  const player = members[Math.floor(i / n) % members.length];
  return { rem, darts, next: { team, player } };
}

export function legsWon(m) {
  const w = m.teams.map(() => 0);
  for (const l of m.legs) if (l.winner != null) w[l.winner]++;
  return w;
}

/**
 * Bedömer en inmatad runda (summa av tre pilar).
 * 'invalid' | 'bust' | 'checkout' | 'ok'
 * 'checkout' betyder att summan är lika med resten – UI frågar efter dubbel/antal pilar.
 */
export function evaluate(rem, s, outRule) {
  if (!Number.isInteger(s) || s < 0 || s > 180 || IMPOSSIBLE.has(s)) return 'invalid';
  if (s > rem) return 'bust';
  if (s === rem) {
    if (s === 0) return 'ok';
    return outRule === 'straight' || canCheckout(rem) ? 'checkout' : 'bust';
  }
  if (outRule === 'double' && rem - s === 1) return 'bust';
  return 'ok';
}

/** Vilka pilantal (1–3) som är möjliga för att checka ut `rem`. */
export function dartsOptions(rem, outRule) {
  const max1 = outRule === 'double' ? (rem <= 40 && rem % 2 === 0) || rem === 50 : rem <= 60;
  const out = [];
  if (max1) out.push(1);
  if (rem <= (outRule === 'double' ? 110 : 120)) out.push(2);
  out.push(3);
  return out;
}

/**
 * Bedömer pilarna i en runda (pil för pil). darts: [{v, dbl, l}]
 * state: 'open' (fler pilar kan kastas) | 'complete' (3 pilar) | 'bust' | 'checkout'
 * left = vad som återstår efter rundan (vid bust oförändrat).
 */
export function evalDarts(rem, darts, outRule) {
  let r = rem, sum = 0;
  for (let i = 0; i < darts.length; i++) {
    const d = darts[i];
    sum += d.v; r -= d.v;
    if (r < 0 || (outRule === 'double' && r === 1)) return { state: 'bust', sum, left: rem, n: i + 1 };
    if (r === 0) {
      if (outRule === 'double' && !d.dbl) return { state: 'bust', sum, left: rem, n: i + 1 };
      return { state: 'checkout', sum, left: 0, n: i + 1 };
    }
  }
  return { state: darts.length >= 3 ? 'complete' : 'open', sum, left: r, n: darts.length };
}

/** kind: 'ok' | 'bust' | 'checkout'. ds = pilarnas etiketter, t.ex. ['T20','S5','D10'] */
export function applyTurn(m, kind, s, darts = 3, ds) {
  const c = structuredClone(m);
  const leg = currentLeg(c);
  const { next } = legInfo(c, leg);
  const turn = { t: next.team, p: next.player.id, s, d: kind === 'checkout' ? darts : 3 };
  if (ds && ds.length) turn.ds = ds;
  if (kind === 'bust') turn.bust = true;
  if (kind === 'checkout') turn.co = true;
  leg.turns.push(turn);
  if (kind === 'checkout') {
    leg.winner = next.team;
    if (legsWon(c)[next.team] >= c.legsToWin) {
      c.status = 'finished';
      c.winner = next.team;
      c.finished_at = new Date().toISOString();
    } else {
      c.legs.push({
        starter: (c.legs[0].starter + c.legs.length) % c.teams.length,
        turns: [],
        winner: null,
      });
    }
  }
  c.rev = (c.rev || 0) + 1;
  return c;
}

export function canUndo(m) {
  return m.legs.some((l) => l.turns.length > 0);
}

export function undo(m) {
  if (!canUndo(m)) return m;
  const c = structuredClone(m);
  let leg = currentLeg(c);
  if (!leg.turns.length) {
    c.legs.pop();
    leg = currentLeg(c);
  }
  leg.turns.pop();
  leg.winner = null;
  c.status = 'active';
  c.winner = null;
  delete c.finished_at;
  c.rev = (c.rev || 0) + 1;
  return c;
}

export const effective = (t) => (t.bust ? 0 : t.s);

// ---------- Checkout-förslag ----------
const DOUBLE_PREF = [20, 16, 8, 10, 18, 12, 4, 6, 14, 2, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

function allDarts() {
  const d = [];
  for (let n = 20; n >= 1; n--) d.push({ v: 3 * n, l: 'T' + n });
  d.push({ v: 50, l: 'Bull' });
  for (let n = 20; n >= 1; n--) d.push({ v: 2 * n, l: 'D' + n });
  d.push({ v: 25, l: '25' });
  for (let n = 20; n >= 1; n--) d.push({ v: n, l: 'S' + n });
  return d;
}
const THROWS = allDarts();
const DOUBLES = [{ v: 50, l: 'Bull' }, ...DOUBLE_PREF.map((n) => ({ v: 2 * n, l: 'D' + n }))];

/** Returnerar t.ex. ['T20','T20','D20'] eller null. Endast dubbel-ut. */
export function checkoutHint(rem) {
  if (!canCheckout(rem)) return null;
  for (const last of DOUBLES) if (last.v === rem) return [last.l];
  for (const last of DOUBLES) {
    for (const a of THROWS) if (a.v + last.v === rem) return [a.l, last.l];
  }
  for (const last of DOUBLES) {
    for (const a of THROWS) {
      for (const b of THROWS) if (a.v + b.v + last.v === rem) return [a.l, b.l, last.l];
    }
  }
  return null;
}

// Hur naturliga olika pilar är som uppsättning (lägre = bättre): T20…T10, Bull, singlar, sedan resten.
const PREF = [
  ...Array.from({ length: 11 }, (_, i) => 'T' + (20 - i)),
  'Bull',
  ...Array.from({ length: 20 }, (_, i) => 'S' + (20 - i)),
  '25',
  ...Array.from({ length: 9 }, (_, i) => 'T' + (9 - i)),
  ...Array.from({ length: 20 }, (_, i) => 'D' + (20 - i)),
];

/**
 * Möjliga avslut för `rem` med högst `dartsLeft` pilar kvar i rundan.
 * Returnerar upp till `max` vägar, t.ex. [['T20','T20','Bull'], ['T20','S10','D20'], …],
 * sorterade med färst pilar först. Dubbel ut: sista pilen måste vara dubbel/Bull.
 */
export function checkoutRoutes(rem, dartsLeft, outRule, max = 3) {
  if (dartsLeft < 1 || rem < 2 || rem > (outRule === 'double' ? 170 : 180)) return [];
  const finishers = outRule === 'double' ? DOUBLES : THROWS;
  const idx = new Map(THROWS.map((t, i) => [t.l, i]));
  const pref = new Map(PREF.map((l, i) => [l, i]));
  const found = []; // {n, labels, score}
  const push = (arr) => {
    const last = arr[arr.length - 1];
    const lastPref = outRule === 'double' ? DOUBLES.findIndex((d) => d.l === last.l) : idx.get(last.l);
    found.push({ n: arr.length, labels: arr.map((d) => d.l), key: lastPref, first: arr.slice(0, -1).reduce((a, d) => a + pref.get(d.l), 0) });
  };
  for (const f of finishers) {
    if (f.v === rem) push([f]);
    if (dartsLeft >= 2) for (const a of THROWS) {
      if (a.v + f.v === rem) push([a, f]);
      if (dartsLeft >= 3 && a.v + f.v < rem) for (const b of THROWS) {
        if (idx.get(b.l) < idx.get(a.l)) continue; // undvik dubletter i ordning
        if (a.v + b.v + f.v === rem) push([a, b, f]);
      }
    }
  }
  found.sort((x, y) => x.n - y.n || x.first - y.first || x.key - y.key);
  // Ta bästa väg för varje antal pilar, fyll sedan på med alternativ som slutar på annan dubbel.
  if (!found.length) return [];
  const minN = found[0].n;
  const out = [], seen = new Set();
  const take = (r) => { out.push(r.labels); seen.add(r); };
  for (const n of [1, 2, 3]) {
    const r = found.find((x) => x.n === n);
    if (r && r.n <= minN + 1 && out.length < max) take(r);
  }
  for (const r of found) {
    if (out.length >= max) break;
    if (seen.has(r) || r.n > minN + 1) continue;
    if (out.some((o) => o[o.length - 1] === r.labels[r.labels.length - 1] && o.length === r.n)) continue;
    take(r);
  }
  return out.sort((a, b) => a.length - b.length);
}

/**
 * Tröja = singel 20, singel 5 och singel 1 i samma runda. Byxa = singel 19, singel 7 och singel 3.
 * Valfri ordning, men alla tre pilar måste vara singlar (ingen dubbel, trippel, 25 eller Bull).
 * ds = pilarnas etiketter, t.ex. ['S20','S5','S1'].
 */
export function specialVisit(ds) {
  if (!ds || ds.length !== 3 || !ds.every((l) => /^S\d+$/.test(l))) return null;
  const k = ds.map((l) => +l.slice(1)).sort((a, b) => a - b).join();
  if (k === '1,5,20') return 'tröja';
  if (k === '3,7,19') return 'byxa';
  return null;
}

/**
 * Byter ut en spelare mot en annan i en match (t.ex. om fel person valdes).
 * Alla kast som tillhörde `fromId` tillskrivs `to`, och lagnamnen uppdateras.
 * Returnerar null om bytet inte går (spelaren finns inte, eller `to` är redan med i matchen).
 */
export function replacePlayer(m, fromId, to) {
  const all = m.teams.flatMap((t) => t.players.map((p) => p.id));
  if (!all.includes(fromId) || fromId === to.id || all.includes(to.id)) return null;
  const c = structuredClone(m);
  for (const t of c.teams) {
    t.players = t.players.map((p) => (p.id === fromId ? { id: to.id, name: to.name } : p));
    t.name = t.players.map((p) => p.name).join(' & ');
  }
  for (const leg of c.legs) for (const turn of leg.turns) if (turn.p === fromId) turn.p = to.id;
  c.rev = (c.rev || 0) + 1;
  return c;
}
