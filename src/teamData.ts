import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayerHeroes, fetchProfile, fetchRecentMatches, type MatchRow, type PlayerHeroRow, type Profile } from './opendota';
import { heroStats, type HeroStat } from './stats';
import { fetchStratzPlayer } from './stratzPlayer';
import { DEFAULT_ENEMY, loadEnemyTeam, loadTeam, saveEnemyTeam, saveTeam, type TeamPlayer } from './team';

export type PlayerData = {
  profile: Profile | null;
  matches: MatchRow[];        // letzte MATCH_LIMIT Spiele (Form)
  heroes: PlayerHeroRow[];    // Gesamtbilanz pro Held (alle Spiele)
  loadedAt: number;
  source?: 'stratz' | 'opendota';
  note?: string;              // Hinweis zur Datenquelle
  totalMatches?: number;      // Gesamtzahl der Spiele laut Quelle
  error?: string;
};

export const MATCH_LIMIT = 200; // so viele letzte Spiele werden geladen
export const FORM_WINDOW_OPTIONS = [50, 100, 200] as const; // so viele davon zählen für die Form (die neuesten)
const WINDOW_KEY = 'dota-form-window-v2';
const CACHE_KEY = 'dota-team-cache-v4';
const MANUAL_KEY = 'dota-manual-totals-v1';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 h

function loadCache(): Record<string, PlayerData> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function saveCache(c: Record<string, PlayerData>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* zu groß/gesperrt: ignorieren */ }
}

/** Team, geladene OpenDota-Daten und daraus berechnete Hero-Statistiken je Spieler. */
export function useTeamData() {
  const [team, setTeam] = useState<TeamPlayer[]>(loadTeam);
  const [enemyName, setEnemyNameState] = useState<string>(() => { try { return localStorage.getItem('dota-enemy-name-v1') ?? ''; } catch { return ''; } });
  function setEnemyName(n: string) { setEnemyNameState(n); try { localStorage.setItem('dota-enemy-name-v1', n); } catch { /* ignorieren */ } }
  const [pendingEnemyLoad, setPendingEnemyLoad] = useState(false);
  const [enemyTeam, setEnemyTeam] = useState<TeamPlayer[]>(loadEnemyTeam);
  const [data, setData] = useState<Record<string, PlayerData>>(loadCache);
  // Von Hand eingefügte Gesamtbilanz (z. B. aus Dotabuff) je Account-ID; ersetzt die Quelldaten für die enthaltenen Helden.
  const [manual, setManualState] = useState<Record<string, { at: number; rows: PlayerHeroRow[] }>>(() => {
    try { return JSON.parse(localStorage.getItem(MANUAL_KEY) ?? '{}'); } catch { return {}; }
  });
  function setManual(accountId: string, rows: PlayerHeroRow[] | null) {
    setManualState(prev => {
      const next = { ...prev };
      if (rows && rows.length) next[accountId] = { at: Date.now(), rows }; else delete next[accountId];
      try { localStorage.setItem(MANUAL_KEY, JSON.stringify(next)); } catch { /* ignorieren */ }
      return next;
    });
  }
  const [formWindow, setFormWindowState] = useState<number>(() => {
    const v = Number(localStorage.getItem(WINDOW_KEY));
    return (FORM_WINDOW_OPTIONS as readonly number[]).includes(v) ? v : 200;
  });
  function setFormWindow(n: number) {
    setFormWindowState(n);
    try { localStorage.setItem(WINDOW_KEY, String(n)); } catch { /* ignorieren */ }
  }
  const [enemyWindow, setEnemyWindowState] = useState<number>(() => {
    const v = Number(localStorage.getItem('dota-enemy-form-window-v1'));
    return (FORM_WINDOW_OPTIONS as readonly number[]).includes(v) ? v : 200;
  });
  function setEnemyWindow(n: number) {
    setEnemyWindowState(n);
    try { localStorage.setItem('dota-enemy-form-window-v1', String(n)); } catch { /* ignorieren */ }
  }
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => { saveTeam(team); }, [team]);
  useEffect(() => { saveEnemyTeam(enemyTeam); }, [enemyTeam]);
  function updateEnemy(id: string, patch: Partial<TeamPlayer>) {
    setEnemyTeam(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }
  function clearEnemy() { setEnemyTeam(DEFAULT_ENEMY); setEnemyName(''); }
  function addEnemy() {
    setEnemyTeam(prev => prev.length >= 10 ? prev : [...prev, { id: `e${Date.now()}`, name: `Gegner ${prev.length + 1}`, role: 0, accountId: '' }]);
  }
  function removeEnemy(id: string) { setEnemyTeam(prev => (prev.length <= 1 ? prev : prev.filter(p => p.id !== id))); }
  /** Ganzes Gegnerteam ersetzen (z. B. aus der Liga-Liste); lädt anschließend automatisch die Spielerdaten. */
  function setEnemyPlayers(players: Omit<TeamPlayer, 'id'>[], name: string) {
    setEnemyTeam(players.map((p, i) => ({ ...p, id: `e${Date.now()}_${i}` })));
    setEnemyName(name);
    setPendingEnemyLoad(true);
  }

  function update(id: string, patch: Partial<TeamPlayer>) {
    setTeam(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function loadAll(force: boolean, which: 'own' | 'enemy' | 'all' = 'own') {
    setLoading(true);
    const next = { ...data };
    const list = [...(which === 'enemy' ? [] : team), ...(which === 'own' ? [] : enemyTeam)];
    // Spieler, die wirklich geladen werden müssen (leere Slots, Duplikate und frische Cache-Einträge fallen weg).
    const todo: TeamPlayer[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      const id = p.accountId.trim();
      if (id === '' || seen.has(id)) continue; // leerer Slot (z. B. Gegner noch nicht eingetragen) bzw. doppelte ID
      seen.add(id);
      if (!/^\d+$/.test(id)) { next[id] = { profile: null, matches: [], heroes: [], loadedAt: Date.now(), error: 'Ungültige Account-ID' }; continue; }
      const cached = next[id];
      if (!force && cached && !cached.error && cached.heroes && Date.now() - cached.loadedAt < CACHE_MAX_AGE_MS) continue;
      todo.push(p);
    }
    // Mehrere Spieler gleichzeitig laden (statt nacheinander) – das spart bei 7 Gegnern fast die gesamte Wartezeit.
    let done = 0, cursor = 0;
    const loadOne = async (p: TeamPlayer) => {
      const id = p.accountId.trim();
      try {
        try {
          // Bevorzugt STRATZ (vollständige Historie); bei Fehler OpenDota als Ersatz.
          const s = await fetchStratzPlayer(id, MATCH_LIMIT);
          next[id] = { profile: s.profile, matches: s.matches, heroes: s.heroes, loadedAt: Date.now(), source: 'stratz', totalMatches: s.matchCount };
          // STRATZ hat bei manchen Spielern nur lückenhafte Historie (Gesamtbilanz viel kleiner als die Spielzahl): dann OpenDota ergänzen.
          const sum = (hs: PlayerHeroRow[]) => hs.reduce((n, h) => n + h.games, 0);
          const gaps = s.matchCount > 100 && sum(s.heroes) < 0.6 * s.matchCount;
          const fewMatches = s.matches.length < MATCH_LIMIT && s.matchCount > s.matches.length + 50;
          if (gaps || fewMatches) {
            try {
              const [odHeroes, odMatches] = await Promise.all([
                gaps ? fetchPlayerHeroes(id) : Promise.resolve([] as PlayerHeroRow[]),
                fewMatches ? fetchRecentMatches(id, MATCH_LIMIT) : Promise.resolve([] as MatchRow[]),
              ]);
              const cur = next[id];
              if (sum(odHeroes) > sum(cur.heroes)) cur.heroes = odHeroes;
              if (odMatches.length > cur.matches.length) cur.matches = odMatches;
              cur.note = 'Lücken in STRATZ – teils OpenDota-Daten';
            } catch { /* OpenDota nicht erreichbar/Profil privat: STRATZ-Daten behalten */ }
          }
        } catch (se) {
          setStatus(`STRATZ nicht erreichbar (${se instanceof Error ? se.message : se}) – nutze OpenDota für ${p.name} …`);
          const [profile, matches, heroes] = await Promise.all([fetchProfile(id), fetchRecentMatches(id, MATCH_LIMIT), fetchPlayerHeroes(id)]);
          next[id] = { profile, matches, heroes, loadedAt: Date.now(), source: 'opendota', totalMatches: heroes.reduce((n, h) => n + h.games, 0) };
        }
      } catch (e) {
        next[id] = { profile: null, matches: [], heroes: [], loadedAt: Date.now(), error: e instanceof Error ? e.message : String(e) };
      }
      done += 1;
      setStatus(`Geladen ${done}/${todo.length} …`);
      setData({ ...next });
    };
    const worker = async () => { while (cursor < todo.length) await loadOne(todo[cursor++]); };
    if (todo.length) setStatus(`Lade ${todo.length} Spieler …`);
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    saveCache(next);
    setData({ ...next });
    setStatus(`Fertig · ${new Date().toLocaleTimeString('de-AT')}`);
    setLoading(false);
  }

  // Nach Auswahl eines Gegnerteams aus der Liste: Daten automatisch laden (nicht bei jedem Tastendruck in einem ID-Feld).
  useEffect(() => {
    if (!pendingEnemyLoad) return;
    setPendingEnemyLoad(false);
    void loadAll(false, 'enemy');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnemyLoad]);

  // Beim Start automatisch laden, wenn für ein Teammitglied keine frischen Daten im Zwischenspeicher liegen.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    const needsLoad = [...team, ...enemyTeam].some(p => {
      const c = data[p.accountId.trim()];
      return /^\d+$/.test(p.accountId.trim()) && (!c || c.error || !c.heroes || Date.now() - c.loadedAt >= CACHE_MAX_AGE_MS);
    });
    if (needsLoad) void loadAll(false, 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Spieler-ID (intern) -> Hero-Statistiken (Gesamt + Form) und ob für den Spieler überhaupt Daten vorliegen */
  const computeStats = (players: TeamPlayer[], window: number) => {
    const out: Record<string, { list: HeroStat[]; byHero: Map<number, HeroStat>; known: boolean }> = {};
    for (const p of players) {
      const d = data[p.accountId.trim()];
      // Gesamtbilanz: eingefügte Werte haben Vorrang vor der Quelle (je Held), übrige Helden kommen aus der Quelle.
      const m = manual[p.accountId.trim()]?.rows ?? [];
      const mIds = new Set(m.map(r => r.hero_id));
      const totals = [...m, ...(d?.heroes ?? []).filter(h => !mIds.has(h.hero_id))];
      // Form: nur die neuesten `formWindow` Spiele (die Quelle liefert bis zu MATCH_LIMIT).
      const recent = [...(d?.matches ?? [])].sort((a, b) => b.start_time - a.start_time).slice(0, window);
      const list = d || m.length ? heroStats(recent, totals) : [];
      out[p.id] = { list, byHero: new Map(list.map(s => [s.heroId, s])), known: list.length > 0 };
    }
    return out;
  };
  const stats = useMemo(() => computeStats(team, formWindow), [team, data, manual, formWindow]); // eslint-disable-line react-hooks/exhaustive-deps
  const enemyStats = useMemo(() => computeStats(enemyTeam, enemyWindow), [enemyTeam, data, manual, enemyWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  return { team, update, enemyTeam, updateEnemy, clearEnemy, addEnemy, removeEnemy, setEnemyPlayers, enemyName, setEnemyName, data, loading, status, loadAll, stats, enemyStats, manual, setManual, formWindow, setFormWindow, enemyWindow, setEnemyWindow };
}

export type TeamData = ReturnType<typeof useTeamData>;
