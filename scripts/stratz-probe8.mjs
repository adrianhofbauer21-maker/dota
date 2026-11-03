// Spielerprüfung: Spielerdaten bei STRATZ.
// Aufruf:  node scripts/stratz-probe8.mjs <Account-ID>
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
const HERO = Number(process.argv[3] ?? 105); // Standard: Techies
if (!/^\d+$/.test(ID ?? '')) { console.error('Aufruf: node scripts/stratz-probe8.mjs <Account-ID> [Helden-ID, Standard 105 = Techies]'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function q(query) {
  for (let i = 0; i < 4; i++) {
    const r = await gql(query);
    if (r.json?.data && !r.json.errors) return r.json.data;
    if (i < 3 && (r.status >= 500 || /resolve/.test(JSON.stringify(r.json?.errors ?? '')))) { await sleep(1500 * (i + 1)); continue; }
    throw new Error(JSON.stringify(r.json?.errors ?? r.text).slice(0, 300));
  }
}
const info = (await q(`{ player(steamAccountId: ${ID}) { steamAccount { name } matchCount winCount } }`)).player;
console.log(`Spieler: ${info.steamAccount?.name} | Spiele gesamt laut STRATZ: ${info.matchCount} | Siege: ${info.winCount}`);
await sleep(300);
const perf = (await q(`{ player(steamAccountId: ${ID}) { heroesPerformance(take: 200, request: { take: ${info.matchCount + 100} }) { heroId matchCount winCount } } }`)).player.heroesPerformance;
perf.sort((a, b) => b.matchCount - a.matchCount);
console.log('Meistgespielte Helden (Helden-ID: Spiele/Siege):', perf.slice(0, 10).map(h => `${h.heroId}: ${h.matchCount}/${h.winCount}`).join(' | '));
const t = perf.find(h => h.heroId === HERO);
console.log(`Held ${HERO} gesamt: ${t ? `${t.matchCount} Spiele, ${t.winCount} Siege` : 'keine Spiele'}`);
const recent = [];
for (let skip = 0; skip < 200; skip += 100) {
  await sleep(300);
  const d = await q(`{ player(steamAccountId: ${ID}) { matches(request: { take: 100, skip: ${skip} }) { startDateTime players(steamAccountId: ${ID}) { heroId isVictory position } } } }`);
  for (const m of d.player.matches) if (m.players[0]) recent.push({ t: m.startDateTime, ...m.players[0] });
}
const fmt = t => new Date(t * 1000).toISOString().slice(0, 10);
console.log(`Letzte ${recent.length} Spiele: ${fmt(recent[recent.length - 1].t)} bis ${fmt(recent[0].t)}`);
const mine = recent.filter(m => m.heroId === HERO);
console.log(`Held ${HERO} in diesen Spielen: ${mine.length}, Siege ${mine.filter(m => m.isVictory).length}`);
for (const m of mine.slice(0, 8)) console.log(`   ${fmt(m.t)} ${m.isVictory ? 'Sieg' : 'Niederlage'} ${m.position ?? '-'}`);
const pos = {}; for (const m of recent) pos[m.position ?? '-'] = (pos[m.position ?? '-'] ?? 0) + 1;
console.log('Positionen der letzten Spiele:', JSON.stringify(pos));
