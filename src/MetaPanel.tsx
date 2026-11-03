import { useState } from 'react';
import type { MetaByPos } from './meta';
import { ROLE_LABEL } from './team';

type Props = {
  metaByPos: MetaByPos;
  heroNames: Record<number, string>;
  canon: (openDotaName: string) => string | undefined;
  portrait: (hero: string) => string;
  source: string;
  positional: boolean;
};

const MIN_OPTIONS = [0, 50, 100, 300, 1000];

/** Rohe Meta-Zahlen je Position: Spiele, Pickrate und Winrate – zum Vergleich mit anderen Seiten. */
export default function MetaPanel({ metaByPos, heroNames, canon, portrait, source, positional }: Props) {
  const [pos, setPos] = useState(5);
  const [sort, setSort] = useState<'score' | 'games' | 'winrate'>('score');
  const [minGames, setMinGames] = useState(100);
  const m = metaByPos.get(pos);
  const all = [...(m?.values() ?? [])];
  const total = all.reduce((s, e) => s + e.games, 0);
  const rows = all
    .filter(e => e.games >= minGames)
    .sort((a, b) => sort === 'games' ? b.games - a.games : sort === 'winrate' ? b.winrate - a.winrate : (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 15);

  return <section className="mp">
    <div className="rp-head">
      <strong>META-TABELLE</strong>
      <span className="rp-sub">{source}{positional ? '' : ' · ohne Positionsdaten'}</span>
      <label>Position
        <select value={pos} onChange={e => setPos(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map(q => <option key={q} value={q}>{q} · {ROLE_LABEL[q as 1 | 2 | 3 | 4 | 5]}</option>)}
        </select>
      </label>
      <label>Sortieren nach
        <select value={sort} onChange={e => setSort(e.target.value as 'score' | 'games' | 'winrate')}>
          <option value="score">Meta-Score (normalisiert)</option>
          <option value="games">Spiele (Beliebtheit)</option>
          <option value="winrate">Winrate</option>
        </select>
      </label>
      <label>Min. Spiele
        <select value={minGames} onChange={e => setMinGames(Number(e.target.value))}>
          {MIN_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
    <table className="tp-table mp-table">
      <thead><tr><th>#</th><th>Held</th><th>Spiele</th><th title="Anteil an allen Spielen auf dieser Position">Anteil</th><th>Winrate</th><th title="Normalisiert innerhalb der Position: 70 % Winrate-Abstand (gedämpft bei wenigen Spielen), 30 % Beliebtheit">Score</th></tr></thead>
      <tbody>{rows.map((e, i) => {
        const raw = heroNames[e.heroId];
        const name = raw ? canon(raw) : undefined;
        return <tr key={e.heroId}>
          <td>{i + 1}</td>
          <td className="tp-hero">{name ? <img src={portrait(name)} alt="" /> : <span className="tp-noimg" />}{raw ?? `#${e.heroId}`}</td>
          <td>{e.games}</td>
          <td>{total > 0 ? `${((e.games / total) * 100).toFixed(1)}%` : '–'}</td>
          <td>{(e.winrate * 100).toFixed(1)}%</td>
          <td>{(e.score ?? 0).toFixed(0)}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className="tp-note">Rohe Winrate ohne Glättung. „Anteil" = Spiele des Helden an allen Hero-Spielen auf dieser Position. Score = normalisiert innerhalb der Position (70 % Winrate im Vergleich zu den anderen Helden (bei wenigen Spielen stark gedämpft), 30 % Beliebtheit); das ist der Wert, den die Empfehlungen als Meta verwenden. Wähle „Spiele" für die Beliebtheit, „Winrate" für die erfolgreichsten Helden (mit Mindestspielzahl, sonst dominieren seltene Helden).</p>
  </section>;
}
