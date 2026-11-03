import type { PlayerHeroRow } from './opendota';

/**
 * Liest die kopierte Heldentabelle der Dotabuff-Spielerseite ("Heroes") ein.
 * Pro Held stehen untereinander: Name, "vor X"/Datum, Spiele, Winrate in %, KDA, Rolle, Lane.
 * Es wird nur das Text-Muster ausgewertet, das der Nutzer selbst eingefügt hat.
 */
export const normHeroName = (n: string) => n.toLowerCase().replace(/[’'`.]/g, '').replace(/\s+/g, ' ').trim();

const WHEN = /(\bago\b|^\d{4}-\d{2}-\d{2}$|^(today|yesterday)$)/i;

export function parseDotabuffHeroes(text: string, nameToId: Map<string, number>): { rows: PlayerHeroRow[]; unknown: string[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const byHero = new Map<number, PlayerHeroRow>();
  const unknown: string[] = [];
  for (let i = 0; i + 3 < lines.length; i++) {
    const [name, when, games, rate] = [lines[i], lines[i + 1], lines[i + 2], lines[i + 3]];
    if (!WHEN.test(when) || !/^\d[\d.,]*$/.test(games) || !/^\d+([.,]\d+)?\s*%$/.test(rate)) continue;
    const g = Number(games.replace(/[.,]/g, ''));
    const pct = Number(rate.replace('%', '').replace(',', '.'));
    const id = nameToId.get(normHeroName(name));
    if (id === undefined) { unknown.push(name); continue; }
    byHero.set(id, { hero_id: id, games: g, win: Math.round((g * pct) / 100), last_played: 0 });
  }
  return { rows: [...byHero.values()], unknown };
}
