import { sleep, stratzQuery } from './stratz';

/**
 * Scouting aus STRATZ-Replaydaten: Ward-Ereignisse und Spielerpositionen eines Matches.
 * Koordinaten sind Karten-Zellen (ca. 64–192, Radiant-Basis links unten ~ (75,75), Dire-Basis rechts oben ~ (180,180)).
 * Zeiten sind Sekunden der Spieluhr (vor dem Start negativ).
 */
export type WardKind = 'OBSERVER' | 'SENTRY';
export type Ward = { kind: WardKind; radiant: boolean; slot: number; x: number; y: number; start: number; end: number; ended: boolean; endAction: string };
export type Pos = { t: number; x: number; y: number };
export type ScoutPlayer = { slot: number; steamAccountId: number | null; heroId: number; radiant: boolean; position: string | null; pos: Pos[] };
export type ScoutMatch = {
  id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean;
  players: ScoutPlayer[]; wards: Ward[];
  /** Spieler, dessen letzte Spiele geladen wurden */
  focusSlot: number; focusRadiant: boolean; focusHero: number;
  actions: Record<string, number>; // Häufigkeit der Ward-Aktionen (zur Datenprüfung)
};
export type MatchListEntry = { id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean; parsed: boolean; slot: number; radiant: boolean; heroId: number };

/** Lebensdauer, falls ein Ward kein Ende-Ereignis hat (Observer 6 min, Sentry 8 min). */
export const WARD_LIFETIME: Record<WardKind, number> = { OBSERVER: 360, SENTRY: 480 };

type RawWard = { indexId: number; time: number; positionX: number; positionY: number; fromPlayer: number; wardType: string; action: string };
type RawPlayer = { steamAccountId: number | null; playerSlot: number; heroId: number; isRadiant: boolean; position: string | null; playbackData: { playerUpdatePositionEvents: { time: number; x: number; y: number }[] | null } | null };
type RawMatch = { id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean; players: RawPlayer[]; playbackData: { wardEvents: RawWard[] | null } | null };

/** Setzt aus den Einzelereignissen die Wards zusammen: SPAWN beginnt einen Ward, das nächste andere Ereignis derselben ID beendet ihn. */
export function buildWards(events: RawWard[]): { wards: Ward[]; actions: Record<string, number> } {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const active = new Map<number, Ward>();
  const wards: Ward[] = [];
  const actions: Record<string, number> = {};
  for (const e of sorted) {
    const action = String(e.action ?? '').toUpperCase();
    actions[action] = (actions[action] ?? 0) + 1;
    const kind: WardKind = String(e.wardType).toUpperCase().includes('SENTRY') ? 'SENTRY' : 'OBSERVER';
    if (action === 'SPAWN') {
      const w: Ward = { kind, radiant: e.fromPlayer < 128, slot: e.fromPlayer, x: e.positionX, y: e.positionY, start: e.time, end: e.time + WARD_LIFETIME[kind], ended: false, endAction: '' };
      wards.push(w);
      active.set(e.indexId, w);
    } else {
      const w = active.get(e.indexId);
      if (w) { w.end = Math.max(w.start, e.time); w.ended = true; w.endAction = action; active.delete(e.indexId); }
    }
  }
  return { wards, actions };
}

const cache = new Map<number, RawMatch>();

export async function fetchMatchPlayback(matchId: number): Promise<RawMatch> {
  const hit = cache.get(matchId);
  if (hit) return hit;
  const d = await stratzQuery<{ match: RawMatch | null }>(`{ match(id: ${matchId}) { id startDateTime durationSeconds didRadiantWin
    players { steamAccountId playerSlot heroId isRadiant position playbackData { playerUpdatePositionEvents { time x y } } }
    playbackData { wardEvents { indexId time positionX positionY fromPlayer wardType action } } } }`);
  if (!d.match) throw new Error(`Match ${matchId} nicht gefunden`);
  cache.set(matchId, d.match);
  return d.match;
}

export function toScoutMatch(m: RawMatch, focus: { slot: number; radiant: boolean; heroId: number }): ScoutMatch {
  const { wards, actions } = buildWards(m.playbackData?.wardEvents ?? []);
  return {
    id: m.id, startDateTime: m.startDateTime, durationSeconds: m.durationSeconds, didRadiantWin: m.didRadiantWin,
    players: m.players.map(p => ({ slot: p.playerSlot, steamAccountId: p.steamAccountId, heroId: p.heroId, radiant: p.isRadiant, position: p.position,
      pos: (p.playbackData?.playerUpdatePositionEvents ?? []).map(e => ({ t: e.time, x: e.x, y: e.y })).sort((a, b) => a.t - b.t) })),
    wards, focusSlot: focus.slot, focusRadiant: focus.radiant, focusHero: focus.heroId, actions,
  };
}

/** Letzte Spiele eines Spielers (nur Kopfdaten); `parsed` = STRATZ hat das Replay ausgewertet. */
export async function fetchMatchList(accountId: string, take: number): Promise<MatchListEntry[]> {
  const d = await stratzQuery<{ player: { matches: { id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean; parsedDateTime: number | null;
    players: { playerSlot: number; isRadiant: boolean; heroId: number }[] }[] } | null }>(
    `{ player(steamAccountId: ${accountId}) { matches(request: { take: ${take} }) { id startDateTime durationSeconds didRadiantWin parsedDateTime players(steamAccountId: ${accountId}) { playerSlot isRadiant heroId } } } }`);
  if (!d.player) throw new Error('STRATZ kennt diese Account-ID nicht');
  const out: MatchListEntry[] = [];
  for (const m of d.player.matches ?? []) {
    const me = m.players[0];
    if (!me) continue;
    out.push({ id: m.id, startDateTime: m.startDateTime, durationSeconds: m.durationSeconds, didRadiantWin: m.didRadiantWin, parsed: m.parsedDateTime != null, slot: me.playerSlot, radiant: me.isRadiant, heroId: me.heroId });
  }
  return out;
}

/** Lädt die Replaydaten mehrerer Spiele nacheinander (zwei parallel), meldet den Fortschritt. */
export async function loadMatches(list: MatchListEntry[], onProgress: (done: number, total: number) => void): Promise<{ matches: ScoutMatch[]; failed: number }> {
  const matches: ScoutMatch[] = [];
  let failed = 0, done = 0, cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const e = list[cursor++];
      try {
        const raw = await fetchMatchPlayback(e.id);
        matches.push(toScoutMatch(raw, { slot: e.slot, radiant: e.radiant, heroId: e.heroId }));
      } catch { failed += 1; }
      done += 1; onProgress(done, list.length);
      await sleep(400);
    }
  };
  await Promise.all([worker()]);
  matches.sort((a, b) => b.startDateTime - a.startDateTime);
  return { matches, failed };
}

// ---- Karte: Zonen (grob, schematisch) ----
export const MAP_MIN = 64, MAP_MAX = 192;
const LANES: { name: string; pts: [number, number][] }[] = [
  { name: 'Top-Lane', pts: [[76, 98], [80, 176], [100, 181], [158, 182]] },
  { name: 'Mid-Lane', pts: [[84, 84], [172, 172]] },
  { name: 'Bot-Lane', pts: [[98, 76], [176, 80], [181, 100], [182, 158]] },
];
export const LANE_LINES = LANES;
function distSeg(px: number, py: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
export const ZONES = ['Basis Radiant', 'Basis Dire', 'Top-Lane', 'Mid-Lane', 'Bot-Lane', 'Fluss', 'Dschungel Radiant', 'Dschungel Dire'] as const;
export function zoneOf(x: number, y: number): (typeof ZONES)[number] {
  if (Math.hypot(x - 80, y - 80) < 20) return 'Basis Radiant';
  if (Math.hypot(x - 176, y - 176) < 20) return 'Basis Dire';
  let best = '', bd = 1e9;
  for (const l of LANES) for (let i = 0; i + 1 < l.pts.length; i++) { const d = distSeg(x, y, l.pts[i], l.pts[i + 1]); if (d < bd) { bd = d; best = l.name; } }
  if (bd < 11) return best as (typeof ZONES)[number];
  if (Math.abs(x + y - 256) < 7) return 'Fluss';
  return x + y < 256 ? 'Dschungel Radiant' : 'Dschungel Dire';
}

export const fmtTime = (s: number) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}`;
