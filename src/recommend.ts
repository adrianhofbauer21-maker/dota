import type { MatchupTable, SynergyTable } from './matchups';
import type { MetaEntry } from './meta';
import type { HeroStat } from './stats';

export type Weights = { form: number; experience: number; meta: number; matchup: number; synergy: number; comp: number };
export const DEFAULT_WEIGHTS: Weights = { form: 25, experience: 15, meta: 20, matchup: 15, synergy: 15, comp: 10 };

export type Rec = {
  heroId: number;
  total: number;                 // 0..100
  // Komponenten, je 0..100 (null = keine Daten, wird nicht gewertet)
  form: number | null;           // Form: Winrate (70 %) + Performance/KDA (30 %) der letzten Spiele
  experience: number | null;     // Erfahrung: Gesamtzahl der Spiele auf dem Helden
  meta: number;
  matchup: number | null;        // null = keine gegnerischen Picks / keine Daten
  synergy: number | null;        // null = keine eigenen Picks / keine Daten
  comp: number | null;           // null = weniger als 2 eigene Picks
  // Rohdaten für Tooltips
  totalGames: number;
  totalWinrate: number | null;
  recentGames: number;
  recentWinrate: number | null;
  recentKda: number | null;      // KDA auf dem Helden in den letzten Spielen
  kdaRatio: number | null;       // im Verhältnis zum eigenen Schnitt
  perf: number | null;           // Performance-Score 0..100
  formWin: number | null;        // Form nur aus der Winrate (Punkte)
  formTrust: number | null;      // Vertrauen in die Form aus der Gesamtspielzahl, 0..1
  metaWinrate: number | null;
  metaGames: number;
  matchupDetail: { enemyId: number; winrate: number; games: number }[]; // Winrate des Kandidaten gegen den Gegner
  synergyDetail: { allyId: number; winrate: number; games: number }[]; // Winrate des Kandidaten MIT dem Verbündeten
  compCovers: string[];          // fehlende Team-Fähigkeiten, die der Held abdeckt
  confidence: 'niedrig' | 'mittel' | 'hoch'; // Sicherheit der Spielerdaten (nach Gesamtzahl)
};

/**
 * Winrate (0..1) -> Punkte (0..100). 50 % = 50 Punkte, +/-10 Prozentpunkte = +/-25 Punkte.
 * Gleiche Skala für Form, Meta und Matchups, damit sie vergleichbar gewichtet werden können.
 */
export const toScore = (winrate: number) => Math.max(0, Math.min(100, 50 + (winrate - 0.5) * 250));

const MATCHUP_PRIOR_GAMES = 100;
const PERF_SHARE = 0.3;   // Anteil der Performance (KDA) an der Form, Rest = Winrate
const FORM_CONF_K = 25;   // Vertrauen in die Form = Gesamtspiele / (Gesamtspiele + 25): 9 Spiele -> 26 %, 500 Spiele -> 95 %

/**
 * Form in Punkten: 70 % Winrate (letzte Spiele, geglättet) + 30 % Performance (KDA), dann abhängig von der Gesamtzahl der
 * Spiele auf dem Helden in Richtung 50 gezogen. So kann ein Held mit 9 Spielen und 7 Siegen nicht vor Helden mit
 * hunderten Spielen stehen. Ohne Daten zum Helden (nie gespielt): neutral 50.
 */
export function formPoints(ps: HeroStat | undefined): { points: number; win: number; trust: number } {
  const win = toScore(ps ? ps.form : 0.5);
  const blend = ps?.perf != null ? (1 - PERF_SHARE) * win + PERF_SHARE * ps.perf : win;
  const trust = ps ? ps.totalGames / (ps.totalGames + FORM_CONF_K) : 0;
  return { points: 50 + (blend - 50) * trust, win, trust };
}

/** Fähigkeiten, die ein Team mindestens abdecken sollte (grobe Heuristik auf Basis der OpenDota-Rollen). */
export const COMP_NEEDS: { tag: string; min: number }[] = [
  { tag: 'Initiator', min: 1 },
  { tag: 'Disabler', min: 2 },
  { tag: 'Durable', min: 1 },
];
const COMP_BONUS = 17; // Punkte je abgedeckter Lücke

export type RecommendInput = {
  candidates: number[];                 // erlaubte Hero-IDs (nicht gepickt/gebannt)
  playerStats: Map<number, HeroStat>;   // Hero-ID -> Statistik dieses Spielers
  playerKnown: boolean;                 // liegen für diesen Spieler überhaupt Daten vor?
  meta: Map<number, MetaEntry>;
  weights: Weights;
  allyIds: number[];                    // bereits gepickte eigene Helden
  enemyIds: number[];                   // bereits gepickte gegnerische Helden
  matchups: MatchupTable;
  synergy: SynergyTable;
  rolesById: Map<number, string[]>;     // OpenDota-Rollen-Tags je Held
  limit?: number;
};

/** Welche Fähigkeiten fehlen dem Team noch (anhand der bisherigen Picks)? */
export function missingNeeds(allyIds: number[], rolesById: Map<number, string[]>): string[] {
  return COMP_NEEDS.filter(n => allyIds.filter(id => rolesById.get(id)?.includes(n.tag)).length < n.min).map(n => n.tag);
}

/**
 * Version 4: Form + Erfahrung (Spieler) + Meta (je Position) + Matchup + Synergie + Komposition.
 * - Fehlende Daten sind "unbekannt", nicht "schlecht": eine Komponente ohne Daten wird aus dem Gesamtscore
 *   herausgenommen (statt als 50 zu zählen), die übrigen Gewichte werden neu normiert.
 * - Hat der Spieler Daten, aber nie auf dem Helden gespielt, ist das echte Information: Erfahrung 0,
 *   Form = neutral (50).
 * - Synergie: Winrate des Kandidaten gemeinsam mit den bereits gepickten eigenen Helden (STRATZ).
 */
export function recommend(input: RecommendInput): Rec[] {
  const { candidates, playerStats, playerKnown, meta, weights, allyIds, enemyIds, matchups, synergy, rolesById, limit = 5 } = input;
  const missing = allyIds.length >= 2 ? missingNeeds(allyIds, rolesById) : [];

  const recs = candidates.map<Rec>(heroId => {
    const ps = playerStats.get(heroId);
    const me = meta.get(heroId);
    // Form = Winrate auf dem Helden in den letzten Spielen (geglättet) + Performance (KDA im Vergleich zum eigenen Schnitt)
    const fp = formPoints(ps);
    const formWin = playerKnown ? fp.win : null;
    const form = playerKnown ? fp.points : null;
    const experience = playerKnown ? (ps ? ps.experience : 0) : null;
    const metaScore = me ? (me.score ?? toScore(me.smoothed)) : 50;

    // Matchup: Gegner-Held e hat g Spiele gegen unseren Kandidaten c und w Siege -> c gewinnt g - w.
    const matchupDetail: Rec['matchupDetail'] = [];
    for (const enemyId of enemyIds) {
      const row = matchups.get(enemyId)?.get(heroId);
      if (!row || row.games === 0) continue;
      matchupDetail.push({ enemyId, games: row.games, winrate: (row.games - row.wins + MATCHUP_PRIOR_GAMES * 0.5) / (row.games + MATCHUP_PRIOR_GAMES) });
    }
    const matchup = matchupDetail.length > 0
      ? toScore(matchupDetail.reduce((sum, d) => sum + d.winrate, 0) / matchupDetail.length)
      : null;

    // Synergie: Verbündeter a hat g gemeinsame Spiele mit dem Kandidaten c und w Siege.
    const synergyDetail: Rec['synergyDetail'] = [];
    for (const allyId of allyIds) {
      const row = synergy.get(allyId)?.get(heroId);
      if (!row || row.games === 0) continue;
      synergyDetail.push({ allyId, games: row.games, winrate: (row.wins + MATCHUP_PRIOR_GAMES * 0.5) / (row.games + MATCHUP_PRIOR_GAMES) });
    }
    const synergyScore = synergyDetail.length > 0
      ? toScore(synergyDetail.reduce((sum, d) => sum + d.winrate, 0) / synergyDetail.length)
      : null;

    const myRoles = rolesById.get(heroId) ?? [];
    const compCovers = missing.filter(tag => myRoles.includes(tag));
    const comp = allyIds.length >= 2 ? Math.min(100, 50 + COMP_BONUS * compCovers.length) : null;

    const parts: [number | null, number][] = [
      [form, weights.form], [experience, weights.experience], [metaScore, weights.meta], [matchup, weights.matchup], [synergyScore, weights.synergy], [comp, weights.comp],
    ];
    let sum = 0, wsum = 0;
    for (const [score, w] of parts) if (score !== null && w > 0) { sum += score * w; wsum += w; }
    const totalGames = ps?.totalGames ?? 0;
    return {
      heroId,
      total: wsum > 0 ? sum / wsum : 50,
      form,
      experience,
      meta: metaScore,
      matchup,
      synergy: synergyScore,
      comp,
      totalGames,
      totalWinrate: ps?.totalWinrate ?? null,
      recentGames: ps?.games ?? 0,
      recentWinrate: ps?.winrate ?? null,
      recentKda: ps?.kda ?? null,
      kdaRatio: ps?.kdaRatio ?? null,
      perf: ps?.perf ?? null,
      formWin,
      formTrust: playerKnown ? fp.trust : null,
      metaWinrate: me ? me.winrate : null,
      metaGames: me?.games ?? 0,
      matchupDetail,
      synergyDetail,
      compCovers,
      confidence: totalGames >= 10 ? 'hoch' : totalGames >= 4 ? 'mittel' : 'niedrig',
    };
  });
  return recs.sort((a, b) => b.total - a.total || b.totalGames - a.totalGames).slice(0, limit);
}
