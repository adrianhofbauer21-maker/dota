import { useEffect, useMemo, useRef, useState } from 'react';
import type { useTeamData } from './teamData';
import { LEAGUE_TEAMS } from './leagueTeams';
import { LANE_LINES, fetchMatchList, fetchMatchListOD, fetchMatchOD, fetchMatchPlayback, fmtTime, toScoutMatch, zoneOf, type MatchListEntry, type ScoutMatch, type Ward } from './scout';

type Props = { teamData: ReturnType<typeof useTeamData>; heroNames: Record<number, string>; startOpen?: boolean };

const S = 640; // Canvas-Größe in px
const OBS_R = 12.5, SENT_R = 7.8; // Sichtradius in Karten-Zellen (1600 bzw. 1000 Einheiten, 1 Zelle = 128 Einheiten)

// Bezugspunkte: Brunnen in STRATZ-Zellen (aus echten Spielen) und im Kartenbild (Pixel im 600×600-Bild).
const FOUNTAIN_R = { x: 74, y: 74 }, FOUNTAIN_D = { x: 180, y: 180 };
const IMG = 768, IMG_R = { x: 60, y: 708 }, IMG_D = { x: 696, y: 72 };

type WardTeam = 'focus' | 'enemy' | 'all';
type Trail = 90 | 300 | 100000;

export default function ScoutPanel({ teamData, heroNames, startOpen }: Props) {
  const groups = useMemo(() => {
    const ok = (id: string) => /^\d+$/.test(id);
    const own = teamData.team.filter(p => ok(p.accountId)).map(p => ({ id: p.accountId, label: p.name }));
    const en = teamData.enemyTeam.filter(p => ok(p.accountId)).map(p => ({ id: p.accountId, label: p.name }));
    const g: { label: string; players: { id: string; label: string }[] }[] = [{ label: 'Eigenes Team', players: own }];
    if (en.length) g.push({ label: `Aktuelles Gegnerteam${teamData.enemyName ? ` (${teamData.enemyName})` : ''}`, players: en });
    for (const t of LEAGUE_TEAMS) g.push({ label: `Liga 4 · [${t.tag}] ${t.name}`, players: t.players.filter(p => ok(p.accountId)).map(p => ({ id: p.accountId, label: p.name })) });
    return g.filter(x => x.players.length > 0);
  }, [teamData.team, teamData.enemyTeam, teamData.enemyName]);
  const candidates = useMemo(() => groups.flatMap(g => g.players), [groups]);

  const [open, setOpen] = useState(Boolean(startOpen));
  const [accountId, setAccountId] = useState('');
  const [custom, setCustom] = useState('');
  const [list, setList] = useState<MatchListEntry[]>([]);
  const [loaded, setLoaded] = useState<Record<number, ScoutMatch>>({});
  const [curId, setCurId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [matchInput, setMatchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const [wardTeam, setWardTeam] = useState<WardTeam>('all');
  const [obs, setObs] = useState(true);
  const [sent, setSent] = useState(true);
  const [trail, setTrail] = useState<Trail>(90);
  const [allPlayers, setAllPlayers] = useState(true);
  const [clock, setClock] = useState(0);
  const [hover, setHover] = useState<{ w: Ward; m: ScoutMatch; px: number; py: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wardPts = useRef<{ w: Ward; m: ScoutMatch; px: number; py: number }[]>([]);
  const [mapImg, setMapImg] = useState<HTMLImageElement | null>(null);
  // Feinabstimmung des Overlays (Zoom um die Kartenmitte und Verschiebung in Pixeln, jeweils bezogen auf 600 px Bildgröße)
  const [zoom, setZoom] = useState(() => { try { return Number(localStorage.getItem('dota-scout-zoom-v3') ?? 1) || 1; } catch { return 1; } });
  const [ox, setOx] = useState(() => { try { return Number(localStorage.getItem('dota-scout-ox-v3') ?? 0) || 0; } catch { return 0; } });
  const [oy, setOy] = useState(() => { try { return Number(localStorage.getItem('dota-scout-oy-v3') ?? 0) || 0; } catch { return 0; } });
  const save = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

  useEffect(() => {
    let dead = false;
    const tryLoad = (src: string, next?: () => void) => { const im = new Image(); im.onload = () => { if (!dead) setMapImg(im); }; im.onerror = () => next?.(); im.src = src; };
    let saved: string | null = null; try { saved = localStorage.getItem('dota-scout-map'); } catch { /* ignore */ }
    const pub = () => tryLoad(`${import.meta.env.BASE_URL}dota-map.png`, () => tryLoad(`${import.meta.env.BASE_URL}dota-map.jpg`));
    if (saved) tryLoad(saved, pub); else pub();
    return () => { dead = true; };
  }, []);
  const onMapFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const src = String(r.result); const im = new Image(); im.onload = () => { setMapImg(im); try { localStorage.setItem('dota-scout-map', src); } catch { /* zu groß */ } }; im.src = src; };
    r.readAsDataURL(f);
  };

  const id = custom.trim() || accountId || candidates[0]?.id || '';

  const loadList = async (accId: string) => {
    if (!/^\d+$/.test(accId)) { setError('Bitte einen Spieler wählen oder eine numerische Account-ID eingeben.'); return; }
    setLoading(true); setError(''); setList([]); setCurId(null);
    setNote('');
    try {
      let l: MatchListEntry[];
      try { l = await fetchMatchList(accId, 40); }
      catch (e1) {
        const m1 = e1 instanceof Error ? e1.message : String(e1);
        try { l = await fetchMatchListOD(accId, 40); setNote('STRATZ ist gerade nicht verfügbar (Limit/Fehler) – die Spiele kommen von OpenDota. Dort gibt es nur Wards, keine Bewegungen.'); }
        catch (e2) { throw new Error(`${m1} · Ersatz OpenDota: ${e2 instanceof Error ? e2.message : String(e2)}`); }
      }
      setList(l);
      if (l.length === 0) setError('Für diesen Spieler wurden keine Spiele gefunden (Profil evtl. privat).');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  };

  const showMatch = (m: ScoutMatch) => { setLoaded(prev => ({ ...prev, [m.id]: m })); setCurId(m.id); setClock(0); setError(''); };
  const openMatch = async (e: MatchListEntry) => {
    if (loaded[e.id]) { setCurId(e.id); setClock(0); setError(''); setNote(loaded[e.id].source === 'opendota' ? 'Dieses Spiel kommt von OpenDota: nur Wards, keine Bewegungen.' : ''); return; }
    if (!e.parsed) { setError(`Match ${e.id}: Dieses Replay ist (noch) nicht ausgewertet – es gibt keine Ward-/Positionsdaten. Neuere Spiele werden oft erst nach einiger Zeit ausgewertet.`); return; }
    setBusyId(e.id); setError('');
    try {
      let m: ScoutMatch | null = null;
      if (e.source !== 'opendota') {
        try {
          const raw = await fetchMatchPlayback(e.id);
          if (raw.playbackData?.wardEvents) m = toScoutMatch(raw, { slot: e.slot, radiant: e.radiant, heroId: e.heroId });
        } catch { /* Ersatz unten */ }
      }
      if (!m) {
        m = await fetchMatchOD(e.id, { slot: e.slot, radiant: e.radiant, heroId: e.heroId });
        setNote('Dieses Spiel kommt von OpenDota (STRATZ nicht verfügbar): nur Wards, keine Bewegungen.');
      } else setNote('');
      showMatch(m);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    setBusyId(null);
  };
  const openById = async () => {
    const mid = Number(matchInput.trim());
    if (!Number.isInteger(mid) || mid <= 0) { setError('Bitte eine numerische Match-ID eingeben.'); return; }
    setBusyId(mid); setError('');
    try {
      let m: ScoutMatch | null = null;
      try {
        const raw = await fetchMatchPlayback(mid);
        if (raw.playbackData?.wardEvents) { const me = raw.players.find(q => String(q.steamAccountId) === id) ?? raw.players[0]; m = toScoutMatch(raw, { slot: me.playerSlot, radiant: me.isRadiant, heroId: me.heroId }); }
      } catch { /* Ersatz unten */ }
      if (!m) { m = await fetchMatchOD(mid, { accountId: id }); setNote('Dieses Spiel kommt von OpenDota (STRATZ nicht verfügbar): nur Wards, keine Bewegungen.'); } else setNote('');
      showMatch(m);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    setBusyId(null);
  };

  const matches = useMemo(() => Object.values(loaded), [loaded]);
  const cur = curId !== null ? loaded[curId] : undefined;
  const maxClock = cur ? Math.max(60, cur.durationSeconds) : 0;

  // Zellen -> Canvas-Pixel. Mit Kartenbild über die beiden Brunnen kalibriert (je Achse), sonst schematisch.
  const toCanvas = useMemo(() => {
    if (!mapImg) {
      const f = (v: number) => ((v - 64) / 128) * S;
      return { x: (x: number) => f(x), y: (y: number) => S - f(y), k: S / 128 };
    }
    const kx = (IMG_D.x - IMG_R.x) / (FOUNTAIN_D.x - FOUNTAIN_R.x);
    const ky = (IMG_R.y - IMG_D.y) / (FOUNTAIN_D.y - FOUNTAIN_R.y);
    const sc = S / IMG;
    const adj = (p: number, o: number) => (IMG / 2 + (p - IMG / 2) * zoom + o) * sc;
    return {
      x: (x: number) => adj(IMG_R.x + (x - FOUNTAIN_R.x) * kx, ox),
      y: (y: number) => adj(IMG_R.y - (y - FOUNTAIN_R.y) * ky, oy),
      k: kx * zoom * sc,
    };
  }, [mapImg, zoom, ox, oy]);

  const wardOk = (w: Ward, m: ScoutMatch) => {
    if (w.kind === 'OBSERVER' ? !obs : !sent) return false;
    const mine = w.radiant === m.focusRadiant;
    return wardTeam === 'all' || (wardTeam === 'focus' ? mine : !mine);
  };

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const { x: cx, y: cy, k } = toCanvas;
    ctx.clearRect(0, 0, S, S);
    if (mapImg) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S); ctx.drawImage(mapImg, 0, 0, S, S); }
    else {
      ctx.fillStyle = '#1b2218'; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = '#5a5a48'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const l of LANE_LINES) { ctx.beginPath(); l.pts.forEach((p, i) => i ? ctx.lineTo(cx(p[0]), cy(p[1])) : ctx.moveTo(cx(p[0]), cy(p[1]))); ctx.stroke(); }
    }
    const pts: typeof wardPts.current = [];
    const m = cur;
    if (m) {
      for (const w of m.wards) {
        if (!wardOk(w, m) || clock < w.start || clock > w.end) continue;
        const px = cx(w.x), py = cy(w.y);
        ctx.beginPath(); ctx.arc(px, py, (w.kind === 'OBSERVER' ? OBS_R : SENT_R) * k, 0, 7);
        ctx.fillStyle = w.kind === 'OBSERVER' ? 'rgba(255,215,40,.25)' : 'rgba(70,150,255,.28)'; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = w.kind === 'OBSERVER' ? 'rgba(255,215,40,.8)' : 'rgba(70,150,255,.9)'; ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fillStyle = w.kind === 'OBSERVER' ? '#ffd728' : '#3c96ff'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = w.radiant ? '#2ee06a' : '#ff4a3c'; ctx.stroke();
        pts.push({ w, m, px, py });
      }
      for (const p of m.players) {
        const focus = p.slot === m.focusSlot;
        if (!focus && !allPlayers) continue;
        let lo = 0, hi = p.pos.length - 1, i = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (p.pos[mid].t <= clock) { i = mid; lo = mid + 1; } else hi = mid - 1; }
        if (i < 0) continue;
        if (focus) {
          ctx.beginPath(); let started = false;
          for (let j = i; j >= 0 && p.pos[j].t >= clock - trail; j--) { const q = p.pos[j]; started ? ctx.lineTo(cx(q.x), cy(q.y)) : ctx.moveTo(cx(q.x), cy(q.y)); started = true; }
          ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5; ctx.stroke();
        }
        const q = p.pos[i];
        ctx.beginPath(); ctx.arc(cx(q.x), cy(q.y), focus ? 9 : 6.5, 0, 7);
        ctx.fillStyle = p.radiant ? '#2e9e4f' : '#d0463b'; ctx.fill();
        ctx.lineWidth = focus ? 3 : 1.5; ctx.strokeStyle = focus ? '#fff' : 'rgba(255,255,255,.8)'; ctx.stroke();
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        const label = (heroNames[p.heroId] ?? '?').slice(0, 3);
        ctx.strokeText(label, cx(q.x), cy(q.y) - 12); ctx.fillStyle = '#fff'; ctx.fillText(label, cx(q.x), cy(q.y) - 12);
      }
    }
    wardPts.current = pts;
  });

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * S, py = ((e.clientY - r.top) / r.height) * S;
    let best: typeof hover = null, bd = 150;
    for (const p of wardPts.current) { const d = (p.px - px) ** 2 + (p.py - py) ** 2; if (d < bd) { bd = d; best = p; } }
    setHover(best);
  };

  const wardRows = useMemo(() => cur ? cur.wards.filter(w => wardOk(w, cur)).sort((a, b) => a.start - b.start) : [], [cur, wardTeam, obs, sent]);
  const heroOf = (m: ScoutMatch, slot: number) => heroNames[m.players.find(p => p.slot === slot)?.heroId ?? 0] ?? `Slot ${slot}`;
  const actions = useMemo(() => { const a: Record<string, number> = {}; for (const m of matches) for (const [k, v] of Object.entries(m.actions)) a[k] = (a[k] ?? 0) + v; return a; }, [matches]);
  const resetCal = () => { setZoom(1); setOx(0); setOy(0); save('dota-scout-zoom-v3', 1); save('dota-scout-ox-v3', 0); save('dota-scout-oy-v3', 0); };

  return (
    <section className="sc card">
      <h2 onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>Scouting – Wards & Bewegungen {open ? '▾' : '▸'}</h2>
      {open && <>
        <p className="muted">Einzelne Spiele aus ausgewerteten öffentlichen Replays (STRATZ): Wo standen wann Wards, wo war der Spieler und wo die anderen 9.</p>
        <div className="sc-row">
          <select value={accountId || candidates[0]?.id || ''} onChange={e => { setAccountId(e.target.value); setCustom(''); void loadList(e.target.value); }}>
            {groups.map(g => <optgroup key={g.label} label={g.label}>{g.players.map(c => <option key={`${g.label}-${c.id}`} value={c.id}>{c.label}</option>)}</optgroup>)}
          </select>
          <input placeholder="oder Account-ID" value={custom} onChange={e => setCustom(e.target.value)} size={12} />
          <button onClick={() => void loadList(id)} disabled={loading || !id}>{loading ? 'Lädt …' : 'Spiele anzeigen'}</button>
          <input placeholder="oder Match-ID" value={matchInput} onChange={e => setMatchInput(e.target.value)} size={12} />
          <button onClick={() => void openById()} disabled={busyId !== null || !matchInput.trim()}>Match öffnen</button>
        </div>
        {error && <p className="sc-err">{error}</p>}
        {note && <p className="sc-note">ℹ {note}</p>}
        {list.length > 0 && <div className="sc-hist">
          <table className="sc-tbl"><thead><tr><th>Datum</th><th>Held</th><th>Seite</th><th>Ergebnis</th><th>Dauer</th><th>Replay</th></tr></thead><tbody>
            {list.map(e => <tr key={e.id} className={`${curId === e.id ? 'act' : ''} ${e.parsed ? '' : 'dim'}`} onClick={() => void openMatch(e)} title={e.parsed ? 'Anklicken: Wards und Bewegungen laden' : 'Replay noch nicht ausgewertet'}>
              <td>{new Date(e.startDateTime * 1000).toLocaleDateString('de-DE')}</td>
              <td>{heroNames[e.heroId] ?? e.heroId}</td>
              <td>{e.radiant ? 'Radiant' : 'Dire'}</td>
              <td className={e.radiant === e.didRadiantWin ? 'win' : 'loss'}>{e.radiant === e.didRadiantWin ? 'Sieg' : 'Niederlage'}</td>
              <td>{Math.round(e.durationSeconds / 60)} min</td>
              <td>{busyId === e.id ? 'lädt …' : loaded[e.id] ? '✓ geladen' : e.parsed ? 'verfügbar' : '–'}</td>
            </tr>)}
          </tbody></table>
          <small className="muted">Klicke ein Spiel an, um Wards und Bewegungen zu laden. Ausgegraute Spiele hat STRATZ noch nicht ausgewertet.</small>
        </div>}
        {cur && <>
          <div className="sc-row">
            <label>Wards von <select value={wardTeam} onChange={e => setWardTeam(e.target.value as WardTeam)}><option value="all">allen</option><option value="enemy">Gegnern des Spielers</option><option value="focus">Spieler-Team</option></select></label>
            <label><input type="checkbox" checked={obs} onChange={e => setObs(e.target.checked)} /> Observer</label>
            <label><input type="checkbox" checked={sent} onChange={e => setSent(e.target.checked)} /> Sentry</label>
            <label><input type="checkbox" checked={allPlayers} onChange={e => setAllPlayers(e.target.checked)} /> alle 10 Helden</label>
            <label>Spur <select value={trail} onChange={e => setTrail(Number(e.target.value) as Trail)}><option value={90}>90 s</option><option value={300}>5 min</option><option value={100000}>ganzes Spiel</option></select></label>
            <strong>{heroNames[cur.focusHero] ?? ''} · {cur.focusRadiant ? 'Radiant' : 'Dire'} · {cur.focusRadiant === cur.didRadiantWin ? 'Sieg' : 'Niederlage'}</strong>
          </div>
            <div className="sc-row">
              <button onClick={() => setClock(c => Math.max(-90, c - 60))}>−1 min</button>
              <input type="range" min={-90} max={maxClock} value={clock} onChange={e => setClock(Number(e.target.value))} style={{ flex: 1, minWidth: 220 }} />
              <button onClick={() => setClock(c => Math.min(maxClock, c + 60))}>+1 min</button>
              <strong style={{ minWidth: 52 }}>{fmtTime(clock)}</strong>
            </div>
            <div className="sc-main">
              <div className="sc-map">
                <canvas ref={canvasRef} width={S} height={S} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
                {hover && <div className="sc-tip" style={{ left: `${(hover.px / S) * 100}%`, top: `${(hover.py / S) * 100}%` }}>
                  <b>{hover.w.kind === 'OBSERVER' ? 'Observer' : 'Sentry'}</b> {hover.w.radiant ? 'Radiant' : 'Dire'} · {heroOf(hover.m, hover.w.slot)}<br />
                  gesetzt {fmtTime(hover.w.start)} · {hover.w.ended ? `endete ${fmtTime(hover.w.end)} (${hover.w.endAction.toLowerCase()})` : `ca. bis ${fmtTime(hover.w.end)}`}<br />
                  Zelle {hover.w.x.toFixed(0)}/{hover.w.y.toFixed(0)} · {zoneOf(hover.w.x, hover.w.y)}
                </div>}
                <div className="sc-legend"><span className="o">●</span> Observer <span className="s">●</span> Sentry · Rand grün = Radiant-Ward, rot = Dire-Ward · Spieler: weißer Rand + Spur</div>
              </div>
              <div className="sc-list">
                <h3>Wards dieses Spiels ({wardRows.length})</h3>
                <div className="sc-scroll"><table className="sc-tbl"><tbody>
                  {wardRows.map((w, i) => <tr key={i} className={clock >= w.start && clock <= w.end ? 'act' : ''} onClick={() => setClock(Math.floor(w.start))} title="Zeitleiste auf diesen Zeitpunkt setzen">
                    <td>{fmtTime(w.start)}</td><td>{w.kind === 'OBSERVER' ? 'Obs' : 'Sent'}</td><td>{w.radiant ? 'R' : 'D'}</td><td>{heroOf(cur, w.slot)}</td><td>{zoneOf(w.x, w.y)}</td><td>{w.ended ? fmtTime(w.end) : '≈' + fmtTime(w.end)}</td>
                  </tr>)}
                </tbody></table></div>
                <small className="muted">Spalten: gesetzt · Typ · Team · Held · Gegend · Ende. Zeile anklicken springt zur Zeit.</small>
              </div>
            </div>
          <div className="sc-row">
            <label>Karte (Bild) <input type="file" accept="image/*" onChange={e => onMapFile(e.target.files?.[0])} /></label>
            {mapImg && <>
              <label>Zoom <input type="range" min={0.9} max={1.1} step={0.002} value={zoom} onChange={e => { const v = Number(e.target.value); setZoom(v); save('dota-scout-zoom-v3', v); }} /></label>
              <label>← → <input type="range" min={-30} max={30} step={0.5} value={ox} onChange={e => { const v = Number(e.target.value); setOx(v); save('dota-scout-ox-v3', v); }} /></label>
              <label>↑ ↓ <input type="range" min={-30} max={30} step={0.5} value={oy} onChange={e => { const v = Number(e.target.value); setOy(v); save('dota-scout-oy-v3', v); }} /></label>
              <button onClick={resetCal}>Zurücksetzen</button>
            </>}
          </div>
          <details><summary>Datenprüfung</summary>
            <p className="muted">{matches.length} Spiel(e) geladen. Ward-Ereignisse nach Aktion: {Object.entries(actions).map(([k, v]) => `${k}: ${v}`).join(', ') || '–'}. Wardende nur, wenn STRATZ ein Ende-Ereignis liefert (sonst „≈“ = Standarddauer Observer 6, Sentry 8 min). Die Karte ist über die beiden Brunnen kalibriert; die Regler korrigieren Restabweichungen.</p>
          </details>
        </>}
      </>}
    </section>
  );
}
