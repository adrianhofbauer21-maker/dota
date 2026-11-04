import { useEffect, useMemo, useState } from 'react';
import './App.css';
import TeamPanel from './TeamPanel';
import RecommendPanel from './RecommendPanel';
import MetaPanel from './MetaPanel';
import ScoutPanel from './ScoutPanel';
import { useTeamData } from './teamData';
import { normHeroName } from './dotabuffImport';
import { useRelations } from './matchups';
import { DEFAULT_WEIGHTS, type Weights } from './recommend';
import { BRACKET_OPTIONS, buildMeta, useHeroStats, useStratzMeta, type BracketKey, type MetaByPos } from './meta';

type Side = 'Radiant' | 'Dire';
type Action = 'ban' | 'pick';
type Step = { team: 'first' | 'second'; action: Action; phase: number };
type Entry = Step & { hero: string; side: Side };

// Patchabhängige Reihenfolge: vor Scrim-Einsatz mit dem aktuellen Client abgleichen.
const ORDER: Step[] = [
  ...(['first','first','second','second','first','second','second'] as const).map(team => ({team, action:'ban' as const, phase:1})),
  ...(['first','second'] as const).map(team => ({team, action:'pick' as const, phase:1})),
  ...(['first','first','second'] as const).map(team => ({team, action:'ban' as const, phase:2})),
  ...(['second','first','first','second','second','first'] as const).map(team => ({team, action:'pick' as const, phase:2})),
  ...(['first','second','first','second'] as const).map(team => ({team, action:'ban' as const, phase:3})),
  ...(['first','second'] as const).map(team => ({team, action:'pick' as const, phase:3})),
];

const HEROES = [
  'Abaddon','Alchemist','Ancient Apparition','Anti-Mage','Arc Warden','Axe','Bane','Batrider','Beastmaster','Bloodseeker',
  'Bounty Hunter','Brewmaster','Bristleback','Broodmother','Centaur Warrunner','Chaos Knight','Chen','Clinkz','Clockwerk','Crystal Maiden',
  'Dark Seer','Dark Willow','Dawnbreaker','Dazzle','Death Prophet','Disruptor','Doom','Dragon Knight','Drow Ranger','Earth Spirit',
  'Earthshaker','Elder Titan','Ember Spirit','Enchantress','Enigma','Faceless Void','Grimstroke','Gyrocopter','Hoodwink','Huskar',
  'Invoker','Io','Jakiro','Juggernaut','Keeper of the Light','Kez','Kunkka','Largo','Legion Commander','Leshrac','Lich','Lifestealer',
  'Lina','Lion','Lone Druid','Luna','Lycan','Magnus','Marci','Mars','Medusa','Meepo','Mirana','Monkey King',
  'Morphling','Muerta','Naga Siren','Nature’s Prophet','Necrophos','Night Stalker','Nyx Assassin','Ogre Magi','Omniknight','Oracle',
  'Outworld Destroyer','Pangolier','Phantom Assassin','Phantom Lancer','Phoenix','Primal Beast','Puck','Pudge','Pugna','Queen of Pain',
  'Razor','Riki','Ringmaster','Rubick','Sand King','Shadow Demon','Shadow Fiend','Shadow Shaman','Silencer','Skywrath Mage',
  'Slardar','Slark','Snapfire','Sniper','Spectre','Spirit Breaker','Storm Spirit','Sven','Techies','Templar Assassin',
  'Terrorblade','Tidehunter','Timbersaw','Tinker','Tiny','Treant Protector','Troll Warlord','Tusk','Underlord','Undying',
  'Ursa','Vengeful Spirit','Venomancer','Viper','Visage','Void Spirit','Warlock','Weaver','Windranger','Winter Wyvern',
  'Witch Doctor','Wraith King','Zeus',
].sort((a, b) => a.localeCompare(b));

const IMAGE_SLUGS: Record<string,string> = {
  'Anti-Mage':'antimage','Centaur Warrunner':'centaur','Clockwerk':'rattletrap',
  'Doom':'doom_bringer','Magnus':'magnataur','Io':'wisp','Lifestealer':'life_stealer',
  'Nature’s Prophet':'furion','Necrophos':'necrolyte','Outworld Destroyer':'obsidian_destroyer',
  'Queen of Pain':'queenofpain','Shadow Fiend':'nevermore','Timbersaw':'shredder',
  'Treant Protector':'treant','Vengeful Spirit':'vengefulspirit','Windranger':'windrunner',
  'Wraith King':'skeleton_king','Zeus':'zuus','Underlord':'abyssal_underlord',
  'Primal Beast':'primal_beast','Ringmaster':'ringmaster',
};
function portrait(hero: string) {
  const slug = IMAGE_SLUGS[hero] ?? hero.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,'_');
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${slug}.png`;
}
const normName = (n: string) => n.toLowerCase().replace(/[’'`]/g, '').replace(/\s+/g, ' ').trim();
const CANON = new Map(HEROES.map(h => [normName(h), h]));
const canonHero = (n: string) => CANON.get(normName(n));
function sideOf(step: Step, first: Side): Side {
  return step.team === 'first' ? first : first === 'Radiant' ? 'Dire' : 'Radiant';
}
// Gruppiert die Aktionen zu Zeilen des Draft-Baums: gleiche Aktion, hoechstens ein
// Slot pro Team. Zwei aufeinanderfolgende Aktionen verschiedener Teams teilen sich
// eine Zeile (z. B. "2 3", "8 9"), mehrere Aktionen desselben Teams stehen untereinander.
const ROWS: number[][] = (() => {
  const rows: number[][] = [];
  ORDER.forEach((step, i) => {
    const last = rows.at(-1);
    const fits = last && ORDER[last[0]].action === step.action && !last.some(j => ORDER[j].team === step.team);
    if (last && fits) last.push(i); else rows.push([i]);
  });
  return rows;
})();
const ATTR: Record<string, string[]> = {
  STRENGTH: ['Alchemist','Axe','Bristleback','Centaur Warrunner','Chaos Knight','Dawnbreaker','Doom','Dragon Knight','Earthshaker','Elder Titan','Huskar','Kunkka','Largo','Legion Commander','Lifestealer','Lycan','Magnus','Mars','Night Stalker','Ogre Magi','Omniknight','Primal Beast','Pudge','Slardar','Spirit Breaker','Sven','Tidehunter','Timbersaw','Tiny','Treant Protector','Tusk','Underlord','Undying','Wraith King'],
  AGILITY: ['Anti-Mage','Arc Warden','Bloodseeker','Bounty Hunter','Broodmother','Clinkz','Drow Ranger','Ember Spirit','Faceless Void','Gyrocopter','Juggernaut','Kez','Lone Druid','Luna','Medusa','Meepo','Monkey King','Morphling','Naga Siren','Nyx Assassin','Pangolier','Phantom Assassin','Phantom Lancer','Razor','Riki','Shadow Fiend','Slark','Sniper','Spectre','Templar Assassin','Terrorblade','Troll Warlord','Ursa','Viper','Weaver'],
  INTELLIGENCE: ['Ancient Apparition','Bane','Chen','Crystal Maiden','Dark Seer','Dark Willow','Dazzle','Death Prophet','Disruptor','Enchantress','Grimstroke','Invoker','Jakiro','Keeper of the Light','Leshrac','Lich','Lina','Lion','Muerta','Necrophos','Oracle','Outworld Destroyer','Puck','Pugna','Queen of Pain','Rubick','Shadow Demon','Shadow Shaman','Silencer','Skywrath Mage','Storm Spirit','Tinker','Warlock','Witch Doctor','Zeus'],
};
const GROUP_TITLES = ['STRENGTH', 'AGILITY', 'INTELLIGENCE', 'UNIVERSAL'] as const;
const ATTR_TITLE: Record<string, string> = { str: 'STRENGTH', agi: 'AGILITY', int: 'INTELLIGENCE', all: 'UNIVERSAL' };
// Rückfall, falls OpenDota (noch) nichts zu einem Helden liefert: die statische Liste oben.
function staticAttr(hero: string): string {
  for (const [title, names] of Object.entries(ATTR)) if (names.includes(hero)) return title;
  return 'UNIVERSAL';
}

export default function App() {
  const [ourSide,setOurSide] = useState<Side>('Radiant');
  const [firstPick,setFirstPick] = useState<Side>('Radiant');
  const [entries,setEntries] = useState<Entry[]>([]);
  const [search,setSearch] = useState('');
  const [showUsed,setShowUsed] = useState(true);
  const { raw: heroRaw, error: heroStatsError } = useHeroStats();
  const nameToHeroId = useMemo(() => new Map(heroRaw.map(h => [normHeroName(h.localized_name), h.id] as const)), [heroRaw]);
  const teamData = useTeamData(nameToHeroId);
  const [bracket,setBracket] = useState<BracketKey>('immortal');
  const [weights,setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const heroNames = useMemo(() => Object.fromEntries(heroRaw.map(h => [h.id, h.localized_name])) as Record<number,string>, [heroRaw]);
  const [days,setDays] = useState(0); // 0 = seit aktuellem Patch
  const stratzMeta = useStratzMeta(bracket, days);
  const odMeta = useMemo(() => buildMeta(heroRaw, BRACKET_OPTIONS[bracket].brackets), [heroRaw, bracket]);
  // STRATZ: Meta je Position. Ersatz bei Fehler: OpenDota-Meta (ohne Position/Zeitraum) für alle Positionen.
  const metaByPos: MetaByPos = useMemo(
    () => stratzMeta.meta ?? new Map([1,2,3,4,5].map(p => [p, odMeta] as const)),
    [stratzMeta.meta, odMeta]);
  const latestTxt = stratzMeta.latest ? new Date(stratzMeta.latest * 1000).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' }) : '';
  const metaSource = stratzMeta.meta ? `STRATZ · je Position${latestTxt ? ` · Daten bis ${latestTxt}` : ''}${stratzMeta.source === 'week' ? ' (Wochenwerte, evtl. veraltet)' : ''}` : 'OpenDota (Ersatz, ohne Position/Zeitraum)';
  // Attribut-Gruppen: OpenDota-Daten haben Vorrang vor der statischen Liste.
  const groups = useMemo(() => {
    const byName = new Map<string,string>();
    for (const h of heroRaw) { const n = canonHero(h.localized_name); if (n) byName.set(n, ATTR_TITLE[h.primary_attr] ?? 'UNIVERSAL'); }
    return GROUP_TITLES.map(title => ({ title, heroes: HEROES.filter(h => (byName.get(h) ?? staticAttr(h)) === title) }));
  }, [heroRaw]);
  const current = ORDER[entries.length];
  const turnSide = current ? sideOf(current,firstPick) : null;
  const used = useMemo(() => new Set(entries.map(e => e.hero)),[entries]);
  // Legale Kandidaten für Empfehlungen: in der App-Liste vorhanden und noch nicht gepickt/gebannt.
  const candidates = useMemo(() => heroRaw.filter(h => { const n = canonHero(h.localized_name); return n !== undefined && !used.has(n); }).map(h => h.id), [heroRaw, used]);
  const rolesById = useMemo(() => new Map(heroRaw.map(h => [h.id, h.roles ?? []] as const)), [heroRaw]);
  const idByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of heroRaw) { const n = canonHero(h.localized_name); if (n) m.set(n, h.id); }
    return m;
  }, [heroRaw]);
  const pickIds = (side: Side) => entries.filter(e => e.action === 'pick' && e.side === side).map(e => idByName.get(e.hero)).filter((id): id is number => id !== undefined);
  const unavailableIds = useMemo(() => new Set(entries.map(e => idByName.get(e.hero)).filter((id): id is number => id !== undefined)), [entries, idByName]);
  const allyIds = pickIds(ourSide);
  const enemyIds = pickIds(ourSide === 'Radiant' ? 'Dire' : 'Radiant');
  const relations = useRelations(allyIds, enemyIds, bracket);
  // Zuordnung gedrafteter Helden zu Spielern: Hero-ID -> interne Spieler-ID (eigenes Team p1…, Gegner e…).
  const [assign, setAssign] = useState<Record<number, string>>({});
  const pickedKey = [...allyIds, ...enemyIds].sort((a, b) => a - b).join(',');
  useEffect(() => {
    const picked = new Set(pickedKey ? pickedKey.split(',').map(Number) : []);
    setAssign(prev => {
      const keep = Object.entries(prev).filter(([h]) => picked.has(Number(h)));
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
    });
  }, [pickedKey]);
  function assignHero(heroId: number, playerId: string | null) {
    setAssign(prev => {
      const next = { ...prev };
      if (playerId) {
        for (const [h, pid] of Object.entries(next)) if (pid === playerId) delete next[Number(h)]; // ein Held je Spieler
        next[heroId] = playerId;
      } else delete next[heroId];
      return next;
    });
  }
  function choose(hero: string, playerId?: string) {
    if (!current || !turnSide || used.has(hero)) return;
    setEntries(prev => [...prev,{...current,side:turnSide,hero}]);
    const id = idByName.get(hero);
    if (playerId && current.action === 'pick' && id !== undefined) assignHero(id, playerId);
  }
  function reset() {
    if (!entries.length || window.confirm('Draft zurücksetzen?')) setEntries([]);
  }
  function changeFirst(side: Side) { setFirstPick(side); setEntries([]); }

  const steps = ORDER.map((step,index) => ({ ...step, index, side:sideOf(step,firstPick) }));
  const selected = entries.at(-1);
  function slot(index: number) {
    const step = steps[index];
    const entry = entries[index];
    const active = Boolean(current && index === entries.length);
    // Kommende Slots werden mit zunehmendem Abstand blasser.
    const opacity = entry || active ? 1 : Math.max(0.3, 1 - (index - entries.length) * 0.1);
    return <div className={`dt-slot ${step.action} ${entry ? 'filled' : ''} ${active ? 'active' : ''}`}
                style={{ opacity }} title={`${index+1}. ${step.side} ${step.action}`}>
      {entry && <img src={portrait(entry.hero)} alt={entry.hero} />}
      {active && <span className="dt-current">{step.action === 'pick' ? 'PICK' : 'BAN'}</span>}
    </div>;
  }
  return <main className="cm-app">
    <header className="cm-header">
      <div className="cm-reserve radiant"><strong>RADIANT</strong><span>CAPTAINS MODE</span></div>
      <div className="cm-center"><div className="cm-clock">{String(entries.length).padStart(2,'0')} <small>/ 24</small></div><h1>{current ? `${turnSide?.toUpperCase()} — ${current.action === 'ban' ? 'BAN' : 'PICK'}` : 'DRAFT COMPLETE'}</h1><p>{current ? `Phase ${current.phase} · ${turnSide === ourSide ? 'Dein Team' : 'Gegner'}` : 'Alle Aktionen abgeschlossen'}</p></div>
      <div className="cm-reserve dire"><strong>DIRE</strong><span>CAPTAINS MODE</span></div>
    </header>
    <div className="cm-toolbar">
      <label>Unser Team <select value={ourSide} onChange={e=>setOurSide(e.target.value as Side)}><option>Radiant</option><option>Dire</option></select></label>
      <label>First Pick <select value={firstPick} onChange={e=>changeFirst(e.target.value as Side)}><option>Radiant</option><option>Dire</option></select></label>
      <button onClick={()=>setEntries(prev=>prev.slice(0,-1))} disabled={!entries.length}>↶ Undo</button>
      <button onClick={reset}>↻ Reset</button>
      <span>LOCAL DRAFT · v1.19</span>
    </div>
    <div className="cm-layout">
      <section className="cm-heroes">
        <div className="cm-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search heroes..." /><label><input type="checkbox" checked={showUsed} onChange={e=>setShowUsed(e.target.checked)}/> Show used</label></div>
        <div className="cm-tags"><span>⚔ CARRY</span><span>♡ SUPPORT</span><span>ϟ NUKER</span><span>▣ PUSHER</span><span>⬡ DURABLE</span><span>↗ INITIATOR</span></div>
        <div className="cm-attributes">{groups.map((group,i)=>{
          const filtered = group.heroes.filter(h=>h.toLowerCase().includes(search.toLowerCase().trim()) && (showUsed || !used.has(h)));
          return <div className={`cm-attribute attr-${i}`} key={group.title}>
            <div className="cm-attr-title">{['🔴','🟢','🔵','🟡'][i]} {group.title} <small>{group.heroes.length}</small></div>
            <div className="cm-hero-grid">{filtered.map(hero=><button key={hero} className={`cm-hero ${used.has(hero)?'used':''}`} disabled={used.has(hero)||!current} title={hero} onClick={()=>choose(hero)}><img src={portrait(hero)} alt={hero} loading="lazy" />{used.has(hero)&&<span>×</span>}</button>)}</div>
          </div>;
        })}</div>
      </section>
      <aside className="cm-right">
        <div className="cm-intel"><span>◉ Draft tree</span><span>INTEL · soon</span></div>
        <div className="dt">
          <div className="dt-head"><strong className="radiant">RADIANT</strong><strong className="dire">DIRE</strong></div>
          <div className="dt-rows" aria-label="Captains Mode Draft-Baum">
            {ROWS.map(row => {
              const radiant = row.find(i => steps[i].side === 'Radiant');
              const dire = row.find(i => steps[i].side === 'Dire');
              return <div key={row[0]} className={`dt-row ${steps[row[0]].action}`}>
                <div className="dt-side radiant">{radiant !== undefined && slot(radiant)}</div>
                <div className="dt-axis">
                  {row.map(i => <span key={i} className={`dt-num ${steps[i].side.toLowerCase()} ${entries.length === i ? 'current' : ''}`}>{i + 1}</span>)}
                </div>
                <div className="dt-side dire">{dire !== undefined && slot(dire)}</div>
              </div>;
            })}
          </div>
        </div>
        <div className="cm-preview">{selected ? <><img src={portrait(selected.hero)} alt=""/><div><small>{selected.action.toUpperCase()} · {selected.side}</small><strong>{selected.hero}</strong></div></> : <div className="cm-preview-empty"><small>NEXT ACTION</small><strong>{current ? `${turnSide} ${current.action.toUpperCase()}` : 'Draft complete'}</strong></div>}</div>
      </aside>
    </div>
    {heroStatsError && <div className="tp-error">OpenDota-Heldenstatistik: {heroStatsError}</div>}
    <RecommendPanel teamData={teamData} metaByPos={metaByPos} metaSource={metaSource} metaLoading={stratzMeta.loading} days={days} onDays={setDays} synergy={relations.synergy} candidates={candidates} allyIds={allyIds} enemyIds={enemyIds}
      matchups={relations.matchups} matchupsLoading={relations.loading} matchupsError={relations.error} rolesById={rolesById}
      heroNames={heroNames} canon={canonHero} portrait={portrait}
      bracket={bracket} onBracket={setBracket} weights={weights} onWeights={setWeights}
      headline={current ? `${turnSide} · ${current.action === 'ban' ? 'BAN' : 'PICK'} · ${turnSide === ourSide ? 'Dein Team' : 'Gegner'}` : 'Draft komplett'}
      canPick={Boolean(current && current.action === 'pick' && turnSide === ourSide)} onPick={choose} canBan={Boolean(current && current.action === 'ban' && turnSide === ourSide)} onBan={choose} assign={assign} onAssign={assignHero} metaReady={(metaByPos.get(1)?.size ?? 0) > 0} positional={Boolean(stratzMeta.meta)} metaError={stratzMeta.error ? `${stratzMeta.error} – Ersatz: OpenDota-Meta` : ''} />
    <MetaPanel metaByPos={metaByPos} heroNames={heroNames} canon={canonHero} portrait={portrait} source={metaSource} positional={Boolean(stratzMeta.meta)} />
    <TeamPanel teamData={teamData} heroNames={heroNames} canon={canonHero} portrait={portrait} />
    <TeamPanel side="enemy" unavailable={unavailableIds} teamData={teamData} heroNames={heroNames} canon={canonHero} portrait={portrait} />
    <ScoutPanel teamData={teamData} heroNames={heroNames} />
    <footer className="cm-footer">Draft-Reihenfolge ist konfigurierbar und muss vor echten Scrims gegen den aktuellen Client geprüft werden. Hero-Attribute sind vorläufig zugeordnet. Keine Live-Timer in dieser Version.</footer>
  </main>;
}
