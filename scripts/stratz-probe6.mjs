// Sechste Prüfrunde: Spielerdaten bei STRATZ.
// Aufruf:  node scripts/stratz-probe6.mjs <Account-ID>
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
if (!/^\d+$/.test(ID ?? '')) { console.error('Bitte die Account-ID angeben: node scripts/stratz-probe6.mjs 119112835'); process.exit(1); }
const T = [
  ['Spieler: Name + Gesamtspiele', '{ player(steamAccountId: ID) { steamAccount { id name } matchCount winCount } }'.replaceAll('ID', ID)],
  ['Heldenleistung: Top 5', '{ player(steamAccountId: ID) { heroesPerformance(take: 5) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Heldenleistung: Top 5 (mehr Felder)', '{ player(steamAccountId: ID) { heroesPerformance(take: 5) { heroId matchCount winCount lastMatchDateTime } } }'.replaceAll('ID', ID)],
  ['Heldenleistung: Top 200', '{ player(steamAccountId: ID) { heroesPerformance(take: 200) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Heldenleistung: nach Position', '{ player(steamAccountId: ID) { heroesPerformance(take: 5, positionIds: [POSITION_5]) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Heldenleistung: nach Patch', '{ player(steamAccountId: ID) { heroesPerformance(take: 5, gameVersionIds: [190]) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Heldenleistung: request-Argument', '{ player(steamAccountId: ID) { heroesPerformance(request: { take: 5 }) { heroId matchCount winCount } } }'.replaceAll('ID', ID)],
  ['Letzte Spiele (Felder raten)', '{ player(steamAccountId: ID) { matches(request: { take: 3 }) { id didRadiantWin startDateTime durationSeconds } } }'.replaceAll('ID', ID)],
  ['Letzte Spiele: Spielerdaten', '{ player(steamAccountId: ID) { matches(request: { take: 3 }) { id players(steamAccountId: ID) { heroId isVictory kills deaths assists position } } } }'.replaceAll('ID', ID)],
];

for (const [label, query] of T) {
  const r = await gql(query);
  console.log(`### ${label}`);
  console.log(`    ${query}`);
  if (r.json?.errors?.length) {
    for (const e of r.json.errors.slice(0, 4)) console.log(`    FEHLER: ${String(e.message).slice(0, 300)}`);
  } else if (r.json?.data) {
    console.log(`    OK: ${JSON.stringify(r.json.data).slice(0, 300)}`);
  } else {
    console.log(`    HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  }
  console.log('');
}
