// Siebte Prüfrunde: Spielerdaten bei STRATZ.
// Aufruf:  node scripts/stratz-probe7.mjs <Account-ID>
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

async function gql(query) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kein JSON */ }
  return { status: res.status, json, text };
}


const ID = process.argv[2];
if (!/^\d+$/.test(ID ?? '')) { console.error('Bitte die Account-ID angeben: node scripts/stratz-probe7.mjs 119112835'); process.exit(1); }
const T = [
  ['Fenster 100 Spiele', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 100 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Fenster 1000 Spiele', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 1000 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Fenster 10000 Spiele', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 10000 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Fenster 100000 Spiele', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 100000 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Nur Position 5, 100000', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 100000, positionIds: [POSITION_5] }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Nur Patch 190, 100000', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 100000, gameVersionIds: [190] }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Seit Patch-Start (Zeit)', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, request: { take: 100000, startDateTime: 1789430400 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Held-Filter (Witch Doctor)', '{ player(steamAccountId: ID) { heroesPerformance(take: 200, heroId: 30, request: { take: 100000 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Feld lastPlayedDateTime', '{ player(steamAccountId: ID) { heroesPerformance(take: 3, request: { take: 100 }) { heroId matchCount winCount lastPlayedDateTime } } }'.replaceAll('ID', ID)],
  ['Felder: Position/Rolle', '{ player(steamAccountId: ID) { heroesPerformance(take: 3, request: { take: 100 }) { heroId matchCount winCount position role lane } } }'.replaceAll('ID', ID)],
  ['Spiele-Seite: skip', '{ player(steamAccountId: ID) { matches(request: { take: 100, skip: 100 }) { id } } }'.replaceAll('ID', ID)],
  ['Spiele-Seite: take 500', '{ player(steamAccountId: ID) { matches(request: { take: 500 }) { id } } }'.replaceAll('ID', ID)],
];

for (const [label, query] of T) {
  let r = await gql(query);
  for (let k = 0; k < 2 && r.status >= 500; k++) { await new Promise(res => setTimeout(res, 4000)); r = await gql(query); } // 5xx: kurz warten, bis zu 2x wiederholen
  console.log(`### ${label}`);
  console.log(`    ${query}`);
  if (r.json?.errors?.length) {
    for (const e of r.json.errors.slice(0, 4)) console.log(`    FEHLER: ${String(e.message).slice(0, 300)}`);
  } else if (r.json?.data) {
    const p = r.json.data.player;
    const hp = p?.heroesPerformance;
    if (Array.isArray(hp)) {
      const sum = hp.reduce((s, x) => s + (x.matchCount ?? 0), 0);
      const wd = hp.find(x => x.heroId === 30);
      console.log(`    OK: ${hp.length} Helden, Summe Spiele ${sum}, Witch Doctor: ${wd ? JSON.stringify(wd) : '-'}`);
      console.log(`    Beispiel: ${JSON.stringify(hp.slice(0, 2))}`);
    } else if (Array.isArray(p?.matches)) {
      console.log(`    OK: ${p.matches.length} Spiele geliefert`);
    } else console.log(`    OK: ${JSON.stringify(r.json.data).slice(0, 300)}`);
  } else console.log(`    HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  console.log('');
  await new Promise(res => setTimeout(res, 1500));
}
