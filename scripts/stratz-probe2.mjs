// Zweite Prüfrunde: Rang-Werte, Patch-Filter, Matchup-/Synergie-Felder.
// Aufruf:  node scripts/stratz-probe2.mjs
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

const W = '{ heroStats { winWeek(take: 1, ARGS) { heroId matchCount winCount } } }';
const w = args => W.replace('ARGS', args);
const M = '{ heroStats { matchUp(heroId: 1, ARGS) { FIELDS } } }';
const m = (args, fields) => M.replace('ARGS', args).replace('FIELDS', fields);

const T = [
  // --- Rang-Werte
  ['Rang: DIVINE',                  w('bracketIds: [DIVINE]')],
  ['Rang: IMMORTAL',                w('bracketIds: [IMMORTAL]')],
  ['Rang: DIVINE + IMMORTAL',       w('bracketIds: [DIVINE, IMMORTAL]')],
  ['Rang: LEGEND_ANCIENT',          w('bracketIds: [LEGEND_ANCIENT]')],
  ['Rang: Fehlerliste (Unsinn)',    w('bracketIds: [ZZZ]')],
  // --- Patch / weitere Filter
  ['Patch: gameVersionIds',         w('gameVersionIds: [190]')],
  ['Patch: gameVersionId',          w('gameVersionId: 190')],
  ['Filter: heroIds',               w('heroIds: [1]')],
  ['Filter: Rang + Position',       w('bracketIds: [DIVINE, IMMORTAL], positionIds: [POSITION_1]')],
  // --- Zeitfelder: Rückgabe von winWeek
  ['winWeek: week/heroId',          '{ heroStats { winWeek(take: 1, heroIds: [1]) { heroId week matchCount winCount } } }'],
  ['winWeek: Anzahl bei take 3',    '{ heroStats { winWeek(take: 3, heroIds: [1]) { heroId week matchCount winCount } } }'],
  // --- Gibt es weitere Statistik-Felder?
  ['Feld winDay',                   '{ heroStats { winDay(take: 1) { heroId } } }'],
  ['Feld winMonth',                 '{ heroStats { winMonth(take: 1) { heroId } } }'],
  ['Feld winGameVersion',           '{ heroStats { winGameVersion(take: 1) { heroId } } }'],
  ['Feld stats',                    '{ heroStats { stats { heroId } } }'],
  // --- Matchup / Synergie
  ['matchUp: Felder raten',         m('take: 1', 'heroId heroId1 heroId2 matchCountVs matchCountWith winCountVs winCountWith synergy')],
  ['matchUp: nur Zählfelder',       m('take: 2', 'matchCountVs matchCountWith winCountVs winCountWith')],
  ['matchUp: mit Rang',             m('take: 1, bracketIds: [DIVINE, IMMORTAL]', 'matchCountVs matchCountWith')],
  ['matchUp: mit Patch',            m('take: 1, gameVersionIds: [190]', 'matchCountVs matchCountWith')],
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
