import { useMemo, useState } from 'react';
import { normHeroName, parseDotabuffHeroes } from './dotabuffImport';
import { type TeamData } from './teamData';
import { ROLE_LABEL } from './team';
import { formPoints } from './recommend';
import { LEAGUE_TEAMS, LEAGUE_UPDATED } from './leagueTeams';

type Props = {
  teamData: TeamData;
  heroNames: Record<number, string>; // hero_id -> englischer Name (OpenDota)
  /** Wandelt einen OpenDota-Namen in den Namen der App-Heldenliste um (oder undefined). */
  canon: (openDotaName: string) => string | undefined;
  portrait: (hero: string) => string;
  /** 'own' = eigenes Team, 'enemy' = gegnerisches Team (leere Slots möglich, zusätzlich Ban-Hinweise). */
  side?: 'own' | 'enemy';
  /** Hero-IDs, die schon gepickt/gebannt sind (für die Ban-Hinweise). */
  unavailable?: Set<number>;
};

const TOP_N = 8;

export default function TeamPanel({ teamData, heroNames, canon, portrait, side = 'own', unavailable }: Props) {
  const enemy = side === 'enemy';
  const win = enemy ? teamData.enemyWindow : teamData.formWindow;
  const { data, loading, status } = teamData;
  const team = enemy ? teamData.enemyTeam : teamData.team;
  const update = enemy ? teamData.updateEnemy : teamData.update;
  const stats = enemy ? teamData.enemyStats : teamData.stats;
  const loadAll = (force: boolean) => teamData.loadAll(force, side);
  const [minGames, setMinGames] = useState(2);
  const [sortBy, setSortBy] = useState<'total' | 'recent' | 'form'>('total');
  const [pasteText, setPasteText] = useState<Record<string, string>>({});
  const [pasteMsg, setPasteMsg] = useState<Record<string, string>>({});
  const nameToId = useMemo(() => new Map(Object.entries(heroNames).map(([id, n]) => [normHeroName(n), Number(id)] as const)), [heroNames]);
  const { manual, setManual } = teamData;
  function importFor(playerId: string, accountId: string) {
    const { rows, unknown } = parseDotabuffHeroes(pasteText[playerId] ?? '', nameToId);
    if (rows.length === 0) { setPasteMsg(m => ({ ...m, [playerId]: 'Keine Heldenzeilen erkannt. Bitte die Tabelle der Dotabuff-Seite „Heroes“ komplett kopieren (Strg+A, Strg+C) und einfügen.' })); return; }
    setManual(accountId.trim(), rows);
    const games = rows.reduce((n, r) => n + r.games, 0);
    setPasteMsg(m => ({ ...m, [playerId]: `✓ ${rows.length} Helden, ${games} Spiele übernommen${unknown.length ? ` · nicht zugeordnet: ${[...new Set(unknown)].join(', ')}` : ''}` }));
    setPasteText(t => ({ ...t, [playerId]: '' }));
  }

  // Ban-Hinweise: Helden, die gegnerische Spieler viel und zuletzt gut spielen (Erfahrung + Form), noch nicht gepickt/gebannt.
  const threats = useMemo(() => {
    if (!enemy) return [];
    const best = new Map<number, { heroId: number; who: string; games: number; wr: number | null; score: number }>();
    for (const p of team) {
      for (const s of stats[p.id]?.list ?? []) {
        if (s.totalGames < minGames || unavailable?.has(s.heroId)) continue;
        const score = 0.5 * s.experience + 0.5 * formPoints(s).points;
        const cur = best.get(s.heroId);
        if (!cur || score > cur.score) best.set(s.heroId, { heroId: s.heroId, who: p.name, games: s.totalGames, wr: s.totalWinrate, score });
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  }, [enemy, team, stats, minGames, unavailable]);

  return <section className="tp">
    <div className="tp-head">
      <strong>{enemy ? 'GEGNERTEAM · SPIELERSTATISTIKEN' : 'TEAM · SPIELERSTATISTIKEN'}</strong>
      {enemy && <input className="tp-name tp-teamname" value={teamData.enemyName} placeholder="Teamname (optional)" onChange={e => teamData.setEnemyName(e.target.value)} aria-label="Name des Gegnerteams" />}
      {enemy && <label className="tp-min">Liga 4 laden
        <select value="" onChange={e => {
          const t = LEAGUE_TEAMS.find(x => x.tag === e.target.value);
          if (t) teamData.setEnemyPlayers(t.players.map(pl => ({ name: pl.name, role: pl.role, accountId: pl.accountId })), `[${t.tag}] ${t.name}`);
        }} title={`Kader laut Being eSports, Stand ${LEAGUE_UPDATED}`}>
          <option value="">Team wählen …</option>
          {LEAGUE_TEAMS.map(t => <option key={t.tag} value={t.tag}>[{t.tag}] {t.name}</option>)}
        </select>
      </label>}
      {enemy && <button onClick={() => teamData.addEnemy()} disabled={team.length >= 10} title="Weiteren Spieler (z. B. Ersatz) hinzufügen">+ Spieler</button>}
      {enemy && <button onClick={() => { if (window.confirm('Gegnerteam leeren?')) teamData.clearEnemy(); }} title="Alle Namen und IDs des Gegnerteams zurücksetzen">Gegner leeren</button>}
      <span className="tp-sub">Gesamtbilanz aller Spiele + Form der letzten {win} Spiele (STRATZ, Ersatz: OpenDota)</span>
      <label className="tp-min" title="Reihenfolge der Helden in den Spielerkarten">Sortierung
        <select value={sortBy} onChange={e => setSortBy(e.target.value as 'total' | 'recent' | 'form')}>
          <option value="total">Gesamtspiele</option>
          <option value="recent">Spiele in den letzten {win} (zuletzt oft gespielt)</option>
          <option value="form">Form</option>
        </select>
      </label>
      <label className="tp-min">Min. Spiele (gesamt)
        <select value={minGames} onChange={e => setMinGames(Number(e.target.value))}>
          {[1, 2, 3, 5, 8].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button disabled={loading} onClick={() => loadAll(false)}>{loading ? 'Lädt …' : 'Daten laden'}</button>
      <button disabled={loading} onClick={() => loadAll(true)} title="Cache ignorieren">↻ Neu laden</button>
    </div>
    {status && <div className="tp-status">{status}</div>}
    <div className="tp-grid">
      {team.map(p => {
        const d = data[p.accountId.trim()];
        const empty = p.accountId.trim() === '';
        const sorted = [...stats[p.id].list].filter(s => s.totalGames >= minGames);
        if (sortBy === 'recent') sorted.sort((a, b) => b.games - a.games || b.totalGames - a.totalGames);
        else if (sortBy === 'form') sorted.sort((a, b) => formPoints(b).points - formPoints(a).points);
        const list = (sortBy === 'recent' ? sorted.filter(s => s.games > 0) : sorted).slice(0, TOP_N);
        return <div className="tp-card" key={p.id}>
          <div className="tp-card-head">
            <input className="tp-name" value={p.name} onChange={e => update(p.id, { name: e.target.value })} aria-label="Spielername" />
            <span className="tp-role">{p.role === 0 ? ROLE_LABEL[0] : `Pos ${p.role} · ${ROLE_LABEL[p.role]}`}</span>
            {enemy && team.length > 1 && <button className="tp-x" onClick={() => teamData.removeEnemy(p.id)} title="Spieler entfernen" aria-label="Spieler entfernen">✕</button>}
          </div>
          <label className="tp-id">Account-ID
            <input value={p.accountId} inputMode="numeric" onChange={e => update(p.id, { accountId: e.target.value })} />
          </label>
          <div className="tp-persona">
            {empty ? 'Account-ID eintragen' : d?.profile ? <>{d.source === 'opendota' ? 'OpenDota' : 'STRATZ'}: <b>{d.profile.name ?? 'kein Profilname'}</b> · {d.totalMatches ?? '?'} Spiele gesamt · {d.matches.length} letzte Spiele geladen</> : 'noch nicht geladen'}
          </div>
          {d?.note && <div className="tp-note">{d.note}</div>}
          {d && !d.error && (d.totalMatches ?? 0) > 100 && d.heroes.reduce((n, h) => n + h.games, 0) < 0.6 * (d.totalMatches ?? 0) && !manual[p.accountId.trim()] &&
            <div className="tp-error">Gesamtbilanz unvollständig ({d.heroes.reduce((n, h) => n + h.games, 0)} von {d.totalMatches} Spielen) – Helden-Tabelle von Dotabuff unten einfügen.</div>}
          {d?.error && <div className="tp-error">{d.error}</div>}
          <details className="tp-import">
            <summary>{manual[p.accountId.trim()] ? `Dotabuff-Import aktiv (${manual[p.accountId.trim()].rows.reduce((n, r) => n + r.games, 0)} Spiele, ${new Date(manual[p.accountId.trim()].at).toLocaleDateString('de-AT')})` : 'Gesamtspiele aus Dotabuff einfügen'}</summary>
            <textarea rows={4} placeholder="Tabelle der Dotabuff-Seite „Heroes“ hier einfügen …" value={pasteText[p.id] ?? ''} onChange={e => setPasteText(t => ({ ...t, [p.id]: e.target.value }))} />
            <div className="tp-import-btns">
              <button disabled={!(pasteText[p.id] ?? '').trim()} onClick={() => importFor(p.id, p.accountId)}>Übernehmen</button>
              {manual[p.accountId.trim()] && <button onClick={() => { setManual(p.accountId.trim(), null); setPasteMsg(m => ({ ...m, [p.id]: 'Import entfernt.' })); }}>Entfernen</button>}
            </div>
            {pasteMsg[p.id] && <div className="tp-note">{pasteMsg[p.id]}</div>}
          </details>
          {d && !d.error && d.matches.length === 0 && <div className="tp-error">Keine Spiele sichtbar – Match-Daten im Dota-Profil freigeben („Expose public match data").</div>}
          {list.length > 0 && <table className="tp-table">
            <thead><tr><th>Held</th><th title="Spiele gesamt">Ges.</th><th title="Winrate gesamt">WR ges.</th><th title="Spiele in den letzten Spielen">L{win}</th><th title="Winrate in den letzten Spielen">WR L{win}</th><th title="KDA auf dem Helden in den letzten Spielen">KDA</th><th title="Form-Score: 70 % Winrate, 30 % Performance (KDA), bei wenigen Gesamtspielen Richtung 50 gedämpft">Form</th></tr></thead>
            <tbody>{list.map(s => {
              const raw = heroNames[s.heroId];
              const name = raw ? canon(raw) : undefined;
              return <tr key={s.heroId} title={`Sicherheit: ${s.confidence}`}>
                <td className="tp-hero">{name ? <img src={portrait(name)} alt="" /> : <span className="tp-noimg" />}{raw ?? `#${s.heroId}`}</td>
                <td>{s.totalGames}</td>
                <td>{s.totalWinrate !== null ? `${Math.round(s.totalWinrate * 100)}%` : '–'}</td>
                <td>{s.games}</td>
                <td>{s.winrate !== null ? `${Math.round(s.winrate * 100)}%` : '–'}</td>
                <td>{s.kda !== null ? s.kda.toFixed(1) : '–'}</td>
                <td><span className={`tp-score ${s.confidence}`}>{formPoints(s).points.toFixed(0)}</span></td>
              </tr>;
            })}</tbody>
          </table>}
        </div>;
      })}
    </div>
    {enemy && <div className="tp-threats">
      <strong>Ban-Hinweise</strong>
      {threats.length === 0 ? <span className="tp-note">Noch keine Daten – Account-IDs der Gegner eintragen und „Daten laden“.</span>
        : <ul>{threats.map(t => {
            const raw = heroNames[t.heroId]; const name = raw ? canon(raw) : undefined;
            return <li key={t.heroId} title={`${t.games} Spiele gesamt${t.wr !== null ? `, ${Math.round(t.wr * 100)}% WR` : ''}`}>
              {name ? <img src={portrait(name)} alt="" /> : <span className="tp-noimg" />}
              <span>{raw ?? `#${t.heroId}`}</span><small>{t.who} · {t.games} Sp.{t.wr !== null ? ` · ${Math.round(t.wr * 100)}%` : ''}</small>
            </li>;
          })}</ul>}
      <span className="tp-note">Sortiert nach Erfahrung + Form des jeweils stärksten Gegners auf dem Helden.</span>
    </div>}
    <p className="tp-note">Standard-Sortierung: Erfahrung (Gesamtzahl der Spiele auf dem Helden); über „Sortierung“ lässt sich nach den Spielen der letzten Zeit oder nach Form sortieren. Form = 70 % Winrate der letzten {win} Spiele auf diesem Helden (geglättet in Richtung der Winrate in den älteren Spielen, 8 virtuelle Spiele; ohne Spiel auf dem Helden in den letzten Spielen ist die Form neutral = 50) + 30 % Performance (KDA auf dem Helden im Vergleich zum eigenen Durchschnitts-KDA aller letzten Spiele, bei wenigen Spielen gedämpft). Farbe = Sicherheit nach Gesamtzahl der Spiele (grau &lt; 4, gelb 4–9, grün ≥ 10). Die ID-Zuordnung bitte anhand des OpenDota-Namens prüfen.</p>
  </section>;
}
