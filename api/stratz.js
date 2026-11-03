// Vercel-Funktion: leitet die STRATZ-Abfragen der App weiter und hängt den geheimen Token serverseitig an.
// Der Token steht NUR in den Vercel-Einstellungen (Environment Variable STRATZ_TOKEN), nie im Browser-Code oder im Repository.
export default async function handler(req, res) {
  const token = (process.env.STRATZ_TOKEN ?? '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '');
  // Diagnose: https://DEINE-ADRESSE/api/stratz im Browser öffnen. Zeigt, ob ein Token ankommt und was STRATZ antwortet (nie den Token selbst).
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
  try {
    const upstream = await fetch('https://api.stratz.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', Authorization: `Bearer ${token}` },
      body,
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: `STRATZ nicht erreichbar: ${e instanceof Error ? e.message : String(e)}` });
  }
}
