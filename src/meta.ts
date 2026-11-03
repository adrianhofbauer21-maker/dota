import { useEffect, useState } from 'react';
import { bracketCount, fetchHeroStats, type HeroStatRaw } from './opendota';
import { sleep, stratzQuery } from './stratz';

/** Rang-Brackets von OpenDota: 1 Herald, 2 Guardian, 3 Crusader, 4 Archon, 5 Legend, 6 Ancient, 7 Divine, 8 Immortal */
export const BRACKET_OPTIONS = {
  // brackets = OpenDota (Ersatzquelle), stratz = RankBracket (Meta), basic = RankBracketBasicEnum (Matchups/Synergie, gröber)
  immortal:{ label: 'Immortal',          brackets: [8],                      stratz: ['IMMORTAL'],                                 basic: ['DIVINE_IMMORTAL'] },
  top:     { label: 'Divine + Immortal', brackets: [7, 8],                   stratz: ['DIVINE', 'IMMORTAL'],                       basic: ['DIVINE_IMMORTAL'] },
  ancient: { label: 'Ancient+',          brackets: [6, 7, 8],                stratz: ['ANCIENT', 'DIVINE', 'IMMORTAL'],            basic: ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'] },
  legend:  { label: 'Legend+',           brackets: [5, 6, 7, 8],             stratz: ['LEGEND', 'ANCIENT', 'DIVINE', 'IMMORTAL'],  basic: ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'] },
  all:     { label: 'Alle Ränge',        brackets: [1, 2, 3, 4, 5, 6, 7, 8], stratz: [] as string[],                              basic: [] as string[] },
} as const;
export type BracketKey = keyof typeof BRACKET_OPTIONS;

export type MetaEntry = {
  heroId: number;
  games: number;
  wins: number;
  winrate: number; // roh, 0..1
  smoothed: number; // 0..1, Richtung 50 % geglättet
  score?: number;   // 0..100, normalisiert innerhalb des Pools (Position): Winrate-Abstand + Beliebtheit
  share?: number;   // Anteil an allen Spielen im Pool, 0..1
};

// Meta-Zahlen sind groß (Tausende Spiele) – deshalb ein größerer Prior als bei Spielerdaten.
const META_PRIOR_GAMES = 100;

export function metaEntry(heroId: number, games: number, wins: number): MetaEntry {
  return { heroId, games, wins, winrate: wins / games, smoothed: (wins + META_PRIOR_GAMES * 0.5) / (games + META_PRIOR_GAMES) };
}

/** Gewichtung im normalisierten Meta-Score: Winrate (Abstand zum Durchschnitt) und Beliebtheit (Wurzel der relativen Spielzahl). */
const NORM_WIN_WEIGHT = 0.7;
const NORM_STD_POINTS = 20; // 1 Standardabweichung Winrate = 20 Punkte
const NORM_PRIOR_FRAC = 0.15; // Glättung der Winrate: 15 % der Spiele des meistgespielten Helden als virtuelle 50-%-Spiele

/**
 * Normalisiert die Einträge eines Pools (z. B. alle Helden einer Position) damit sie vergleichbar sind:
 * - Winrate: Richtung 50 % geglättet, mit einer Stärke, die zur Poolgröße passt (Helden mit wenigen Spielen
 *   zählen kaum), dann z-Wert -> 50 + 20 * z
 * - Beliebtheit: 100 * Wurzel(Spiele / Spiele des meistgespielten Helden)
 * - score = 70 % Winrate + 30 % Beliebtheit
 * Kalibriert an den ProTracker-Tabellen Mid und Hard Support (7.41f, 7000+ MMR): Rangkorrelation 0.96 (Mittel)
 * statt 0.93 mit der ersten Fassung. ProTracker zählt zusätzlich Bans (Contest Rate), die wir nicht kennen.
 */
export function normalizeMeta(pool: Map<number, MetaEntry>): Map<number, MetaEntry> {
  const list = [...pool.values()];
  const total = list.reduce((s, e) => s + e.games, 0);
  if (list.length === 0 || total === 0) return pool;
  const maxGames = Math.max(...list.map(e => e.games));
  const prior = Math.max(META_PRIOR_GAMES, NORM_PRIOR_FRAC * maxGames);
  const sm = new Map(list.map(e => [e.heroId, (e.wins + prior * 0.5) / (e.games + prior)] as const));
  const mean = list.reduce((s, e) => s + sm.get(e.heroId)! * e.games, 0) / total;
  const variance = list.reduce((s, e) => s + e.games * (sm.get(e.heroId)! - mean) ** 2, 0) / total;
  const std = Math.sqrt(variance) || 1e-9;
  const out = new Map<number, MetaEntry>();
  for (const e of list) {
    const smoothed = sm.get(e.heroId)!;
    const win = Math.max(0, Math.min(100, 50 + NORM_STD_POINTS * ((smoothed - mean) / std)));
    const pop = 100 * Math.sqrt(e.games / maxGames);
    out.set(e.heroId, { ...e, smoothed, share: e.games / total, score: NORM_WIN_WEIGHT * win + (1 - NORM_WIN_WEIGHT) * pop });
  }
  return out;
}

export function buildMeta(raw: HeroStatRaw[], brackets: readonly number[]): Map<number, MetaEntry> {
  const out = new Map<number, MetaEntry>();
  for (const h of raw) {
    let games = 0, wins = 0;
    for (const b of brackets) { games += bracketCount(h, b, 'pick'); wins += bracketCount(h, b, 'win'); }
    if (games === 0) continue;
    out.set(h.id, {
      heroId: h.id,
      games,
      wins,
      winrate: wins / games,
      smoothed: (wins + META_PRIOR_GAMES * 0.5) / (games + META_PRIOR_GAMES),
    });
  }
  return normalizeMeta(out);
}

// ---- Laden + Caching (12 h) ------------------------------------------------
const KEY = 'dota-herostats-v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

type Cached = { at: number; data: HeroStatRaw[] };

function readCache(): Cached | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Cached | null; } catch { return null; }
}

export function useHeroStats(): { raw: HeroStatRaw[]; error: string } {
  const [raw, setRaw] = useState<HeroStatRaw[]>(() => readCache()?.data ?? []);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = readCache();
    if (c && Date.now() - c.at < MAX_AGE_MS) return;
    fetchHeroStats()
      .then(data => {
        setRaw(data);
        setError('');
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data } satisfies Cached)); } catch { /* ignorieren */ }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return { raw, error };
}

// ---- STRATZ: Meta je Position, Rang und Zeitraum ----------------------------
/** Aktueller Patch (Startdatum laut STRATZ: constants.gameVersions.asOfDateTime). Bei einem neuen Patch hier anpassen. */
export const PATCH = { name: '7.41f', start: 1789430400, label: '15.09.2026' };
/** Zeitraum in Tagen; 0 = seit Patch-Start. */
export const DAY_OPTIONS = [0, 7, 14, 28, 56] as const;
export type MetaByPos = Map<number, Map<number, MetaEntry>>; // Position 1..5 -> Held -> Meta

const S_KEY = 'dota-stratz-meta-v2';
const S_MAX_AGE_MS = 6 * 60 * 60 * 1000;
type Rows = [number, number, number][];
type SPayload = { pos: Record<string, Rows>; latest: number; source: 'day' | 'week' };
type SStored = Record<string, SPayload & { at: number }>;

function readS(): SStored { try { return JSON.parse(localStorage.getItem(S_KEY) ?? '{}') as SStored; } catch { return {}; } }
function toMetaByPos(pos: Record<string, Rows>): MetaByPos {
  const out: MetaByPos = new Map();
  for (const [p, rows] of Object.entries(pos)) {
    const m = new Map<number, MetaEntry>();
    for (const [id, games, wins] of rows) if (games > 0) m.set(id, metaEntry(id, games, wins));
    out.set(Number(p), normalizeMeta(m));
  }
  return out;
}

const inflight = new Map<string, Promise<SPayload>>();

type StatRow = { heroId: number; day?: number; week?: number; matchCount: number; winCount: number };

/** Eine Position laden. Bevorzugt Tageswerte (aktueller); fällt auf Wochenwerte zurück, falls winDay nicht geht. */
async function fetchPosition(stratz: readonly string[], position: number, days: number): Promise<{ rows: Rows; latest: number; source: 'day' | 'week' }> {
  const now = Math.floor(Date.now() / 1000);
  const since = days === 0 ? PATCH.start : now - days * 86400;
  const spanDays = Math.ceil((now - since) / 86400);
  const br = stratz.length ? `, bracketIds: [${stratz.join(', ')}]` : '';
  const pos = `positionIds: [POSITION_${position}]`;
  let list: StatRow[]; let source: 'day' | 'week' = 'day';
  try {
    // Reserve, weil Tage in den STRATZ-Daten fehlen können (take zählt vorhandene Tage).
    const q = `{ heroStats { winDay(take: ${spanDays + 10}${br}, ${pos}) { heroId day matchCount winCount } } }`;
    list = (await stratzQuery<{ heroStats: { winDay: StatRow[] } }>(q)).heroStats.winDay;
    if (!Array.isArray(list)) throw new Error('winDay ohne Daten');
  } catch {
    source = 'week';
    const q = `{ heroStats { winWeek(take: ${Math.ceil(spanDays / 7) + 1}${br}, ${pos}) { heroId week matchCount winCount } } }`;
    list = (await stratzQuery<{ heroStats: { winWeek: StatRow[] } }>(q)).heroStats.winWeek;
  }
  const sum = new Map<number, [number, number]>();
  let latest = 0;
  for (const r of list) {
    const t = r.day ?? r.week;
    if (t !== undefined) { if (t < since) continue; if (t > latest) latest = t; }
    const e = sum.get(r.heroId) ?? [0, 0];
    e[0] += r.matchCount; e[1] += r.winCount;
    sum.set(r.heroId, e);
  }
  return { rows: [...sum].map(([id, [g, w]]) => [id, g, w] as [number, number, number]), latest, source };
}

/** Meta je Position (STRATZ). Bei Fehler: meta = null, Fehlertext in error (die App nutzt dann OpenDota). */
export function useStratzMeta(bracket: BracketKey, days: number): { meta: MetaByPos | null; loading: boolean; error: string; latest: number; source: 'day' | 'week' } {
  const key = `${bracket}|${days}`;
  type State = { key: string; meta: MetaByPos | null; error: string; latest: number; source: 'day' | 'week' };
  const fromCache = (): State | null => {
    const c = readS()[key];
    return c && Date.now() - c.at < S_MAX_AGE_MS ? { key, meta: toMetaByPos(c.pos), error: '', latest: c.latest, source: c.source } : null;
  };
  const [state, setState] = useState<State>(() => fromCache() ?? { key: '', meta: null, error: '', latest: 0, source: 'day' });
  useEffect(() => {
    const c = fromCache();
    if (c) { setState(c); return; }
    let alive = true;
    // Gleiche Anfrage nur einmal gleichzeitig (React StrictMode führt Effekte im Dev-Modus doppelt aus).
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        const pos: Record<string, Rows> = {};
        let latest = 0; let source: 'day' | 'week' = 'day';
        for (const p of [1, 2, 3, 4, 5]) {
          const r = await fetchPosition(BRACKET_OPTIONS[bracket].stratz, p, days);
          pos[String(p)] = r.rows; latest = Math.max(latest, r.latest); if (r.source === 'week') source = 'week';
          await sleep(250);
        }
        return { pos, latest, source };
      })().finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    (async () => {
      try {
        const r = await job;
        const all = readS(); all[key] = { at: Date.now(), ...r };
        try { localStorage.setItem(S_KEY, JSON.stringify(all)); } catch { /* ignorieren */ }
        if (alive) setState({ key, meta: toMetaByPos(r.pos), error: '', latest: r.latest, source: r.source });
      } catch (e) {
        if (alive) setState({ key, meta: null, error: e instanceof Error ? e.message : String(e), latest: 0, source: 'day' });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bracket, days]);
  const cur = state.key === key;
  return { meta: cur ? state.meta : null, loading: !cur, error: cur ? state.error : '', latest: cur ? state.latest : 0, source: cur ? state.source : 'day' };
}
