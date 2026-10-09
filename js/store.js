// Lagring: Supabase (delad) om config.js är ifylld, annars localStorage (lokalt läge).
// Allt data hör till ett "hem" (home_id). Finns inte homes-tabellen än körs appen utan hem (äldre läge).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isShared = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
// Det ursprungliga hemmet ("Ci"). Samma id som i supabase/schema.sql.
export const DEFAULT_HOME = '00000000-0000-4000-8000-000000000001';

// ---------- Supabase via REST ----------
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}
const inHome = (home) => (home ? `&home_id=eq.${encodeURIComponent(home)}` : '');

const remote = {
  /** Lista över hem, eller null om homes-tabellen inte finns (då körs appen utan hem). */
  async homes() {
    try { return await rest('homes?select=id,name,created_at&order=created_at.asc'); } catch { return null; }
  },
  async addHome(h) {
    await rest('homes', { method: 'POST', body: h });
  },
  async players(home) {
    return rest(`players?select=id,name,created_at&order=name.asc${inHome(home)}`);
  },
  async addPlayer(p) {
    await rest('players', { method: 'POST', body: p });
  },
  async renamePlayer(id, name) {
    await rest(`players?id=eq.${id}`, { method: 'PATCH', body: { name } });
  },
  async matches(home) {
    const rows = await rest(`matches?select=data&order=created_at.desc&limit=2000${inHome(home)}`);
    return rows.map((r) => r.data);
  },
  async saveMatch(m) {
    await rest('matches?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        id: m.id, status: m.status, mode: m.mode,
        created_at: m.created_at, updated_at: new Date().toISOString(), data: m,
        ...(m.home_id ? { home_id: m.home_id } : {}),
      },
    });
  },
  async deleteMatch(id) {
    await rest(`matches?id=eq.${id}`, { method: 'DELETE' });
  },
};

// ---------- localStorage ----------
const KEY = 'ci-darts-v1';
const read = () => {
  let d;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
  d = d || { players: [], matches: [] };
  if (!d.homes || !d.homes.length) d.homes = [{ id: DEFAULT_HOME, name: 'Ci', created_at: new Date().toISOString() }];
  return d;
};
const write = (d) => localStorage.setItem(KEY, JSON.stringify(d));
// Data utan home_id (äldre) hör till det ursprungliga hemmet.
const mine = (x, home) => (x.home_id || DEFAULT_HOME) === (home || DEFAULT_HOME);

const local = {
  async homes() {
    return read().homes;
  },
  async addHome(h) {
    const d = read();
    d.homes.push(h);
    write(d);
  },
  async players(home) {
    return read().players.filter((p) => mine(p, home)).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  },
  async addPlayer(p) {
    const d = read();
    d.players.push(p);
    write(d);
  },
  async renamePlayer(id, name) {
    const d = read();
    const p = d.players.find((x) => x.id === id);
    if (p) p.name = name;
    write(d);
  },
  async matches(home) {
    return read().matches.filter((m) => mine(m, home)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async saveMatch(m) {
    const d = read();
    const i = d.matches.findIndex((x) => x.id === m.id);
    i >= 0 ? (d.matches[i] = m) : d.matches.push(m);
    write(d);
  },
  async deleteMatch(id) {
    const d = read();
    d.matches = d.matches.filter((x) => x.id !== id);
    write(d);
  },
};

export const store = isShared ? remote : local;
