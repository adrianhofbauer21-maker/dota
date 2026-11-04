/** STRATZ-GraphQL über den Vite-Proxy (/stratz). Der Token wird serverseitig vom Dev-Server angehängt. */
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function once<T>(query: string): Promise<T> {
  const res = await fetch('/stratz/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json: { data?: T; errors?: { message: string }[] } | null = null;
  try { json = JSON.parse(text); } catch { /* kein JSON */ }
  if (json?.errors?.length) throw new Error(`STRATZ: ${json.errors[0].message}`);
  if (!res.ok || !json?.data) {
    const msg403 = 'STRATZ HTTP 403 – Abruflimit erreicht (STRATZ erlaubt pro Token nur 2 IP-Adressen in 15 Minuten). Bitte etwa 15 Minuten warten und die Seite neu laden. Falls es dauerhaft bleibt: Token prüfen.';
    const hint = res.status === 401 ? ' – Token fehlt oder ist ungültig (Vercel: STRATZ_TOKEN, lokal: .env.local)' : '';
    throw new Error(res.status === 403 ? msg403 : `STRATZ HTTP ${res.status}${hint}`);
  }
  return json.data;
}

/** STRATZ antwortet gelegentlich zufällig mit 5xx oder "Error trying to resolve": kurz warten und wiederholen. */
export async function stratzQuery<T>(query: string, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(query);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /HTTP 5\d\d|Error trying to resolve|Failed to fetch/.test(msg);
      if (!transient || attempt >= retries) throw e;
      await sleep(1200 * (attempt + 1));
    }
  }
}
