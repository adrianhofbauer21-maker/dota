// Prüft den STRATZ-Zugang und listet die Felder der Heldenstatistik-Abfragen auf.
// Aufruf:  npm run stratz:probe
// Der Token wird aus .env.local gelesen (STRATZ_TOKEN=...) und NIE ausgegeben.
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
if (!token) {
  console.error('Kein STRATZ_TOKEN gefunden. Lege im Projektordner eine Datei .env.local an mit der Zeile:\nSTRATZ_TOKEN=dein_token');
  process.exit(1);
}

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

const typeStr = t => (t ? (t.name ?? `${t.kind}<${typeStr(t.ofType)}>`) : '?');
const TYPE_FRAGMENT = 'name kind ofType { name kind ofType { name kind ofType { name kind } } }';
const baseName = t => (t?.name ?? (t?.ofType ? baseName(t.ofType) : null));

async function fieldsOf(typeName) {
  const r = await gql(`{ __type(name: "${typeName}") { fields { name args { name type { ${TYPE_FRAGMENT} } } type { ${TYPE_FRAGMENT} } } } }`);
  return r.json?.data?.__type?.fields ?? null;
}

// 1) Zugang
const ping = await gql('{ __typename }');
console.log(`Verbindung: HTTP ${ping.status}`);
if (ping.status !== 200 || ping.json?.errors) {
  console.log('Antwort:', ping.text.slice(0, 400));
  console.log('\nZugang hat nicht geklappt. Prüfe Token (stratz.com/api) und ob er aktiviert ist.');
  process.exit(1);
}
console.log('Zugang OK.\n');

// Gezielte Test-Abfragen. Auch Fehlermeldungen sind nützlich: GraphQL nennt bei falschen Feldern oft die echten.
async function runTests() {
  const T = [
    ['heroStats vorhanden?',            '{ heroStats { __typename } }'],
    ['Feld-Vorschläge heroStats',       '{ heroStats { zzz } }'],
    ['Feld-Vorschläge constants',       '{ constants { zzz } }'],
    ['winWeek einfach',                 '{ heroStats { winWeek(take: 1) { heroId matchCount winCount } } }'],
    ['winWeek Argument-Vorschläge',     '{ heroStats { winWeek(zzz: 1) { heroId } } }'],
    ['winWeek Rückgabe-Vorschläge',     '{ heroStats { winWeek(take: 1) { zzz } } }'],
    ['winWeek mit Rang',                '{ heroStats { winWeek(take: 1, bracketIds: [DIVINE_IMMORTAL]) { heroId matchCount winCount } } }'],
    ['winWeek mit Position',            '{ heroStats { winWeek(take: 1, positionIds: [POSITION_2]) { heroId matchCount winCount } } }'],
    ['matchUp (Matchups/Synergie)',     '{ heroStats { matchUp(heroId: 1, take: 1) { heroId matchCount } } }'],
    ['matchUp Rückgabe-Vorschläge',     '{ heroStats { matchUp(heroId: 1, take: 1) { zzz } } }'],
    ['Patch-Liste',                     '{ constants { gameVersions { id name } } }'],
    ['Helden-Liste (Test)',             '{ constants { heroes { id displayName } } }'],
  ];
  for (const [label, query] of T) {
    const r = await gql(query);
    console.log(`### ${label}`);
    console.log(`    ${query}`);
    if (r.json?.errors?.length) {
      for (const e of r.json.errors.slice(0, 3)) console.log(`    FEHLER: ${String(e.message).slice(0, 350)}`);
    } else if (r.json?.data) {
      console.log(`    OK: ${JSON.stringify(r.json.data).slice(0, 350)}`);
    } else {
      console.log(`    HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    }
    console.log('');
  }
}

// 2) Einstieg über Query.heroStats
const q = await fieldsOf('Query');
const heroField = q?.find(f => f.name === 'heroStats');
if (!heroField) {
  console.log('Schema-Abfrage (Introspection) nicht möglich – das ist bei STRATZ normal. Es folgen gezielte Test-Abfragen.\n');
  await runTests();
  process.exit(0);
}
const heroType = baseName(heroField.type);
console.log(`Query.heroStats -> Typ ${heroType}\n`);

const fields = await fieldsOf(heroType);
for (const f of fields ?? []) {
  const args = f.args.map(a => `${a.name}: ${typeStr(a.type)}`).join(', ');
  console.log(`- ${f.name}(${args}) -> ${typeStr(f.type)}`);
}

// 3) Rückgabetypen der interessanten Felder
console.log('\n--- Rückgabetypen ---');
const seen = new Set();
for (const f of fields ?? []) {
  if (!/win|stats|match|patch|version|position|synerg|with|vs/i.test(f.name)) continue;
  const tn = baseName(f.type);
  if (!tn || seen.has(tn)) continue;
  seen.add(tn);
  const sub = await fieldsOf(tn);
  console.log(`${tn}: ${(sub ?? []).map(s => `${s.name}:${typeStr(s.type)}`).join(', ')}`);
}

// 4) Enum-Werte, die für Filter wichtig sind
console.log('\n--- Enums ---');
for (const e of ['RankBracketBasicEnum', 'RankBracket', 'MatchPlayerPositionType', 'MatchLaneType']) {
  const r = await gql(`{ __type(name: "${e}") { enumValues { name } } }`);
  const vals = r.json?.data?.__type?.enumValues;
  if (vals) console.log(`${e}: ${vals.map(v => v.name).join(', ')}`);
}
