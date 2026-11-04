import { useEffect, useMemo, useRef, useState } from 'react';
import type { useTeamData } from './teamData';
import { LANE_LINES, MAP_MAX, MAP_MIN, ZONES, fetchMatchList, fmtTime, loadMatches, zoneOf, type ScoutMatch, type Ward } from './scout';

type Props = { teamData: ReturnType<typeof useTeamData>; heroNames: Record<number, string> };

const S = 560; // Canvas-Größe in px
const cx = (x: number) => ((x - MAP_MIN) / (MAP_MAX - MAP_MIN)) * S;
const cy = (y: number) => ((MAP_MAX - y) / (MAP_MAX - MAP_MIN)) * S; // Norden oben
const OBS_R = 12.5, SENT_R = 7; // Sichtradius in Karten-Zellen (grob)

type Mode = 'agg' | 'single';
type Side = 'all' | 'radiant' | 'dire';
type WardTeam = 'focus' | 'enemy' | 'all';

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

  const [mode, setMode] = useState<Mode>('agg');
  const [side, setSide] = useState<Side>('all');
  const [wardTeam, setWardTeam] = useState<WardTeam>('enemy');
  const [obs, setObs] = useState(true);
  const [sent, setSent] = useState(true);
  const [range, setRange] = useState<[number, number]>([-1, 15]);
  const [heat, setHeat] = useState(true);
  const [sel, setSel] = useState(0);
  const [clock, setClock] = useState(0);
  const [hover, setHover] = useState<{ w: Ward; m: ScoutMatch; px: number; py: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mapImg, setMapImg] = useState<HTMLImageElement | null>(null);
  const [pad, setPad] = useState(() => { try { return Number(localStorage.getItem('dota-scout-pad-v2') ?? 8.5); } catch { return 8.5; } });
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
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
  const wardPts = useRef<{ w: Ward; m: ScoutMatch; px: number; py: number }[]>([]);

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

  const shown = useMemo(() => matches.filter(m => side === 'all' || (side === 'radiant') === m.focusRadiant), [matches, side]);
  const wardOk = (w: Ward, m: ScoutMatch) => {
    if (w.kind === 'OBSERVER' ? !obs : !sent) return false;
    const mine = w.radiant === m.focusRadiant;
    return wardTeam === 'all' || (wardTeam === 'focus' ? mine : !mine);
  };
  const [t0, t1] = [range[0] * 60, range[1] * 60];

  // ---- Zeichnen ----
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const dark = css.colorScheme === 'dark' || window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    ctx.clearRect(0, 0, S, S);
    // Hintergrund: echte Dota-Karte, sonst schematisch
    if (mapImg) {
      const k = (128 + 2 * pad) / 128;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
      ctx.drawImage(mapImg, -S * pad / 128 + dx, -S * pad / 128 + dy, S * k, S * k);
    } else {
    ctx.fillStyle = dark ? '#1b2218' : '#e8efe0'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = dark ? '#223a46' : '#bcd8e6'; // Fluss (Diagonale x+y=256)
    ctx.beginPath(); const d = 7;
    ctx.moveTo(cx(256 - MAP_MAX - d), cy(MAP_MAX)); ctx.lineTo(cx(256 - MAP_MAX + d), cy(MAP_MAX));
    ctx.lineTo(cx(MAP_MAX), cy(256 - MAP_MAX + d)); ctx.lineTo(cx(MAP_MAX), cy(256 - MAP_MAX - d)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = dark ? '#5a5a48' : '#c9b98a'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const l of LANE_LINES) { ctx.beginPath(); l.pts.forEach((p, i) => i ? ctx.lineTo(cx(p[0]), cy(p[1])) : ctx.moveTo(cx(p[0]), cy(p[1]))); ctx.stroke(); }
    }
    if (!mapImg) {
    ctx.fillStyle = 'rgba(60,170,90,.35)'; ctx.beginPath(); ctx.arc(cx(78), cy(78), 36, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(200,70,60,.35)'; ctx.beginPath(); ctx.arc(cx(178), cy(178), 36, 0, 7); ctx.fill();
    }

    const pts: typeof wardPts.current = [];
    if (mode === 'agg') {
      if (heat) {
        const B = 64, bins = new Float32Array(B * B); let max = 0;
        for (const m of shown) {
          const p = m.players.find(q => q.slot === m.focusSlot); if (!p) continue;
          for (let i = 0; i + 1 < p.pos.length; i++) {
            const a = p.pos[i]; if (a.t < t0 || a.t > t1) continue;
            const w = Math.min(5, p.pos[i + 1].t - a.t); if (w <= 0) continue;
            const bx = Math.min(B - 1, Math.max(0, Math.floor(((a.x - MAP_MIN) / (MAP_MAX - MAP_MIN)) * B)));
            const by = Math.min(B - 1, Math.max(0, Math.floor(((a.y - MAP_MIN) / (MAP_MAX - MAP_MIN)) * B)));
            const v = (bins[by * B + bx] += w); if (v > max) max = v;
          }
        }
        const cell = S / B;
        for (let by = 0; by < B; by++) for (let bx = 0; bx < B; bx++) {
          const v = bins[by * B + bx]; if (!v) continue;
          ctx.fillStyle = `rgba(255,${Math.round(190 - 150 * Math.sqrt(v / max))},30,${0.15 + 0.6 * Math.sqrt(v / max)})`;
          ctx.fillRect(bx * cell, S - (by + 1) * cell, cell + 0.5, cell + 0.5);
        }
      }
      for (const m of shown) for (const w of m.wards) {
        if (!wardOk(w, m) || w.start < t0 || w.start > t1) continue;
        const px = cx(w.x), py = cy(w.y);
        ctx.beginPath(); ctx.arc(px, py, (w.kind === 'OBSERVER' ? OBS_R : SENT_R) / (MAP_MAX - MAP_MIN) * S, 0, 7);
        ctx.fillStyle = w.kind === 'OBSERVER' ? 'rgba(240,200,40,.10)' : 'rgba(60,140,255,.10)'; ctx.fill();
        pts.push({ w, m, px, py });
      }
      for (const { w, px, py } of pts) {
        ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7);
        ctx.fillStyle = w.kind === 'OBSERVER' ? '#e6b800' : '#2f7bff'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = w.radiant ? '#2e9e4f' : '#d0463b'; ctx.stroke();
      }
    } else {
      const m = matches[sel];
      if (m) {
        for (const w of m.wards) {
          if (!wardOk(w, m) || clock < w.start || clock > w.end) continue;
          const px = cx(w.x), py = cy(w.y);
          ctx.beginPath(); ctx.arc(px, py, (w.kind === 'OBSERVER' ? OBS_R : SENT_R) / (MAP_MAX - MAP_MIN) * S, 0, 7);
          ctx.fillStyle = w.kind === 'OBSERVER' ? 'rgba(240,200,40,.22)' : 'rgba(60,140,255,.22)'; ctx.fill();
          ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fillStyle = w.kind === 'OBSERVER' ? '#e6b800' : '#2f7bff'; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = w.radiant ? '#2e9e4f' : '#d0463b'; ctx.stroke();
          pts.push({ w, m, px, py });
        }
        for (const p of m.players) {
          // letzter Positionspunkt <= clock
          let lo = 0, hi = p.pos.length - 1, k = -1;
          while (lo <= hi) { const mid = (lo + hi) >> 1; if (p.pos[mid].t <= clock) { k = mid; lo = mid + 1; } else hi = mid - 1; }
          if (k < 0) continue;
          if (p.slot === m.focusSlot) { // Spur der letzten 90 s
            ctx.beginPath(); let started = false;
            for (let i = k; i >= 0 && p.pos[i].t >= clock - 90; i--) { const q = p.pos[i]; started ? ctx.lineTo(cx(q.x), cy(q.y)) : ctx.moveTo(cx(q.x), cy(q.y)); started = true; }
            ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.stroke();
          }
          const q = p.pos[k];
          ctx.beginPath(); ctx.arc(cx(q.x), cy(q.y), p.slot === m.focusSlot ? 8 : 6, 0, 7);
          ctx.fillStyle = p.radiant ? '#2e9e4f' : '#d0463b'; ctx.fill();
          ctx.lineWidth = p.slot === m.focusSlot ? 3 : 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText((heroNames[p.heroId] ?? '?').slice(0, 2), cx(q.x), cy(q.y) - 11);
        }
      }
    }
    wardPts.current = pts;
  });

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * S, py = ((e.clientY - r.top) / r.height) * S;
    let best: typeof hover = null, bd = 100;
    for (const p of wardPts.current) { const d = (p.px - px) ** 2 + (p.py - py) ** 2; if (d < bd) { bd = d; best = p; } }
    setHover(best);
  };

  // ---- Auswertung ----
  const perMinute = useMemo(() => {
    const bars = new Map<number, number>();
    for (const m of shown) for (const w of m.wards) if (wardOk(w, m)) { const k = Math.floor(w.start / 60); bars.set(k, (bars.get(k) ?? 0) + 1); }
    const keys = [...bars.keys()]; if (!keys.length) return [];
    const lo = Math.min(-1, ...keys), hi = Math.max(...keys);
    return Array.from({ length: hi - lo + 1 }, (_, i) => ({ min: lo + i, n: bars.get(lo + i) ?? 0 }));
  }, [shown, wardTeam, obs, sent]);

  const zoneRows = useMemo(() => {
    const rows: { label: string; top: [string, number][] }[] = [];
    for (let a = 0; a < 40; a += 5) {
      const acc: Record<string, number> = {}; let tot = 0;
      for (const m of shown) {
        const p = m.players.find(q => q.slot === m.focusSlot); if (!p) continue;
        for (let i = 0; i + 1 < p.pos.length; i++) {
          const q = p.pos[i]; if (q.t < a * 60 || q.t >= (a + 5) * 60) continue;
          const w = Math.min(5, p.pos[i + 1].t - q.t); if (w <= 0) continue;
          const z = zoneOf(q.x, q.y); acc[z] = (acc[z] ?? 0) + w; tot += w;
        }
      }
      if (tot > 0) rows.push({ label: `${a}–${a + 5}`, top: Object.entries(acc).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([z, v]) => [z, v / tot] as [string, number]) });
    }
    return rows;
  }, [shown]);
  void ZONES;

  const cur = matches[sel];
  const maxClock = cur ? Math.max(60, cur.durationSeconds) : 0;
  const barMax = Math.max(1, ...perMinute.map(b => b.n));
  const actions = useMemo(() => { const a: Record<string, number> = {}; for (const m of matches) for (const [k, v] of Object.entries(m.actions)) a[k] = (a[k] ?? 0) + v; return a; }, [matches]);

  return (
    <section className="sc card">
      <h2 onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>Scouting – Wards & Bewegungen {open ? '▾' : '▸'}</h2>
      {open && <>
        <p className="muted">Daten aus ausgewerteten öffentlichen Replays (STRATZ). Wähle einen Spieler und lade seine letzten Spiele – du siehst, wo er/seine Gegner Wards setzen und wo er sich wann aufhält.</p>
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
            <label>Ansicht <select value={mode} onChange={e => setMode(e.target.value as Mode)}><option value="agg">Alle Spiele zusammen</option><option value="single">Einzelnes Spiel (Zeitleiste)</option></select></label>
            <label>Seite des Spielers <select value={side} onChange={e => setSide(e.target.value as Side)}><option value="all">beide</option><option value="radiant">nur Radiant</option><option value="dire">nur Dire</option></select></label>
            <label>Wards von <select value={wardTeam} onChange={e => setWardTeam(e.target.value as WardTeam)}><option value="enemy">Gegnern des Spielers</option><option value="focus">Spieler-Team</option><option value="all">allen</option></select></label>
            <label><input type="checkbox" checked={obs} onChange={e => setObs(e.target.checked)} /> Observer</label>
            <label><input type="checkbox" checked={sent} onChange={e => setSent(e.target.checked)} /> Sentry</label>
          </div>
          {mode === 'agg' && <div className="sc-row">
            <label>Zeit {fmtTime(range[0] * 60)} – {fmtTime(range[1] * 60)}
              <input type="range" min={-2} max={60} value={range[0]} onChange={e => setRange([Math.min(Number(e.target.value), range[1]), range[1]])} />
              <input type="range" min={-2} max={60} value={range[1]} onChange={e => setRange([range[0], Math.max(Number(e.target.value), range[0])])} /></label>
            <button onClick={() => setRange([-2, 10])}>Laning</button><button onClick={() => setRange([10, 25])}>Midgame</button><button onClick={() => setRange([25, 60])}>Lategame</button><button onClick={() => setRange([-2, 60])}>alles</button>
            <label><input type="checkbox" checked={heat} onChange={e => setHeat(e.target.checked)} /> Aufenthalt (Heatmap)</label>
          </div>}
          {mode === 'single' && cur && <div className="sc-row">
            <select value={sel} onChange={e => { setSel(Number(e.target.value)); setClock(0); }}>
              {matches.map((m, i) => <option key={m.id} value={i}>{new Date(m.startDateTime * 1000).toLocaleDateString('de-DE')} · {heroNames[m.focusHero] ?? m.focusHero} · {m.focusRadiant === m.didRadiantWin ? 'Sieg' : 'Niederlage'} · {m.focusRadiant ? 'Radiant' : 'Dire'}</option>)}
            </select>
            <input type="range" min={-90} max={maxClock} value={clock} onChange={e => setClock(Number(e.target.value))} style={{ flex: 1, minWidth: 200 }} />
            <strong>{fmtTime(clock)}</strong>
          </div>}
          <div className="sc-row">
            <label>Karte (Bild) <input type="file" accept="image/*" onChange={e => onMapFile(e.target.files?.[0])} /></label>
            {mapImg && <>
              <label>Zoom <input type="range" min={-30} max={40} step={0.5} value={pad} onChange={e => { const v = Number(e.target.value); setPad(v); try { localStorage.setItem('dota-scout-pad-v2', String(v)); } catch { /* ignore */ } }} /></label>
              <label>← → <input type="range" min={-60} max={60} value={dx} onChange={e => setDx(Number(e.target.value))} /></label>
              <label>↑ ↓ <input type="range" min={-60} max={60} value={dy} onChange={e => setDy(Number(e.target.value))} /></label>
            </>}
          </div>
          <div className="sc-map">
            <canvas ref={canvasRef} width={S} height={S} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
            {hover && <div className="sc-tip" style={{ left: `${(hover.px / S) * 100}%`, top: `${(hover.py / S) * 100}%` }}>
              <b>{hover.w.kind === 'OBSERVER' ? 'Observer' : 'Sentry'}</b> {hover.w.radiant ? 'Radiant' : 'Dire'}<br />
              gesetzt {fmtTime(hover.w.start)}, {hover.w.ended ? `endete ${fmtTime(hover.w.end)} (${hover.w.endAction.toLowerCase()})` : `ca. bis ${fmtTime(hover.w.end)}`}<br />
              von {heroNames[hover.m.players.find(p => p.slot === hover.w.slot)?.heroId ?? 0] ?? 'Slot ' + hover.w.slot} · Match {hover.m.id}
            </div>}
            <div className="sc-legend"><span className="o">●</span> Observer <span className="s">●</span> Sentry · Rand grün = Radiant-Ward, rot = Dire-Ward · Radiant-Basis unten links</div>
          </div>
          {mode === 'agg' && <>
            <h3>Wards pro Spielminute</h3>
            <div className="sc-bars">{perMinute.map(b => <div key={b.min} title={`${b.min}. Min: ${b.n}`}><i style={{ height: `${(b.n / barMax) * 60}px` }} /><small>{b.min}</small></div>)}</div>
            <h3>Wo hält sich der Spieler auf? (je 5 Minuten, gesamt über {shown.length} Spiele)</h3>
            <table className="sc-tbl"><tbody>{zoneRows.map(r => <tr key={r.label}><td>{r.label} min</td><td>{r.top.map(([z, f]) => `${z} ${Math.round(f * 100)} %`).join(' · ')}</td></tr>)}</tbody></table>
          </>}
          <details><summary>Datenprüfung</summary>
            <p className="muted">{matches.length} Spiele geladen · {skipped.unparsed} ohne ausgewertetes Replay übersprungen · {skipped.failed} Abruf fehlgeschlagen. Ward-Ereignisse nach Aktion: {Object.entries(actions).map(([k, v]) => `${k}: ${v}`).join(', ') || '–'}. Position des Spielers nur auf ~Sekundenbasis; Wardende nur, wenn STRATZ ein Ende-Ereignis liefert, sonst Standarddauer (Observer 6, Sentry 8 min). Zonen sind eine grobe Schätzung.</p>
          </details>
        </>}
      </>}
    </section>
  );
}
