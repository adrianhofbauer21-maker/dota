import { useMemo, useState } from 'react';
import { BRACKET_OPTIONS, DAY_OPTIONS, PATCH, type BracketKey, type MetaByPos, type MetaEntry } from './meta';
import type { MatchupTable, SynergyTable } from './matchups';
import { missingNeeds, recommend, type Rec, type Weights } from './recommend';
import { ROLE_LABEL, type Role } from './team';
import { FORM_WINDOW_OPTIONS } from './teamData';
import type { TeamData } from './teamData';

type Props = {
  teamData: TeamData;
  metaByPos: MetaByPos;                 // Position 1..5 -> Held -> Meta
  metaSource: string;                   // Beschriftung der Quelle
  metaLoading: boolean;
  days: number;
  onDays: (d: number) => void;
  synergy: SynergyTable;
  candidates: number[];                 // legale Hero-IDs (nicht gepickt/gebannt, in der App-Liste vorhanden)
  allyIds: number[];
  enemyIds: number[];
  matchups: MatchupTable;
  matchupsLoading: boolean;
  matchupsError: string;
  rolesById: Map<number, string[]>;
  heroNames: Record<number, string>;
  canon: (openDotaName: string) => string | undefined;
  portrait: (hero: string) => string;
  bracket: BracketKey;
  onBracket: (b: BracketKey) => void;
  weights: Weights;
  onWeights: (w: Weights) => void;
  headline: string;                     // z. B. "Radiant · PICK · Dein Team"
  canPick: boolean;
  onPick: (appHeroName: string, playerId?: string) => void;
  assign: Record<number, string>;       // Hero-ID -> Spieler-ID (eigene und gegnerische Picks)
  onAssign: (heroId: number, playerId: string | null) => void;
  canBan: boolean;                      // ist gerade ein Ban unseres Teams dran?
  onBan: (appHeroName: string) => void;
  metaReady: boolean;
  metaError: string;
  positional: boolean;                  // Meta je Position vorhanden (STRATZ)?
};

const WEIGHT_LABEL: Record<keyof Weights, string> = {
  form: 'Form', experience: 'Erfahrung', meta: 'Meta', matchup: 'Matchup', synergy: 'Synergie', comp: 'Komposition',
};

/** Filter: Häufigkeit im Form-Fenster relativ zum meistgespielten Helden des Spielers (0–100). */
function inRecentRange(byHero: Map<number, { games: number }>, id: number, [lo, hi]: [number, number]): boolean {
  if (lo <= 0 && hi >= 100) return true;
  let max = 0;
  for (const s of byHero.values()) if (s.games > max) max = s.games;
  const ratio = max > 0 ? ((byHero.get(id)?.games ?? 0) / max) * 100 : 0;
  return ratio >= lo && ratio <= hi;
}

const MIN_SHARE = 0.1; // Held muss mindestens 10 % seiner Spiele auf der Position des Spielers haben

/** Anteil der Spiele eines Helden auf Position `pos` an allen seinen Spielen (null = keine Positionsdaten). */
function positionShare(metaByPos: MetaByPos, heroId: number, pos: number): number | null {
  let total = 0;
  for (let q = 1; q <= 5; q++) total += metaByPos.get(q)?.get(heroId)?.games ?? 0;
  if (total === 0) return null;
  return (metaByPos.get(pos)?.get(heroId)?.games ?? 0) / total;
}

export default function RecommendPanel(p: Props) {
  const [onlyRole, setOnlyRole] = useState(true);
  const [banOnlyRole, setBanOnlyRole] = useState(true); // eigene Filter für die Ban-Empfehlungen (Gegner)
  const [banPoolMin, setBanPoolMin] = useState(5);
  const [banWeights, setBanWeights] = useState<Weights>({ ...p.weights });
  const [poolMin, setPoolMin] = useState(5);
  // Bereich 0–100: wie oft ein Held im Form-Fenster gespielt wurde, relativ zum meistgespielten Helden des Spielers (100 = sein meistgespielter).
  const [recentRange, setRecentRange] = useState<[number, number]>([0, 100]);     // eigenes Team
  const [banRecentRange, setBanRecentRange] = useState<[number, number]>([0, 100]); // Gegner // Mindestanzahl eigener Spiele (gesamt) auf dem Helden; 0 = alle Helden
  const missing = p.allyIds.length >= 2 ? missingNeeds(p.allyIds, p.rolesById) : [];
  const nameOf = (id: number) => p.heroNames[id] ?? `#${id}`;
  // Für Gegner ohne feste Position (Flex/Ersatz): Meta der Position, auf der der Held am häufigsten gespielt wird.
  const flexMeta = useMemo(() => {
    const out = new Map<number, MetaEntry>();
    for (let q = 1; q <= 5; q++) for (const [id, e] of p.metaByPos.get(q) ?? []) { const cur = out.get(id); if (!cur || e.games > cur.games) out.set(id, e); }
    return out;
  }, [p.metaByPos]);
  const rangeSlider = (r: [number, number], set: (v: [number, number]) => void) => <span className="rp-range" title={`Wie oft ein Held in den letzten ${p.teamData.formWindow} Spielen gespielt wurde, relativ zum meistgespielten Helden des jeweiligen Spielers (100 = sein meistgespielter Held, 0 = nicht gespielt). Nur Helden in diesem Bereich werden angezeigt.`}>
    Zuletzt gespielt
    <input type="range" min={0} max={100} step={5} value={r[0]} aria-label="Zuletzt gespielt: von" onChange={e => set([Math.min(Number(e.target.value), r[1]), r[1]])} />
    <input type="range" min={0} max={100} step={5} value={r[1]} aria-label="Zuletzt gespielt: bis" onChange={e => set([r[0], Math.max(Number(e.target.value), r[0])])} />
    <b>{r[0]}–{r[1]}</b>{(r[0] > 0 || r[1] < 100) && <button type="button" onClick={() => set([0, 100])} title="Zurücksetzen">↺</button>}
  </span>;
  const heroImg = (id: number) => { const raw = p.heroNames[id]; const nm = raw ? p.canon(raw) : undefined; return nm ? <img src={p.portrait(nm)} alt="" /> : <span className="tp-noimg" />; };
  const assignedTo = (playerId: string) => Object.entries(p.assign).filter(([, pid]) => pid === playerId).map(([h]) => Number(h));
  const assignedBox = (ids: number[]) => <div className="rp-assigned">{ids.map(id => <span key={id}>{heroImg(id)}<b>{nameOf(id)}</b></span>)}<small>Held ist vergeben – keine weiteren Vorschläge.</small></div>;
  const enemyPlayers = p.teamData.enemyTeam.filter(pl => pl.accountId.trim() !== '');
  const enemiesWithData = p.enemyIds.filter(id => p.matchups.has(id));

  const renderRec = (r: Rec, pl: { role: Role }, clickable: boolean, onClick: (name: string) => void) => {
            const raw = p.heroNames[r.heroId];
            const name = raw ? p.canon(raw) : undefined;
            const lines = [
              r.form !== null
                ? `Form: ${r.recentGames} Spiele in den letzten ${p.teamData.formWindow}${r.recentWinrate !== null ? `, ${Math.round(r.recentWinrate * 100)}% WR` : ''}${r.totalWinrate !== null ? ` · Gesamt-WR ${Math.round(r.totalWinrate * 100)}%` : ''}${r.recentKda !== null && r.perf !== null && r.kdaRatio !== null ? ` · KDA ${r.recentKda.toFixed(1)} (×${r.kdaRatio.toFixed(2)} vom eigenen Schnitt) → Performance ${r.perf.toFixed(0)} Pkt` : ''} → Form ${r.form.toFixed(0)} Pkt${r.formTrust !== null ? ` (Vertrauen ${(r.formTrust * 100).toFixed(0)} % wegen ${r.totalGames} Spielen gesamt)` : ''}`
                : 'Form: keine Spielerdaten (nicht gewertet)',
              r.experience !== null
                ? `Erfahrung: ${r.totalGames} Spiele gesamt (nur Anzahl, ohne Winrate) → ${r.experience.toFixed(0)} Pkt`
                : 'Erfahrung: keine Spielerdaten (nicht gewertet)',
              `Meta (Pos ${pl.role}): ${r.metaWinrate !== null ? `${(r.metaWinrate * 100).toFixed(1)}% WR bei ${r.metaGames} Spielen (normalisiert: Winrate + Beliebtheit)` : 'keine Daten → neutral'} → ${r.meta.toFixed(0)} Pkt`,
              r.matchup !== null
                ? `Matchup: ${r.matchupDetail.map(d => `${(d.winrate * 100).toFixed(1)}% gg. ${nameOf(d.enemyId)}`).join(', ')} → ${r.matchup.toFixed(0)} Pkt`
                : 'Matchup: keine Daten (nicht gewertet)',
              r.synergy !== null
                ? `Synergie: ${r.synergyDetail.map(d => `${(d.winrate * 100).toFixed(1)}% mit ${nameOf(d.allyId)}`).join(', ')} → ${r.synergy.toFixed(0)} Pkt`
                : 'Synergie: keine Daten (nicht gewertet)',
              r.comp !== null
                ? `Komposition: ${r.compCovers.length ? `deckt ${r.compCovers.join(', ')} ab` : 'schließt keine Lücke'} → ${r.comp.toFixed(0)} Pkt`
                : 'Komposition: erst ab 2 eigenen Picks',
            ];
            return <button key={r.heroId} className="rp-row" title={lines.join('\n')} disabled={!clickable || !name} onClick={() => name && onClick(name)}>
              {name ? <img src={p.portrait(name)} alt="" /> : <span className="tp-noimg" />}
              <span className="rp-name">{name ?? raw ?? `#${r.heroId}`}</span>
              <span className="rp-bars" aria-hidden>
                <i style={{ width: `${r.form ?? 0}%` }} className="pl" />
                <i style={{ width: `${r.experience ?? 0}%` }} className="ex" />
                <i style={{ width: `${r.meta}%` }} className="mt" />
                <i style={{ width: `${r.matchup ?? 0}%` }} className="mu" />
                <i style={{ width: `${r.synergy ?? 0}%` }} className="sy" />
                <i style={{ width: `${r.comp ?? 0}%` }} className="co" />
              </span>
              <span className={`tp-score ${r.confidence}`}>{r.total.toFixed(0)}</span>
            </button>;
  };

  return <section className="rp">
    <div className="rp-head">
      <strong>EMPFEHLUNGEN</strong>
      <span className="rp-sub">{p.headline}</span>
      <label>Meta-Rang
        <select value={p.bracket} onChange={e => p.onBracket(e.target.value as BracketKey)}>
          {Object.entries(BRACKET_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </label>
      <label>Meta-Zeitraum
        <select value={p.days} onChange={e => p.onDays(Number(e.target.value))}>
          {DAY_OPTIONS.map(d => <option key={d} value={d}>{d === 0 ? `seit Patch ${PATCH.name} (${PATCH.label})` : `letzte ${d} Tage`}</option>)}
        </select>
      </label>
      <label title="Wie viele der neuesten Spiele eines Spielers für die Form zählen (Winrate und KDA auf dem Helden)">Form: letzte
        <select value={p.teamData.formWindow} onChange={e => p.teamData.setFormWindow(Number(e.target.value))}>
          {FORM_WINDOW_OPTIONS.map(n => <option key={n} value={n}>{n} Spiele</option>)}
        </select>
      </label>
      <label title="Zeigt pro Spieler nur Helden, die er schon mindestens so oft gespielt hat (alle Spiele). Verhindert Vorschläge für Helden, die er nie gespielt hat.">Spielerpool ab
        <select value={poolMin} onChange={e => setPoolMin(Number(e.target.value))}>
          {[0, 1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n === 0 ? 'alle Helden' : `${n} Spiele`}</option>)}
        </select>
      </label>
      {rangeSlider(recentRange, setRecentRange)}
      <label title="Zeigt pro Spieler nur Helden, die mindestens 10 % ihrer Spiele auf dessen Position haben (STRATZ)">
        <input type="checkbox" checked={onlyRole} disabled={!p.positional} onChange={e => setOnlyRole(e.target.checked)} /> Nur Helden der Position
      </label>
      <span className="rp-sub">Meta: {p.metaLoading ? 'lädt …' : p.metaSource}</span>
    </div>
    <details className="rp-weights">
      <summary>Gewichtung ({(Object.keys(p.weights) as (keyof Weights)[]).map(k => `${WEIGHT_LABEL[k]} ${p.weights[k]}`).join(' · ')})</summary>
      <div className="rp-weights-grid">
        {(Object.keys(p.weights) as (keyof Weights)[]).map(k => <label key={k}>{WEIGHT_LABEL[k]}
          <input type="range" min={0} max={100} step={5} value={p.weights[k]} onChange={e => p.onWeights({ ...p.weights, [k]: Number(e.target.value) })} />
          <span>{p.weights[k]}</span>
        </label>)}
        <small>Gewichte sind relativ zueinander. Eine Komponente ohne Daten (z. B. Matchup ohne gegnerische Picks) wird weggelassen, die übrigen zählen entsprechend mehr.</small>
      </div>
    </details>
    {(p.allyIds.length > 0 || p.enemyIds.length > 0) && <div className="rp-assign">
      {([['Eigene Picks → Spieler', p.allyIds, p.teamData.team] , ['Gegner-Picks → Spieler', p.enemyIds, p.teamData.enemyTeam.filter(x => x.accountId.trim() !== '' || Object.values(p.assign).includes(x.id))]] as const).map(([label, ids, players]) =>
        ids.length > 0 && <div key={label} className="rp-assign-row"><span>{label}:</span>
          {ids.map(id => <label key={id} className="rp-chip">{heroImg(id)}<b>{nameOf(id)}</b>
            <select value={p.assign[id] ?? ''} onChange={e => p.onAssign(id, e.target.value || null)}>
              <option value="">– offen –</option>
              {players.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select></label>)}
        </div>)}
    </div>}
    <div className="rp-context">
      <span>Eigene Picks: {p.allyIds.length ? p.allyIds.map(nameOf).join(', ') : '–'}</span>
      <span>Gegner: {p.enemyIds.length ? p.enemyIds.map(nameOf).join(', ') : '–'}
        {p.enemyIds.length > 0 && <em> {p.matchupsLoading ? '· lade Matchups …' : `· Matchups für ${enemiesWithData.length}/${p.enemyIds.length}`}</em>}</span>
      {p.allyIds.length >= 2 && <span>Team braucht noch: {missing.length ? missing.join(', ') : 'nichts Offensichtliches'}</span>}
    </div>
    {p.metaError && <div className="tp-error">{p.metaError}</div>}
    {!p.metaReady && <div className="tp-error">Meta-Daten noch nicht geladen – Empfehlungen basieren vorerst nur auf den übrigen Komponenten.</div>}
    {p.matchupsError && <div className="tp-error">Matchup-Daten: {p.matchupsError}</div>}
    <div className="rp-grid">
      {p.teamData.team.map(pl => {
        const taken = assignedTo(pl.id);
        const recs = taken.length ? [] : recommend({
          candidates: (onlyRole && p.positional
            ? p.candidates.filter(id => { const sh = positionShare(p.metaByPos, id, pl.role); return sh !== null && sh >= MIN_SHARE; })
            : p.candidates
          ).filter(id => poolMin === 0 || !p.teamData.stats[pl.id].known || (p.teamData.stats[pl.id].byHero.get(id)?.totalGames ?? 0) >= poolMin)
          .filter(id => !p.teamData.stats[pl.id].known || inRecentRange(p.teamData.stats[pl.id].byHero, id, recentRange)),
          playerStats: p.teamData.stats[pl.id].byHero,
          playerKnown: p.teamData.stats[pl.id].known,
          meta: p.metaByPos.get(pl.role) ?? new Map<number, MetaEntry>(),
          weights: p.weights,
          allyIds: p.allyIds,
          enemyIds: p.enemyIds,
          matchups: p.matchups,
          synergy: p.synergy,
          rolesById: p.rolesById,
          limit: 5,
        });
        return <div className="rp-col" key={pl.id}>
          <div className="rp-col-head"><b>{pl.name}</b><span>Pos {pl.role} · {ROLE_LABEL[pl.role]}</span></div>
          {taken.length > 0 && assignedBox(taken)}
          {!taken.length && !p.teamData.stats[pl.id].known && <div className="tp-error">{p.teamData.loading ? 'Spielerdaten werden geladen …' : 'Noch keine Spielerdaten – in der Team-Tabelle „Daten laden“ drücken.'}</div>}
          {recs.map(r => renderRec(r, pl, p.canPick, name => p.onPick(name, pl.id)))}
        </div>;
      })}
    </div>
    <div className="rp-ban">
      <div className="rp-ban-head"><strong>BAN-EMPFEHLUNGEN · GEGNER{p.teamData.enemyName ? ` · ${p.teamData.enemyName}` : ''}</strong>
        <span className="rp-sub">{p.canBan ? 'Ban dran – Held anklicken zum Bannen' : 'Helden, auf denen die gegnerischen Spieler stark sind (gleiche Filter und Gewichte wie oben)'}</span></div>
      <div className="rp-head rp-ban-filters">
        <label title="Wie viele der neuesten Spiele eines Gegners für die Form zählen">Form: letzte
          <select value={p.teamData.enemyWindow} onChange={e => p.teamData.setEnemyWindow(Number(e.target.value))}>
            {FORM_WINDOW_OPTIONS.map(n => <option key={n} value={n}>{n} Spiele</option>)}
          </select>
        </label>
        <label title="Zeigt pro Gegner nur Helden, die er schon mindestens so oft gespielt hat">Spielerpool ab
          <select value={banPoolMin} onChange={e => setBanPoolMin(Number(e.target.value))}>
            {[0, 1, 3, 5, 10, 20].map(n => <option key={n} value={n}>{n === 0 ? 'alle Helden' : `${n} Spiele`}</option>)}
          </select>
        </label>
        {rangeSlider(banRecentRange, setBanRecentRange)}
        <label title="Nur Helden, die mindestens 10 % ihrer Spiele auf der Position des Gegners haben">
          <input type="checkbox" checked={banOnlyRole} disabled={!p.positional} onChange={e => setBanOnlyRole(e.target.checked)} /> Nur Helden der Position
        </label>
        <details className="rp-weights">
          <summary>Gewichtung Bans (Form {banWeights.form} · Erfahrung {banWeights.experience} · Meta {banWeights.meta})</summary>
          <div className="rp-weights-grid">
            {(['form', 'experience', 'meta'] as const).map(k => <label key={k}>{WEIGHT_LABEL[k]}
              <input type="range" min={0} max={100} step={5} value={banWeights[k]} onChange={e => setBanWeights({ ...banWeights, [k]: Number(e.target.value) })} />
              <span>{banWeights[k]}</span>
            </label>)}
          </div>
        </details>
      </div>
      {enemyPlayers.length === 0
        ? <div className="tp-note">Noch kein Gegnerteam – unten im Gegnerteam-Panel IDs eintragen oder „Liga 4 laden“ wählen.</div>
        : <div className="rp-grid">
          {enemyPlayers.map(pl => {
            const st = p.teamData.enemyStats[pl.id];
            const hasPos = pl.role >= 1 && pl.role <= 5;
            const takenE = assignedTo(pl.id);
            const recs = takenE.length ? [] : recommend({
              candidates: (banOnlyRole && p.positional && hasPos
                ? p.candidates.filter(id => { const sh = positionShare(p.metaByPos, id, pl.role); return sh !== null && sh >= MIN_SHARE; })
                : p.candidates
              ).filter(id => banPoolMin === 0 || !st.known || (st.byHero.get(id)?.totalGames ?? 0) >= banPoolMin)
              .filter(id => !st.known || inRecentRange(st.byHero, id, banRecentRange)),
              playerStats: st.byHero,
              playerKnown: st.known,
              meta: hasPos ? (p.metaByPos.get(pl.role) ?? new Map<number, MetaEntry>()) : flexMeta,
              weights: banWeights,
              allyIds: [], enemyIds: [],             // Matchup/Synergie/Komposition aus Sicht des Gegners: nicht gewertet
              matchups: new Map(), synergy: new Map(),
              rolesById: p.rolesById,
              limit: 5,
            });
            return <div className="rp-col" key={pl.id}>
              <div className="rp-col-head"><b>{pl.name}</b><span>{hasPos ? `Pos ${pl.role} · ${ROLE_LABEL[pl.role]}` : ROLE_LABEL[0]}</span></div>
              {takenE.length > 0 && assignedBox(takenE)}
              {!takenE.length && !st.known && <div className="tp-error">{p.teamData.loading ? 'Spielerdaten werden geladen …' : 'Noch keine Spielerdaten – im Gegnerteam-Panel „Daten laden“.'}</div>}
              {recs.map(r => renderRec(r, hasPos ? pl : { role: 0 }, p.canBan, p.onBan))}
            </div>;
          })}
        </div>}
    </div>
    <p className="tp-note">Balken von oben: Form (blau), Erfahrung (lila), Meta (gelb), Matchup (rot), Synergie (türkis), Komposition (grün). Form, Meta und Matchup auf einer Skala (50 Punkte = 50 % Winrate, ±10 Prozentpunkte = ±25 Punkte); Erfahrung = Vertrautheit aus der Gesamtzahl der Spiele (40 Spiele = 50 Punkte). Fahr mit der Maus über einen Helden für die Details. Meta = Winrate des Helden auf der Position des jeweiligen Spielers im gewählten Rang und Zeitraum (STRATZ). Matchup = Winrate des Kandidaten gegen die bereits gepickten Gegner, Synergie = Winrate gemeinsam mit den bereits gepickten eigenen Helden (STRATZ, Rangfilter gröber: Legend/Ancient und Divine/Immortal zusammengefasst, bei „Immortal" also Divine + Immortal, kein Zeitfilter). Komposition = Heuristik auf Basis der OpenDota-Rollen (Initiator, Disabler, Durable). Die Farbe der Zahl zeigt die Sicherheit nach Gesamtzahl der Spiele.</p>
  </section>;
}
