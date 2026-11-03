// Vierte Prüfrunde: MMR-Filter.
// Aufruf:  node scripts/stratz-probe4.mjs
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
  ['winWeek: minMmr: 6000', '{ heroStats { winWeek(take: 1, heroIds: [1], minMmr: 6000) { heroId matchCount } } }'],
  ['winWeek: mmr: 6000', '{ heroStats { winWeek(take: 1, heroIds: [1], mmr: 6000) { heroId matchCount } } }'],
  ['winWeek: minRank: 80', '{ heroStats { winWeek(take: 1, heroIds: [1], minRank: 80) { heroId matchCount } } }'],
  ['winWeek: rankMin: 80', '{ heroStats { winWeek(take: 1, heroIds: [1], rankMin: 80) { heroId matchCount } } }'],
  ['winWeek: minimumRank: 80', '{ heroStats { winWeek(take: 1, heroIds: [1], minimumRank: 80) { heroId matchCount } } }'],
  ['winWeek: rank: 80', '{ heroStats { winWeek(take: 1, heroIds: [1], rank: 80) { heroId matchCount } } }'],
  ['winWeek: rankIds: [80]', '{ heroStats { winWeek(take: 1, heroIds: [1], rankIds: [80]) { heroId matchCount } } }'],
  ['winWeek: mmrMin: 6000', '{ heroStats { winWeek(take: 1, heroIds: [1], mmrMin: 6000) { heroId matchCount } } }'],
  ['winWeek: minMmrRank: 6000', '{ heroStats { winWeek(take: 1, heroIds: [1], minMmrRank: 6000) { heroId matchCount } } }'],
  ['winWeek: maxRank: 80', '{ heroStats { winWeek(take: 1, heroIds: [1], maxRank: 80) { heroId matchCount } } }'],
  ['winWeek: leaderboard: true', '{ heroStats { winWeek(take: 1, heroIds: [1], leaderboard: true) { heroId matchCount } } }'],
  ['winWeek: ranks: [80]', '{ heroStats { winWeek(take: 1, heroIds: [1], ranks: [80]) { heroId matchCount } } }'],
  ['matchUp: minMmr: 6000', '{ heroStats { matchUp(heroId: 1, take: 1, minMmr: 6000) { heroId } } }'],
  ['matchUp: rankMin: 80', '{ heroStats { matchUp(heroId: 1, take: 1, rankMin: 80) { heroId } } }'],
  ['matchUp: bracketIds: [IMMORTAL], minMmr: 6000', '{ heroStats { matchUp(heroId: 1, take: 1, bracketIds: [IMMORTAL], minMmr: 6000) { heroId } } }'],
  ['winWeek: Argumentliste (Unsinn)', '{ heroStats { winWeek(take: 1, qqq: 1) { heroId } } }'],
  ['Typ HeroStatsQuery (Unsinn)', '{ heroStats { qqq } }'],
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
