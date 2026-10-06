import { effective, specialVisit } from './game.js';

const teamOf = (m, pid) => m.teams.findIndex((t) => t.players.some((p) => p.id === pid));

/** Statistik för en spelare över avslutade matcher. mode = 101|301|501|null */
export function playerStats(pid, matches, mode = null) {
  const s = {
    matches: 0, wins: 0, losses: 0,
    legsPlayed: 0, legsWon: 0,
    points: 0, darts: 0, avg: 0,
    highTurn: 0, highCheckout: 0, bestLeg: null,
    n100: 0, n140: 0, n180: 0,
    form: [], // [{date, avg, won}] äldst först
    h2h: {},  // oppId -> {name, w, l}
    hits: {}, // pil-etikett -> antal (S20, T20, D16, 25, Bull, Miss)
    dartsTracked: 0, troja: 0, byxa: 0, practice: 0,
  };
  const fin = matches
    .filter((m) => m.status === 'finished' && (!mode || m.mode === mode) && teamOf(m, pid) >= 0)
    .sort((a, b) => (a.finished_at || a.created_at).localeCompare(b.finished_at || b.created_at));

  for (const m of fin) {
    const ti = teamOf(m, pid);
    const practice = m.teams.length === 1; // ensam spelare = övning, räknas inte som vinst/förlust
    const won = practice ? null : m.winner === ti;
    if (practice) s.practice++;
    else { s.matches++; won ? s.wins++ : s.losses++; }
    let mp = 0, md = 0;
    for (const leg of m.legs) {
      if (leg.winner == null) continue;
      if (!practice) s.legsPlayed++;
      if (leg.winner === ti && !practice) {
        s.legsWon++;
        if (m.teams[ti].players.length === 1) {
          const d = leg.turns.filter((t) => t.t === ti).reduce((a, t) => a + t.d, 0);
          if (s.bestLeg == null || d < s.bestLeg) s.bestLeg = d;
        }
      }
      for (const t of leg.turns) {
        if (t.p !== pid) continue;
        const e = effective(t);
        s.points += e; s.darts += t.d; mp += e; md += t.d;
        if (e > s.highTurn) s.highTurn = e;
        if (e >= 100) s.n100++;
        if (e >= 140) s.n140++;
        if (e === 180) s.n180++;
        if (t.co && t.s > s.highCheckout) s.highCheckout = t.s;
        if (t.ds) {
          for (const l of t.ds) { s.hits[l] = (s.hits[l] || 0) + 1; s.dartsTracked++; }
          const sp = specialVisit(t.ds);
          if (sp === 'tröja') s.troja++;
          else if (sp === 'byxa') s.byxa++;
        }
      }
    }
    s.form.push({ id: m.id, date: m.finished_at || m.created_at, avg: md ? (mp / md) * 3 : 0, won, practice });
    if (!practice) m.teams.forEach((tm, i) => {
      if (i === ti) return;
      for (const p of tm.players) {
        const r = (s.h2h[p.id] ||= { id: p.id, name: p.name, w: 0, l: 0 });
        won ? r.w++ : r.l++;
      }
    });
  }
  s.avg = s.darts ? (s.points / s.darts) * 3 : 0;
  s.winPct = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
  return s;
}

export function matchSummary(m) {
  // snitt per lag i matchen
  return m.teams.map((_, ti) => {
    let p = 0, d = 0, h = 0, n180 = 0;
    for (const leg of m.legs) for (const t of leg.turns) {
      if (t.t !== ti) continue;
      const e = effective(t);
      p += e; d += t.d; if (e > h) h = e; if (e === 180) n180++;
    }
    return { avg: d ? (p / d) * 3 : 0, high: h, n180 };
  });
}

/** Träffar (pil-etikett -> antal) i en enskild match, för en spelare eller alla (pid = null). */
export function matchHits(m, pid = null) {
  const out = { hits: {}, dartsTracked: 0 };
  for (const leg of m.legs) for (const t of leg.turns) {
    if (pid && t.p !== pid) continue;
    for (const l of t.ds || []) { out.hits[l] = (out.hits[l] || 0) + 1; out.dartsTracked++; }
  }
  return out;
}
