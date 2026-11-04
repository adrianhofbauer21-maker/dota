// Vercel-Funktion: leitet die STRATZ-Abfragen der App weiter und hängt den geheimen Token serverseitig an.
// Der Token steht NUR in den Vercel-Einstellungen (Environment Variable STRATZ_TOKEN), nie im Browser-Code oder im Repository.
// Kleiner Zwischenspeicher (pro Serverinstanz, 10 Minuten): gleiche Abfragen gehen nicht mehrfach an STRATZ (schont das Limit von 2 IP-Adressen / 15 min).
const CACHE = new Map();
const TTL = 10 * 60 * 1000;

export default async function handler(req, res) {
  const token = (process.env.STRATZ_TOKEN ?? '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '');
  // Diagnose: https://DEINE-ADRESSE/api/stratz im Browser öffnen. Zeigt, ob ein Token ankommt und was STRATZ antwortet (nie den Token selbst).
  if (req.method === 'GET' && typeof req.query?.q === 'string' && req.query.q) {
    // Zwischenspeicherbare Abfrage (GET): Vercels CDN merkt sich die Antwort für alle Nutzer – so gehen gleiche Abfragen nur einmal an STRATZ.
    if (!token) { res.status(500).json({ error: 'STRATZ_TOKEN fehlt in den Vercel-Einstellungen.' }); return; }
    const query = req.query.q;
    if (query.length > 12000) { res.status(413).json({ error: 'Anfrage zu groß' }); return; }
    try {
      const upstream = await fetch('https://api.stratz.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      const text = await upstream.text();
      const good = upstream.status === 200 && !text.includes('"errors"');
      res.setHeader('Cache-Control', good ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'no-store');
      res.status(upstream.status).setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json').send(text);
    } catch (e) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ error: `STRATZ nicht erreichbar: ${e instanceof Error ? e.message : String(e)}` });
    }
    return;
  }
  if (req.method === 'GET') {
    const info = { tokenGesetzt: token.length > 0, tokenLaenge: token.length };
    if (token) {
      try {
        const r = await fetch('https://api.stratz.com/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: '{ constants { gameVersions { id } } }' }),
        });
        info.stratzStatus = r.status;
        info.stratzAntwort = (await r.text()).slice(0, 300);
      } catch (e) {
        info.fehler = e instanceof Error ? e.message : String(e);
      }
    }
    res.status(200).json(info);
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur GET/POST erlaubt' });
    return;
  }
  if (!token) {
    res.status(500).json({ error: 'STRATZ_TOKEN fehlt in den Vercel-Einstellungen (Settings → Environment Variables).' });
    return;
  }
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  if (body.length > 20000) {
    res.status(413).json({ error: 'Anfrage zu groß' });
    return;
  }
  const hit = CACHE.get(body);
  if (hit && Date.now() - hit.t < TTL) {
    res.status(200).setHeader('Content-Type', 'application/json').setHeader('X-Cache', 'HIT').send(hit.text);
    return;
  }
  try {
    const upstream = await fetch('https://api.stratz.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
      body,
    });
    const text = await upstream.text();
    if (upstream.status === 200 && !text.includes('"errors"')) {
      if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(body, { t: Date.now(), text });
    }
    res.status(upstream.status).setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: `STRATZ nicht erreichbar: ${e instanceof Error ? e.message : String(e)}` });
  }
}
