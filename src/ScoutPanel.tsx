import { useEffect, useMemo, useRef, useState } from 'react';
import type { useTeamData } from './teamData';
import { LANE_LINES, fetchMatchList, fmtTime, loadMatches, zoneOf, type ScoutMatch, type Ward } from './scout';

type Props = { teamData: ReturnType<typeof useTeamData>; heroNames: Record<number, string> };

const S = 640; // Canvas-Größe in px
const OBS_R = 12.5, SENT_R = 7.8; // Sichtradius in Karten-Zellen (1600 bzw. 1000 Einheiten, 1 Zelle = 128 Einheiten)

// Bezugspunkte: Brunnen in STRATZ-Zellen (aus echten Spielen) und im Kartenbild (Pixel im 600×600-Bild).
const FOUNTAIN_R = { x: 74, y: 74 }, FOUNTAIN_D = { x: 180, y: 180 };
const IMG = 768, IMG_R = { x: 60, y: 708 }, IMG_D = { x: 696, y: 72 };

type Side = 'radiant' | 'dire';
type WardTeam = 'focus' | 'enemy' | 'all';
type Trail = 90 | 300 | 100000;

export default function ScoutPanel({ teamData, heroNames }: Props) {
  const candidates = useMemo(() => {
    const own = teamData.team.filter(p => /^\d+$/.test(p.accountId)).map(p => ({ id: p.accountId, label: `${p.name} (eigenes Team)` }));
    const en = teamData.enemyTeam.filter(p => /^\d+$/.test(p.accountId)).map(p => ({ id: p.accountId, label: `${p.name} (${teamData.enemyName || 'Gegner'})` }));
    return [...own, ...en];
  }, [teamData.team, teamData.enemyTeam, teamData.enemyName]);

  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [custom, setCustom] = useState('');
  const [count, setCount] = useState(10);
  const [matches, setMatches] = useState<ScoutMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState({ unparsed: 0, failed: 0 });

  const [side, setSide] = useState<Side>('radiant');
  const [wardTeam, setWardTeam] = useState<WardTeam>('all');
  const [obs, setObs] = useState(true);
  const [sent, setSent] = useState(true);
  const [trail, setTrail] = useState<Trail>(90);
  const [allPlayers, setAllPlayers] = useState(true);
  const [sel, setSel] = useState(0);
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

  const load = async () => {
    if (!/^\d+$/.test(id)) { setError('Bitte einen Spieler wählen oder eine numerische Account-ID eingeben.'); return; }
    setLoading(true); setError(''); setMatches([]); setProgress('Spiele werden gesucht …');
    try {
      const list = await fetchMatchList(id, Math.min(60, count * 3));
      const parsed = list.filter(m => m.parsed).slice(0, count);
      const unparsed = list.slice(0, count * 2).filter(m => !m.parsed).length;
      if (parsed.length === 0) { setError('STRATZ hat unter den letzten Spielen keines mit ausgewertetem Replay (nur ausgewertete Spiele haben Wards/Positionen).'); setLoading(false); return; }
      const res = await loadMatches(parsed, (d, t) => setProgress(`Replaydaten ${d}/${t} …`));
      setMatches(res.matches); setSkipped({ unparsed, failed: res.failed }); setSel(0); setClock(0);
      if (res.matches.length === 0) setError('Keine Replaydaten abrufbar (STRATZ-Limit? In ein paar Minuten erneut versuchen).');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false); setProgress('');
  };

  const shown = useMemo(() => matches.filter(m => (side === 'radiant') === m.focusRadiant), [matches, side]);
  const nRad = matches.filter(m => m.focusRadiant).length;
  const cur = shown[Math.min(sel, shown.length - 1)];
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
          <select value={accountId} onChange={e => setAccountId(e.target.value)}>
            {candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input placeholder="oder Account-ID" value={custom} onChange={e => setCustom(e.target.value)} size={12} />
          <select value={count} onChange={e => setCount(Number(e.target.value))}>{[5, 10, 20].map(n => <option key={n} value={n}>{n} Spiele</option>)}</select>
          <button onClick={load} disabled={loading || !id}>{loading ? 'Lädt …' : 'Laden'}</button>
          {progress && <span className="muted">{progress}</span>}
        </div>
        {error && <p className="sc-err">{error}</p>}
        {matches.length > 0 && <>
          <div className="sc-row">
            <span className="sc-side">
              <button className={side === 'radiant' ? 'on' : ''} onClick={() => { setSide('radiant'); setSel(0); setClock(0); }}>Spieler auf Radiant ({nRad})</button>
              <button className={side === 'dire' ? 'on' : ''} onClick={() => { setSide('dire'); setSel(0); setClock(0); }}>Spieler auf Dire ({matches.length - nRad})</button>
            </span>
            <label>Wards von <select value={wardTeam} onChange={e => setWardTeam(e.target.value as WardTeam)}><option value="all">allen</option><option value="enemy">Gegnern des Spielers</option><option value="focus">Spieler-Team</option></select></label>
            <label><input type="checkbox" checked={obs} onChange={e => setObs(e.target.checked)} /> Observer</label>
            <label><input type="checkbox" checked={sent} onChange={e => setSent(e.target.checked)} /> Sentry</label>
            <label><input type="checkbox" checked={allPlayers} onChange={e => setAllPlayers(e.target.checked)} /> alle 10 Helden</label>
            <label>Spur <select value={trail} onChange={e => setTrail(Number(e.target.value) as Trail)}><option value={90}>90 s</option><option value={300}>5 min</option><option value={100000}>ganzes Spiel</option></select></label>
          </div>
          {!cur ? <p className="muted">Keine Spiele auf dieser Seite.</p> : <>
            <div className="sc-row">
              <select value={Math.min(sel, shown.length - 1)} onChange={e => { setSel(Number(e.target.value)); setClock(0); }}>
                {shown.map((m, i) => <option key={`${m.id}-${i}`} value={i}>{new Date(m.startDateTime * 1000).toLocaleDateString('de-DE')} · {heroNames[m.focusHero] ?? m.focusHero} · {m.focusRadiant === m.didRadiantWin ? 'Sieg' : 'Niederlage'} · {Math.round(m.durationSeconds / 60)} min · {m.id}</option>)}
              </select>
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
          </>}
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
            <p className="muted">{matches.length} Spiele geladen · {skipped.unparsed} ohne ausgewertetes Replay übersprungen · {skipped.failed} Abruf fehlgeschlagen. Ward-Ereignisse nach Aktion: {Object.entries(actions).map(([k, v]) => `${k}: ${v}`).join(', ') || '–'}. Wardende nur, wenn STRATZ ein Ende-Ereignis liefert (sonst „≈“ = Standarddauer Observer 6, Sentry 8 min). Die Karte ist über die beiden Brunnen kalibriert; die Regler korrigieren Restabweichungen.</p>
          </details>
        </>}
      </>}
    </section>
  );
}
