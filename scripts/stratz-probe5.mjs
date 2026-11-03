// Fünfte Prüfrunde: Aktualität und Patch-Datum.
// Aufruf:  node scripts/stratz-probe5.mjs
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


const T = [
  ['Wochen: neueste 8 (Held 1)', '{ heroStats { winWeek(take: 8, heroIds: [1]) { week matchCount } } }'],
  ['Tage: neueste 5 (Held 1)', '{ heroStats { winDay(take: 5, heroIds: [1]) { day matchCount } } }'],
  ['Tage: Feld date', '{ heroStats { winDay(take: 2, heroIds: [1]) { date matchCount } } }'],
  ['Patch-Liste: Felder id name', '{ constants { gameVersions { id name } } }'],
  ['Patch-Liste: Datum asOfDateTime', '{ constants { gameVersions { id name asOfDateTime } } }'],
  ['Patch-Liste: Datum startDateTime', '{ constants { gameVersions { id name startDateTime } } }'],
  ['Patch-Liste: Datum beginDateTime', '{ constants { gameVersions { id name beginDateTime } } }'],
  ['Patch-Liste: Datum date', '{ constants { gameVersions { id name date } } }'],
  ['Patch-Liste: Datum releaseDate', '{ constants { gameVersions { id name releaseDate } } }'],
  ['Patch-Liste: Datum dateTime', '{ constants { gameVersions { id name dateTime } } }'],
  ['winGameVersion: ganze Liste', '{ heroStats { winGameVersion(heroIds: [1]) { gameVersionId matchCount } } }'],
];
console.log('Heute (Rechner):', new Date().toISOString());

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
