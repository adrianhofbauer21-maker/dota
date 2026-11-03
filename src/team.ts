// Team-Konfiguration. Die Account-IDs sind die Dotabuff-/Steam32-IDs
// (die Zahl am Ende des Dotabuff-Links, z. B. dotabuff.com/players/366488139).
// Die Zuordnung ID -> Spieler ist VORLÄUFIG und kann im UI korrigiert werden;
// der OpenDota-Profilname wird zur Kontrolle neben jeder ID angezeigt.

export type Role = 0 | 1 | 2 | 3 | 4 | 5; // 0 = Flex/Ersatz (nur Gegnerteams)

export type TeamPlayer = {
  id: string;        // interne ID (stabil, nur für React/localStorage)
  name: string;
  role: Role;
  accountId: string; // Steam32 / Dotabuff-ID
};

export const ROLE_LABEL: Record<Role, string> = {
  0: 'Flex/Ersatz',
  1: 'Carry',
  2: 'Midlane',
  3: 'Offlane',
  4: 'Soft Support',
  5: 'Hard Support',
};

export const DEFAULT_TEAM: TeamPlayer[] = [
  { id: 'p1', name: 'Mr. Turnier', role: 1, accountId: '366488139' },
  { id: 'p2', name: 'Öpsi',        role: 2, accountId: '183100907' },
  { id: 'p3', name: 'Dirty Harry', role: 3, accountId: '51114035' },
  { id: 'p4', name: 'Mia',         role: 4, accountId: '86894308' },
  { id: 'p5', name: 'JuliBRO',     role: 5, accountId: '119112835' },
];

// Gegnerisches Team: leere Account-IDs, im UI jederzeit änderbar (Name, Position, ID).
export const DEFAULT_ENEMY: TeamPlayer[] = ([1, 2, 3, 4, 5] as Role[]).map(role => ({ id: `e${role}`, name: `Gegner ${role}`, role, accountId: '' }));

const KEY = 'dota-team-v1';
const ENEMY_KEY = 'dota-enemy-team-v1';

export function loadEnemyTeam(): TeamPlayer[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ENEMY_KEY) ?? 'null') as TeamPlayer[] | null;
    return Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 10 ? parsed : DEFAULT_ENEMY;
  } catch {
    return DEFAULT_ENEMY;
  }
}

export function saveEnemyTeam(team: TeamPlayer[]) {
  try { localStorage.setItem(ENEMY_KEY, JSON.stringify(team)); } catch { /* ignorieren */ }
}

export function loadTeam(): TeamPlayer[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_TEAM;
    const parsed = JSON.parse(raw) as TeamPlayer[];
    if (!Array.isArray(parsed) || parsed.length !== 5) return DEFAULT_TEAM;
    // Einmalige Korrektur: Früher standen die IDs von Dirty Harry und Mia vertauscht in der Vorlage.
    const p3 = parsed.find(p => p.id === 'p3'), p4 = parsed.find(p => p.id === 'p4');
    if (p3 && p4 && p3.accountId.trim() === '86894308' && p4.accountId.trim() === '51114035') {
      p3.accountId = '51114035';
      p4.accountId = '86894308';
    }
    return parsed;
  } catch {
    return DEFAULT_TEAM;
  }
}

export function saveTeam(team: TeamPlayer[]) {
  try { localStorage.setItem(KEY, JSON.stringify(team)); } catch { /* Speicher voll/gesperrt: ignorieren */ }
}
