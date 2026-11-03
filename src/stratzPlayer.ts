import type { MatchRow, PlayerHeroRow, Profile } from './opendota';
import { sleep, stratzQuery } from './stratz';

/**
 * Spielerdaten von STRATZ (vollständige Historie, anders als OpenDota, das oft nur einen Teil der Spiele kennt):
 * - Gesamtbilanz pro Held über alle Spiele (heroesPerformance mit großem Fenster)
 * - die letzten Spiele (matches, max. 100 je Seite) für die Form
 * Die Position jedes Spiels wird mitgeführt (position), damit später nur Spiele auf der eigenen Position zählen können.
 */
export type StratzPlayer = { profile: Profile; matches: MatchRow[]; heroes: PlayerHeroRow[]; matchCount: number };

type Info = { player: { steamAccount: { name: string | null } | null; matchCount: number; winCount: number } | null };
type Perf = { player: { heroesPerformance: { heroId: number; matchCount: number; winCount: number }[] } | null };
type Page = { player: { matches: { startDateTime: number; durationSeconds: number; didRadiantWin: boolean;
  players: { heroId: number; isVictory: boolean; kills: number; deaths: number; assists: number; position: string | null }[] }[] } | null };

export async function fetchStratzPlayer(accountId: string, matchLimit = 200): Promise<StratzPlayer> {
  const info = await stratzQuery<Info>(`{ player(steamAccountId: ${accountId}) { steamAccount { name } matchCount winCount } }`);
  if (!info.player) throw new Error('STRATZ kennt diese Account-ID nicht');
  const matchCount = info.player.matchCount ?? 0;
  await sleep(250);
  // Fenster = Spieleanzahl (+ Reserve), damit wirklich alle Spiele gezählt werden.
  const window = Math.max(100, matchCount + 100);
  const perf = await stratzQuery<Perf>(`{ player(steamAccountId: ${accountId}) { heroesPerformance(take: 200, request: { take: ${window} }) { heroId matchCount winCount } } }`);
  const heroes: PlayerHeroRow[] = (perf.player?.heroesPerformance ?? []).map(h => ({ hero_id: h.heroId, games: h.matchCount, win: h.winCount, last_played: 0 }));

  const matches: MatchRow[] = [];
  for (let skip = 0; skip < matchLimit; skip += 100) {
    await sleep(250);
    const take = Math.min(100, matchLimit - skip);
    const page = await stratzQuery<Page>(`{ player(steamAccountId: ${accountId}) { matches(request: { take: ${take}, skip: ${skip} }) { startDateTime durationSeconds didRadiantWin players(steamAccountId: ${accountId}) { heroId isVictory kills deaths assists position } } } }`);
    const rows = page.player?.matches ?? [];
    for (const m of rows) {
      const me = m.players[0];
      if (!me) continue;
      // Die App wertet Siege über Slot + radiant_win; STRATZ liefert direkt isVictory -> Slot 0 (Radiant), radiant_win = isVictory.
      matches.push({ hero_id: me.heroId, player_slot: 0, radiant_win: me.isVictory, start_time: m.startDateTime, duration: m.durationSeconds,
        kills: me.kills, deaths: me.deaths, assists: me.assists, position: me.position ?? undefined });
    }
    if (rows.length < take) break;
  }
  return { profile: { name: info.player.steamAccount?.name ?? null, rankTier: null }, matches, heroes, matchCount };
}
