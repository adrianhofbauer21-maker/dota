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
    const hint = res.status === 401 || res.status === 403 ? ' (Token prüfen: .env.local, Dev-Server neu starten)' : '';
    throw new Error(`STRATZ HTTP ${res.status}${hint}`);
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
