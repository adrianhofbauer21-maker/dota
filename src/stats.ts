import type { MatchRow, PlayerHeroRow } from './opendota';

export type Confidence = 'niedrig' | 'mittel' | 'hoch';

export type HeroStat = {
  heroId: number;
  // Gesamt (alle öffentlichen Spiele des Spielers)
  totalGames: number;
  totalWins: number;
  totalWinrate: number | null;   // 0..1, null ohne Spiele
  experience: number;            // 0..100, Vertrautheit aus der Gesamtzahl der Spiele
  // Letzte N Spiele (Form)
  games: number;                 // Spiele auf dem Helden in den geladenen letzten Spielen
  wins: number;
  winrate: number | null;        // roh
  kda: number | null;            // (K + A) / max(1, D) auf diesem Helden in den letzten Spielen
  kdaRatio: number | null;       // dieses KDA im Verhältnis zum eigenen Durchschnitts-KDA aller letzten Spiele (1 = wie sonst)
  perf: number | null;           // Performance-Score 0..100 (50 = wie sonst), bei wenigen Spielen Richtung 50 gedämpft
  form: number;                  // 0..1, geglättete Winrate der letzten Spiele (Prior = Gesamt-Winrate)
  score: number;                 // form in Punkten 0..100 (zur Anzeige)
  confidence: Confidence;        // Sicherheit nach Gesamtzahl der Spiele
};

// Form = Winrate der letzten Spiele, geglättet in Richtung der Winrate des Spielers auf diesem Helden in den
// älteren Spielen (ohne ältere Spiele: 50 %). So zählt Historie, wenn es wenige aktuelle Spiele gibt, und 2 von 2 Siegen
// ist nicht automatisch besser als 14 von 20.
//   form = (wins + PRIOR_GAMES * priorMean) / (games + PRIOR_GAMES)
// Das ist eine Startversion – Gegnerstärke und Impact kommen später dazu.
const PRIOR_GAMES = 8;
const TOTAL_PRIOR_GAMES = 20; // Glättung der älteren Winrate (Richtung 50 %): wenige alte Spiele zählen kaum
const EXPERIENCE_HALF = 40;  // Bei 40 Spielen auf dem Helden: 50 Erfahrungspunkte
const EXP_WR_PRIOR = 10;     // Glättung der Gesamtwinrate für den Erfahrungsfaktor
const EXP_WR_SPREAD = 2.5;   // 40 % Winrate → Faktor 0,75; 60 % → 1,25 (gedeckelt auf 0,5–1,2)
const PERF_PRIOR = 8;        // Glättung der Performance Richtung "wie sonst"
const PERF_SPREAD = 60;      // KDA 50 % über dem eigenen Schnitt = +30 Punkte (bei voller Stichprobe)

export function confidenceFor(games: number): Confidence {
  if (games >= 10) return 'hoch';
  if (games >= 4) return 'mittel';
  return 'niedrig';
}

export const experienceScore = (games: number, wins?: number) => {
  const base = (100 * games) / (games + EXPERIENCE_HALF);
  if (wins === undefined) return base;
  // Viele Spiele mit schlechter Winrate zählen weniger: Faktor aus der geglätteten Gesamtwinrate (50 % = 1,0).
  const wr = (wins + EXP_WR_PRIOR * 0.5) / (games + EXP_WR_PRIOR);
  const factor = Math.max(0.5, Math.min(1.2, 1 + EXP_WR_SPREAD * (wr - 0.5)));
  return Math.min(100, base * factor);
};

export function isWin(m: MatchRow): boolean {
  const radiant = m.player_slot < 128;
  return radiant === m.radiant_win;
}

export function heroStats(recent: MatchRow[], totals: PlayerHeroRow[]): HeroStat[] {
  const byHero = new Map<number, { games: number; wins: number; k: number; d: number; a: number }>();
  for (const m of recent) {
    const e = byHero.get(m.hero_id) ?? { games: 0, wins: 0, k: 0, d: 0, a: 0 };
    e.games += 1;
    if (isWin(m)) e.wins += 1;
    e.k += m.kills ?? 0;
    e.d += m.deaths ?? 0;
    e.a += m.assists ?? 0;
    byHero.set(m.hero_id, e);
  }
  // Eigenes Durchschnitts-KDA über alle geladenen Spiele: Vergleichsmaßstab, damit Rollen (Support/Carry) fair bleiben.
  let allK = 0, allD = 0, allA = 0;
  for (const e of byHero.values()) { allK += e.k; allD += e.d; allA += e.a; }
  const overallKda = recent.length > 0 ? (allK + allA) / Math.max(1, allD) : null;
  const totalBy = new Map(totals.map(t => [t.hero_id, t]));
  const ids = new Set<number>([...byHero.keys(), ...totalBy.keys()]);
  return [...ids]
    .map(heroId => {
      const r = byHero.get(heroId);
      const t = totalBy.get(heroId);
      // Falls die Gesamtliste fehlt (z. B. Abruf fehlgeschlagen), sind die letzten Spiele das Minimum.
      const totalGames = Math.max(t?.games ?? 0, r?.games ?? 0);
      const totalWins = t ? t.win : r?.wins ?? 0;
      const totalWinrate = totalGames > 0 ? totalWins / totalGames : null;
      const games = r?.games ?? 0;
      const wins = r?.wins ?? 0;
      // Prior nur aus den älteren Spielen (Gesamt minus letzte Spiele), damit aktuelle Spiele nicht doppelt zählen.
      const olderGames = Math.max(0, totalGames - games);
      const olderWins = Math.max(0, totalWins - wins);
      const priorMean = (olderWins + TOTAL_PRIOR_GAMES * 0.5) / (olderGames + TOTAL_PRIOR_GAMES);
      // Form beschreibt nur die letzten Spiele: ohne ein Spiel auf dem Helden dort ist sie neutral (50 %),
      // sonst wird die Winrate dieser Spiele in Richtung der geglätteten älteren Winrate gezogen.
      const form = games === 0 ? 0.5 : (wins + PRIOR_GAMES * priorMean) / (games + PRIOR_GAMES);
      const kda = r ? (r.k + r.a) / Math.max(1, r.d) : null;
      const kdaRatio = kda !== null && overallKda !== null && overallKda > 0 ? kda / overallKda : null;
      const perf = kdaRatio !== null
        ? 50 + PERF_SPREAD * Math.max(-0.5, Math.min(0.5, kdaRatio - 1)) * (games / (games + PERF_PRIOR))
        : null;
      return {
        heroId,
        totalGames,
        totalWins,
        totalWinrate,
        experience: experienceScore(totalGames, totalWins),
        games,
        wins,
        winrate: games > 0 ? wins / games : null,
        kda,
        kdaRatio,
        perf,
        form,
        score: form * 100,
        confidence: confidenceFor(totalGames),
      } satisfies HeroStat;
    })
    .sort((a, b) => b.experience - a.experience || b.score - a.score);
}
