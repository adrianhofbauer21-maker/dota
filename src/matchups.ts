import { useEffect, useMemo, useRef, useState } from 'react';
import { BRACKET_OPTIONS, type BracketKey } from './meta';
import { sleep, stratzQuery } from './stratz';

/** Gegner-Held -> (Kandidat -> Spiele / Siege DES GEGNERS gegen den Kandidaten) */
export type MatchupTable = Map<number, Map<number, { games: number; wins: number }>>;
/** Eigener Held -> (Kandidat -> gemeinsame Spiele / Siege, wenn beide im selben Team spielen) */
export type SynergyTable = Map<number, Map<number, { games: number; wins: number }>>;

type Rows = [number, number, number][]; // [heroId2, games, wins]
type Rel = { at: number; vs: Rows; with: Rows };

const KEY = 'dota-stratz-relations-v1';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readStore(): Record<string, Rel> { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Rel>; } catch { return {}; } }
function writeStore(s: Record<string, Rel>) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorieren */ } }
const toMap = (rows: Rows) => new Map(rows.map(([id, games, wins]) => [id, { games, wins }] as const));

type Raw = { heroStats: { matchUp: { vs: { heroId2: number; matchCount: number; winCount: number }[]; with: { heroId2: number; matchCount: number; winCount: number }[] }[] } };

async function fetchRelations(heroId: number, basic: readonly string[]): Promise<Rel> {
  const br = basic.length ? `, bracketBasicIds: [${basic.join(', ')}]` : '';
  const q = `{ heroStats { matchUp(heroId: ${heroId}, take: 150${br}) { vs { heroId2 matchCount winCount } with { heroId2 matchCount winCount } } } }`;
  const data = await stratzQuery<Raw>(q);
  const m = data.heroStats.matchUp[0];
  const pack = (l: { heroId2: number; matchCount: number; winCount: number }[] | undefined) => (l ?? []).map(r => [r.heroId2, r.matchCount, r.winCount] as [number, number, number]);
  return { at: Date.now(), vs: pack(m?.vs), with: pack(m?.with) };
}

/**
 * Lädt Matchups (gegen Gegner) und Synergien (mit eigenen Picks) von STRATZ, je Held eine Abfrage, 12 h Cache.
 * STRATZ-Siegzahl bei "vs" = Siege des abgefragten Helden; wir speichern sie als Siege des Gegners.
 */
export function useRelations(allyIds: number[], enemyIds: number[], bracket: BracketKey) {
  const [store, setStore] = useState<Record<string, Rel>>(() => readStore());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(new Set<string>());
  const ids = useMemo(() => [...new Set([...allyIds, ...enemyIds])], [allyIds, enemyIds]);
  const idsKey = ids.join(',');
  const k = (id: number) => `${bracket}|${id}`;

  useEffect(() => {
    const missing = ids.filter(id => {
      const c = store[k(id)];
      return (!c || Date.now() - c.at >= MAX_AGE_MS) && !inFlight.current.has(k(id));
    });
    if (missing.length === 0) return;
    // Bewusst ohne Abbruch-Flag: begonnene Ladeserien laufen zu Ende.
    (async () => {
      setLoading(true);
      for (const id of missing) {
        inFlight.current.add(k(id));
        try {
          let rel: Rel;
          try {
            rel = await fetchRelations(id, BRACKET_OPTIONS[bracket].basic);
          } catch (e) {
            // Rang-Filter nicht akzeptiert -> ohne Filter (alle Ränge) wiederholen
            if (e instanceof Error && e.message.includes('bracketBasicIds')) {
              rel = await fetchRelations(id, []);
              setError('Rang-Filter für Matchups/Synergie nicht verfügbar – alle Ränge verwendet.');
            } else throw e;
          }
          const s = readStore(); s[k(id)] = rel; writeStore(s);
          setStore(prev => ({ ...prev, [k(id)]: rel }));
          setError(prev => (prev.startsWith('Rang-Filter') ? prev : ''));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          inFlight.current.delete(k(id));
        }
        await sleep(300);
      }
      if (inFlight.current.size === 0) setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, bracket]);

  const matchups: MatchupTable = useMemo(() => {
    const out: MatchupTable = new Map();
    for (const id of enemyIds) {
      const c = store[k(id)];
      if (c) out.set(id, toMap(c.vs));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, enemyIds, bracket]);
  const synergy: SynergyTable = useMemo(() => {
    const out: SynergyTable = new Map();
    for (const id of allyIds) {
      const c = store[k(id)];
      if (c) out.set(id, toMap(c.with));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, allyIds, bracket]);

  return { matchups, synergy, loading, error };
}
