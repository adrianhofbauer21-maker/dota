// Liga 4 (Being eSports, Reincarnation) – Stand der Kaderseiten: 03.11.2026.
// Quelle: https://beingesports.com/de/dota2/reincarnation/teams?liga=4 und die jeweiligen Team-Seiten.
// Nur Spielername/Kürzel und Dotabuff-ID (= Steam32-ID), keine weiteren persönlichen Angaben.
// Rollen: 1 Carry, 2 Mid, 3 Offlane, 4 Soft Support, 5 Hard Support, 0 Flex/Ersatz.

import type { Role } from './team';

export type LeaguePlayer = { name: string; role: Role; accountId: string };
export type LeagueTeam = { tag: string; name: string; players: LeaguePlayer[] };

export const LEAGUE_UPDATED = '03.11.2026';

const P = (name: string, role: Role, accountId: string): LeaguePlayer => ({ name, role, accountId });

export const LEAGUE_TEAMS: LeagueTeam[] = [
  { tag: 'KUK', name: 'Kruste oder Klatsche', players: [
    P('hi6hoW-', 0, '97024483'), P('strawheaD`', 0, '13275722'), P('Chilla_Deluxe', 2, '95761767'),
    P('Captain Tao', 4, '86806018'), P('Vinyldays', 5, '209186051'),
    P('LangustenKruste (Ersatz)', 0, '129266713'), P('anTIDOta (Ersatz)', 0, '59935605'),
  ] },
  { tag: 'EVWD', name: 'Everwood', players: [
    P('MoneyIsGone', 1, '313063991'), P('Walt Sam B.', 2, '222787389'), P('SimT', 3, '99684811'),
    P('Er1k', 3, '98197941'), P('Erzi', 5, '50177213'), P('erklaerbaer (Ersatz)', 5, '17964892'),
  ] },
  { tag: 'SOSA', name: 'SOS Esports Academy', players: [
    P('Matteo G.', 1, '151209208'), P('Mario D.', 2, '125635946'), P('David v. A.', 3, '61219753'),
    P('Gabrijel G.', 3, '81236077'), P('TiBiX', 4, '140187537'), P('Inseyeght', 5, '83237348'), P('Remo H. (Flex)', 0, '234092062'),
  ] },
  { tag: 'GMA', name: 'Ghoulmode Academy', players: [
    P('Starkiller', 1, '74184991'), P('Cascade', 2, '151765055'), P('DrPlongDingDong', 3, '45499250'),
    P('TheCoach', 4, '186862022'), P('Heinz007', 5, '86949352'),
    P('Morky (Ersatz)', 5, '150378108'), P('J0k3r (Ersatz)', 0, '111011953'),
  ] },
  { tag: 'PWA', name: 'PW:Angela', players: [
    P('Jake-', 1, '87342412'), P('Tomi', 2, '60774914'), P('Berdi9', 3, '114326264'),
    P('P3ngine', 4, '442340372'), P('Iboten', 5, '132502961'), P('Zerb', 0, '179651366'),
  ] },
  { tag: 'HGIL', name: 'highground is lava', players: [
    P('pawz', 1, '31776195'), P('Piston', 2, '60573141'), P('sadgasm', 3, '11438318'),
    P('KarmaGG', 4, '76163646'), P('h-Run', 5, '71818'), P('cryster83 (Flex)', 0, '119335342'),
  ] },
  { tag: 'WSP', name: 'WISP', players: [
    P('sebastian.og', 1, '1013747614'), P('Revo', 2, '94962844'), P('PapaPenguin', 3, '145507716'),
    P('Fawn', 4, '167615635'), P('PPAR-W', 5, '1011868544'), P('Badhase483 (Ersatz)', 0, '1144662965'),
  ] },
];
