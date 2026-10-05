// Lagring: Supabase (delad) om config.js är ifylld, annars localStorage (lokalt läge).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isShared = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

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

const remote = {
  async players() {
    return rest('players?select=id,name,created_at&order=name.asc');
  },
  async addPlayer(p) {
    await rest('players', { method: 'POST', body: p });
  },
  async renamePlayer(id, name) {
    await rest(`players?id=eq.${id}`, { method: 'PATCH', body: { name } });
  },
  async matches() {
    const rows = await rest('matches?select=data&order=created_at.desc&limit=2000');
    return rows.map((r) => r.data);
  },
  async saveMatch(m) {
    await rest('matches?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        id: m.id, status: m.status, mode: m.mode,
        created_at: m.created_at, updated_at: new Date().toISOString(), data: m,
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
  try { return JSON.parse(localStorage.getItem(KEY)) || { players: [], matches: [] }; }
  catch { return { players: [], matches: [] }; }
};
const write = (d) => localStorage.setItem(KEY, JSON.stringify(d));

const local = {
  async players() {
    return read().players.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
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
  async matches() {
    return read().matches.sort((a, b) => b.created_at.localeCompare(a.created_at));
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
