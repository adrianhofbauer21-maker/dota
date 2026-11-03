// Dritte Prüfrunde.
// Aufruf:  node scripts/stratz-probe3.mjs
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


const GV = a => `{ heroStats { winGameVersion(${a}) { heroId matchCount winCount } } }`;
const MU = (a, f) => `{ heroStats { matchUp(${a}) { ${f} } } }`;
const T = [
  // Rang-Werte einzeln
  ['Rang: LEGEND',   '{ heroStats { winWeek(take: 1, heroIds: [1], bracketIds: [LEGEND]) { heroId matchCount } } }'],
  ['Rang: ANCIENT',  '{ heroStats { winWeek(take: 1, heroIds: [1], bracketIds: [ANCIENT]) { heroId matchCount } } }'],
  ['Rang: ARCHON',   '{ heroStats { winWeek(take: 1, heroIds: [1], bracketIds: [ARCHON]) { heroId matchCount } } }'],
  ['Rang: CRUSADER', '{ heroStats { winWeek(take: 1, heroIds: [1], bracketIds: [CRUSADER]) { heroId matchCount } } }'],
  ['Rang: GUARDIAN', '{ heroStats { winWeek(take: 1, heroIds: [1], bracketIds: [GUARDIAN]) { heroId matchCount } } }'],
  ['Rang: HERALD',   '{ heroStats { winWeek(take: 1, heroIds: [1], bracketIds: [HERALD]) { heroId matchCount } } }'],
  // Patch-Auswertung
  ['winGameVersion: Felder raten', '{ heroStats { winGameVersion(take: 3, heroIds: [1]) { heroId gameVersionId matchCount winCount } } }'],
  ['winGameVersion: Felder (Alternative)', '{ heroStats { winGameVersion(take: 3, heroIds: [1]) { heroId gameVersion version matchCount winCount } } }'],
  ['winGameVersion: mit Rang + Position', '{ heroStats { winGameVersion(take: 3, heroIds: [1], bracketIds: [DIVINE, IMMORTAL], positionIds: [POSITION_1]) { heroId matchCount winCount } } }'],
  ['winGameVersion: ohne Take', '{ heroStats { winGameVersion(heroIds: [1]) { heroId gameVersionId matchCount winCount } } }'],
  // Matchup: Zählfelder
  ['matchUp: winsVs/winsWith',    MU('heroId: 1, take: 2', 'heroId matchCountVs matchCountWith winsVs winsWith')],
  ['matchUp: winCount',           MU('heroId: 1, take: 2', 'heroId winCount')],
  ['matchUp: winRateVs',          MU('heroId: 1, take: 2', 'heroId winRateVs winRateWith')],
  ['matchUp: vs/with Unterobjekt', MU('heroId: 1, take: 2', 'heroId vs { heroId1 heroId2 matchCount winCount } with { heroId1 heroId2 matchCount winCount }')],
  ['matchUp: nur Zähler (Basis)',  MU('heroId: 1, take: 3', 'heroId matchCountVs matchCountWith')],
  // Matchup: Argumente
  ['matchUp: Rang (bracketBasicIds)', MU('heroId: 1, take: 2, bracketBasicIds: [DIVINE_IMMORTAL]', 'heroId matchCountVs matchCountWith')],
  ['matchUp: Rang Unsinn',            MU('heroId: 1, take: 2, bracketBasicIds: [ZZZ]', 'heroId')],
  ['matchUp: take 500',               MU('heroId: 1, take: 500', 'heroId')],
  ['matchUp: Position',               MU('heroId: 1, take: 2, positionIds: [POSITION_1]', 'heroId matchCountVs')],
  ['matchUp: Woche/Zeitraum',         MU('heroId: 1, take: 2, week: 1790812800', 'heroId')],
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
