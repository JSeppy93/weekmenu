# The Wollieway Inn

Web-app (PWA) voor het weekmenu van het avondeten, met een afvinkbare boodschappenlijst.
Draait volledig op je telefoon: geen server, geen account. Gegevens staan in de browseropslag.

## Wat zit erin

- **Week**: ma/di, wo/do en vr/za één gerecht (dag 1 koken voor twee dagen), zondag soep.
  Elk gerecht kun je wisselen; de app voorkomt herhaling binnen twee weken.
- **Recept**: ingrediënten (automatisch omgerekend naar het aantal porties), bereiding, tijd,
  wat je op dag 2 nog moet doen, en een knop om het recept via WhatsApp te versturen.
- **Boodschappen**: alles voor de week bij elkaar opgeteld en ingedeeld per afdeling, met
  eigen items en een aparte "check je voorraad"-lijst. Werkt offline.
- **Instellingen**: rotatieweek, porties per kookmoment, back-up maken en terugzetten.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `recipes.js` | De 16 recepten, het rotatieschema (4 weken) en de kookmomenten |
| `app.js` | De app zelf |
| `style.css` | Opmaak (licht en donker) |
| `keuken.svg` | Geanimeerde illustratie bovenaan het weekscherm |
| `index.html`, `manifest.webmanifest`, `sw.js`, `*.png` | PWA-schil, iconen en offline-werking |

## Online zetten met GitHub Pages (zonder git)

1. Log in op [github.com](https://github.com) en maak een nieuwe repository, bijvoorbeeld `weekmenu`.
   Kies **Public** (GitHub Pages is gratis voor publieke repositories) en vink niets extra aan.
2. Klik op **uploading an existing file** en sleep deze bestanden en mappen erin:
   `index.html`, `app.js`, `recipes.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `README.md`, `keuken.svg`,
   `icon-192.png`, `icon-512.png` en `apple-touch-icon.png`. Mappen hoeven niet mee. Klik op **Commit changes**.
3. Ga naar **Settings → Pages**. Kies bij *Source* **Deploy from a branch**, branch **main**, map **/ (root)**, en klik op **Save**.
4. Na een minuutje staat de app op `https://<jouw-gebruikersnaam>.github.io/weekmenu/`.

Let op: een publieke repository betekent dat de recepten openbaar leesbaar zijn. Je persoonlijke
gegevens (vinkjes, wissels) staan alleen op je telefoon en komen nooit op GitHub.

## Op je iPhone zetten

1. Open de link in **Safari** (niet in Chrome of een andere app).
2. Tik op het deelicoon en kies **Zet op beginscherm**.
3. Open de app voortaan via het icoon. Hij werkt dan ook zonder internet.

Maak af en toe een back-up via *Instellingen → Back-up maken*: iOS kan gegevens van web-apps wissen
als je ze een paar weken niet opent.

## Een update doorvoeren

1. Pas de bestanden aan (bijvoorbeeld nieuwe recepten in `recipes.js`).
2. Verhoog in `sw.js` het versienummer (`weekmenu-v1` → `weekmenu-v2`).
3. Upload de gewijzigde bestanden opnieuw in GitHub (**Add file → Upload files**).
4. Open de app twee keer op je telefoon; de tweede keer zie je de nieuwe versie.

## Nieuwe recepten

Na vier weken heb je alle 16 recepten gehad. Vraag Claude om een nieuwe set die aan dezelfde
regels voldoet (zie het commentaar bovenaan `recipes.js`), en vervang daarmee de recepten en de `ROTATION`.

## Lokaal testen

```bash
python -m http.server 8931
```

Open daarna http://localhost:8931.
