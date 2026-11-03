// Dünner Client für die OpenDota API (https://docs.opendota.com).
// Ohne API-Key gilt ein Rate-Limit (ca. 60 Anfragen/Minute), deshalb laden wir
// Spieler nacheinander und cachen Ergebnisse im Browser.

const BASE = 'https://api.opendota.com/api';

export type MatchRow = {
  hero_id: number;
  player_slot: number;
  radiant_win: boolean;
  start_time: number;
  duration: number;
  kills: number;
  deaths: number;
  assists: number;
  position?: string; // nur STRATZ: POSITION_1 .. POSITION_5
};

export type Profile = { name: string | null; rankTier: number | null };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 429) throw new Error('OpenDota Rate-Limit erreicht – bitte kurz warten und erneut laden.');
  if (!res.ok) throw new Error(`OpenDota antwortet mit Fehler ${res.status}`);
  return res.json() as Promise<T>;
}

/** hero_id -> englischer Heldenname (z. B. 129 -> "Mars") */
export async function fetchHeroNames(): Promise<Record<number, string>> {
  const heroes = await getJson<{ id: number; localized_name: string }[]>(`${BASE}/heroes`);
  return Object.fromEntries(heroes.map(h => [h.id, h.localized_name]));
}

export async function fetchProfile(accountId: string): Promise<Profile> {
  const data = await getJson<{ profile?: { personaname?: string }; rank_tier?: number | null }>(
    `${BASE}/players/${accountId}`,
  );
  return { name: data.profile?.personaname ?? null, rankTier: data.rank_tier ?? null };
}

/** Letzte `limit` Spiele (neueste zuerst). Leer, wenn das Profil keine Match-Daten freigibt. */
export async function fetchRecentMatches(accountId: string, limit = 200): Promise<MatchRow[]> {
  const fields = ['hero_id', 'player_slot', 'radiant_win', 'start_time', 'duration', 'kills', 'deaths', 'assists'];
  const query = [`limit=${limit}`, ...fields.map(f => `project=${f}`)].join('&');
  return getJson<MatchRow[]>(`${BASE}/players/${accountId}/matches?${query}`);
}

/** Eintrag aus /heroStats: Stammdaten + Pick/Win-Zähler je Rang-Bracket (1_pick … 8_pick). */
export type HeroStatRaw = {
  id: number;
  localized_name: string;
  primary_attr: 'str' | 'agi' | 'int' | 'all';
  roles?: string[];
  [key: string]: unknown;
};

/** Anzahl Picks/Wins eines Brackets (1 Herald … 8 Immortal); fehlt das Feld, zählt es als 0. */
export function bracketCount(h: HeroStatRaw, bracket: number, kind: 'pick' | 'win'): number {
  const v = h[`${bracket}_${kind}`];
  return typeof v === 'number' ? v : 0;
}

export async function fetchHeroStats(): Promise<HeroStatRaw[]> {
  return getJson<HeroStatRaw[]>(`${BASE}/heroStats`);
}

export type MatchupRow = { hero_id: number; games_played: number; wins: number };

/**
 * Wie oft der Held `heroId` gegen jeden anderen Helden gespielt und gewonnen hat
 * (öffentliche Spiele, ohne Rang- oder Patch-Filter).
 */
export async function fetchMatchups(heroId: number): Promise<MatchupRow[]> {
  return getJson<MatchupRow[]>(`${BASE}/heroes/${heroId}/matchups`);
}

export type PlayerHeroRow = { hero_id: number; games: number; win: number; last_played: number };

/** Gesamtbilanz eines Spielers pro Held über alle seine öffentlichen Spiele (nicht nur die letzten 200). */
export async function fetchPlayerHeroes(accountId: string): Promise<PlayerHeroRow[]> {
  const rows = await getJson<{ hero_id: string | number; games: number; win: number; last_played?: number }[]>(
    `${BASE}/players/${accountId}/heroes`,
  );
  return rows.map(r => ({ hero_id: Number(r.hero_id), games: r.games ?? 0, win: r.win ?? 0, last_played: r.last_played ?? 0 }));
}
