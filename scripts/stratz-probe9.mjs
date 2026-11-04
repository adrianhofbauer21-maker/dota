// Replay-Daten bei STRATZ prüfen: Ward-Ereignisse und Spielerpositionen eines Matches.
// Aufruf:  node scripts/stratz-probe9.mjs <Match-ID>
//     oder node scripts/stratz-probe9.mjs --player <Account-ID>     (nimmt das letzte Spiel dieses Spielers)
// Der Token wird aus .env.local gelesen und NIE ausgegeben.
import { readFileSync, existsSync } from 'node:fs';

const URL_ = process.env.STRATZ_URL ?? 'https://api.stratz.com/graphql';

function readToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*STRATZ_TOKEN\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
}
const token = readToken();
if (!token) { console.error('Kein STRATZ_TOKEN in .env.local gefunden.'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function gql(query) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* kein JSON */ }
      const transient = res.status >= 500 || /Error trying to resolve/.test(text);
      if (transient && i < 3) { await sleep(1500 * (i + 1)); continue; }
      return { status: res.status, json, text };
    } catch (e) {
      if (i === 3) return { status: 0, json: null, text: String(e) };
      await sleep(1500 * (i + 1));
    }
  }
}
const cut = (s, n = 500) => { s = typeof s === 'string' ? s : JSON.stringify(s); return s.length > n ? s.slice(0, n) + ' …' : s; };

async function probe(title, query, pick) {
  console.log(`\n### ${title}`);
  console.log('    ' + query.replace(/\s+/g, ' ').trim());
  const r = await gql(query);
  if (r.json?.errors) { console.log('    FEHLER:', cut(r.json.errors.map(e => e.message).join(' | '), 700)); return null; }
  if (!r.json?.data) { console.log(`    HTTP ${r.status}:`, cut(r.text, 300)); return null; }
  const val = pick ? pick(r.json.data) : r.json.data;
  console.log('    OK:', cut(val, 600));
  return r.json.data;
}

let matchId = process.argv[2];
if (matchId === '--player') {
  const acc = process.argv[3];
  if (!/^\d+$/.test(acc ?? '')) { console.error('Aufruf: node scripts/stratz-probe9.mjs --player <Account-ID>'); process.exit(1); }
  const d = await probe('Letztes Spiel des Spielers', `{ player(steamAccountId: ${acc}) { matches(request: { take: 1 }) { id startDateTime } } }`);
  matchId = d?.player?.matches?.[0]?.id;
  if (!matchId) { console.error('Kein Spiel gefunden.'); process.exit(1); }
  console.log('→ verwende Match', matchId);
}
if (!/^\d+$/.test(matchId ?? '')) { console.error('Aufruf: node scripts/stratz-probe9.mjs <Match-ID>  oder  --player <Account-ID>'); process.exit(1); }

const M = `match(id: ${matchId})`;
await probe('Grunddaten + Analysestatus', `{ ${M} { id durationSeconds didRadiantWin startDateTime parsedDateTime analysisOutcome } }`);
await probe('Grunddaten ohne optionale Felder', `{ ${M} { id durationSeconds didRadiantWin startDateTime } }`);
await probe('Spieler (Slot, Hero, Team)', `{ ${M} { players { steamAccountId playerSlot heroId isRadiant position } } }`, d => d.match?.players?.slice(0, 3));
const w = await probe('Ward-Ereignisse (playbackData.wardEvents)',
  `{ ${M} { playbackData { wardEvents { indexId time positionX positionY fromPlayer wardType action } } } }`,
  d => ({ anzahl: d.match?.playbackData?.wardEvents?.length, beispiel: d.match?.playbackData?.wardEvents?.slice(0, 4) }));
if (!w) {
  await probe('Ward-Ereignisse (nur Zeit/Ort)', `{ ${M} { playbackData { wardEvents { time positionX positionY } } } }`);
  await probe('playbackData: Felder erraten', `{ ${M} { playbackData { __typename } } }`);
}
const p = await probe('Positionen je Spieler (players.playbackData.playerUpdatePositionEvents)',
  `{ ${M} { players { playerSlot playbackData { playerUpdatePositionEvents { time x y } } } } }`,
  d => ({ spieler: d.match?.players?.length, ereignisseSpieler1: d.match?.players?.[0]?.playbackData?.playerUpdatePositionEvents?.length, beispiel: d.match?.players?.[0]?.playbackData?.playerUpdatePositionEvents?.slice(0, 4) }));
if (!p) {
  await probe('Positionen (nur ein Spieler, Zeit/x/y)', `{ ${M} { players { playerSlot playbackData { playerUpdatePositionEvents { time } } } } }`);
  await probe('Spieler-playbackData: Typ', `{ ${M} { players { playbackData { __typename } } } }`);
}
console.log('\nFertig. Bitte die komplette Ausgabe kopieren und im Chat einfügen.');
