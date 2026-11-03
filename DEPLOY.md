# App kostenlos online stellen (Vercel)

Ergebnis: eine feste Adresse wie `https://dein-projekt.vercel.app`, die jeder im Team im Browser öffnen kann – ohne dass dein PC läuft.

## Einmalig einrichten

1. **GitHub-Konto** (kostenlos): https://github.com
2. Neues **privates** Repository anlegen (z. B. `dota-draft-assistant`) und den Inhalt dieses Ordners hochladen
   (Button „Add file → Upload files“). **Nicht** hochladen: `node_modules`, `.env.local`, `dist` (sind in der ZIP nicht enthalten).
3. **Vercel-Konto** (kostenlos, „Continue with GitHub“): https://vercel.com
4. „Add New → Project“, das Repository wählen, „Import“. Framework wird als **Vite** erkannt, Einstellungen so lassen.
5. Vor dem Deploy bei **Environment Variables** eintragen:
   - Name: `STRATZ_TOKEN`
   - Wert: dein STRATZ-Token (https://stratz.com/api)
6. „Deploy“ drücken. Nach ca. 1 Minute ist die Seite online.

Der Token steht nur in Vercel, nicht im Code und nicht im Browser. Die Datei `api/stratz.js` reicht die Anfragen an STRATZ weiter.

## Danach

- **Änderungen einspielen:** geänderte Dateien im GitHub-Repository ersetzen; Vercel baut automatisch neu.
- **Token wechseln:** Vercel → Project → Settings → Environment Variables → `STRATZ_TOKEN` ändern → „Redeploy“.
- **Lokal weiterarbeiten:** `npm.cmd run dev` funktioniert wie bisher mit `.env.local`.

## Gut zu wissen

- Alle, die den Link kennen, verbrauchen dein STRATZ-Kontingent. Den Link nur im Team teilen.
- Teameinstellungen (Spieler-IDs, Gegnerteam, Filter) werden im jeweiligen Browser gespeichert, nicht geteilt.
- Der kostenlose „Hobby“-Tarif von Vercel ist für private, nicht kommerzielle Nutzung gedacht.
