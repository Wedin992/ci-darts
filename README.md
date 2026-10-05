# Ci Darts

Dartappen för oss på jobbet. Webbapp (PWA) som funkar i mobil och dator.

- 101 / 301 / 501, dubbel ut eller rak ut, först till 1–4 legs
- Flera spelare, eller lag med två spelare (kastar växelvis: A1, B1, A2, B2 …)
- Spelarprofiler med öppen statistik: vinster, 3-pilssnitt, högsta runda/avslut, 100+/140+/180, form, inbördes möten
- Historik över alla matcher, med kast för kast. Ångra-knapp, avslutsförslag, "Spela igen"
- Allt sparas i en delad databas så alla ser samma data

## Kör lokalt

```bash
python3 -m http.server 8765   # eller valfri statisk server
open http://localhost:8765
```

Utan inställningar körs appen i **lokalt läge** (data i webbläsaren, delas inte).

## Gör den delad för hela jobbet (ca 10 min, gratis)

### 1. Databas – Supabase
1. Skapa konto på <https://supabase.com> → **New project** (välj region Stockholm/EU).
2. Öppna **SQL Editor**, klistra in innehållet i [`supabase/schema.sql`](supabase/schema.sql) och kör.
3. Gå till **Project Settings → API** och kopiera **Project URL** och **anon public key**.
4. Klistra in dem i [`js/config.js`](js/config.js).

> Appen har ingen inloggning – alla med länken kan läsa och skriva (det var önskemålet: öppet för alla på jobbet).
> Anon-nyckeln är gjord för att ligga i webbkoden. Dela länken internt, inte publikt.

### 2. Hosting – GitHub Pages
1. Skapa ett repo på GitHub och pusha mappen dit.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Efter någon minut finns appen på `https://<org-eller-användare>.github.io/<repo>/`.
4. Öppna länken i mobilen → **Dela → Lägg till på hemskärmen** (iOS) / **Installera app** (Android).

(Netlify, Vercel eller Cloudflare Pages fungerar lika bra – det är bara statiska filer.)

## Tester

```bash
node test/game.test.mjs
```

## Filer

| Fil | Innehåll |
|---|---|
| `js/game.js` | Spelregler: bust, avslut, legs, lag-ordning, ångra, avslutsförslag |
| `js/stats.js` | Statistikberäkning |
| `js/store.js` | Lagring (Supabase eller localStorage) |
| `js/app.js` | Gränssnitt och skärmar |
| `css/style.css` | Design efter ci.se (vinröd accent, kräm, Fraunces + IBM Plex Sans) |
