# Zmanim Sheet Generator

A local web tool that generates printable שבת קיץ / שבת חורף shul zmanim boards,
ported from `Lakewood Commons Zmanim tables.xlsx`.

## Running it

**Easiest way:** double-click `Start.bat` in this folder. It starts a local server
in its own window and opens the app in your default browser. Leave that window open
while you use the app; closing it stops the server. Next time, just double-click
`Start.bat` again.

**Manual way:** this is a static site (no build step), but it loads its data files
(`data/*.json`) with `fetch()`, which browsers block from a `file://` page, so it needs
to be served rather than opened directly:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. (Any other static file server works too.)

To put it online later: upload this folder as-is to GitHub Pages, Netlify, or any
static host — nothing needs to change.

## Fully offline (USB drive / no internet / no local server)

The `offline/` folder is a self-contained copy that needs **nothing** — no server,
no internet, not even the `Start.bat` step above. Copy the whole `offline/` folder to
a USB drive, plug it into any computer, and double-click `offline/index.html`; it opens
straight in the default browser and works completely offline from then on (all your
data still saves locally in that browser, same as the regular version).

This works because `offline/bundle.js` has everything — every `.js` file and the
Hebrew-calendar data tables — bundled into one plain script, instead of the ES modules
and `fetch()` calls the regular version uses (both of those are blocked when a page is
opened directly as a file instead of served over a URL).

If you change anything under `js/`, `css/`, `data/`, or `assets/`, regenerate the
offline copy before recopying it to a USB drive:

```bash
python build-offline.py
```

## How your data is stored

Everything (Settings, generated sheets with their per-cell overrides, and Rules) is
saved in this browser's local storage — nothing is sent anywhere. Use **Export backup**
in the header to save a JSON file, and **Import backup** to restore it (e.g. on another
computer, or after clearing browser data).

## Rules vs. overrides

- **Overrides** (click any cell on a generated sheet to edit it) are one-off and tied
  to that specific generated sheet.
- **Rules** (the Rules tab) are reusable and apply automatically every time you
  generate a sheet — use these for recurring exceptions like Shabbos Teshuva / Shabbos
  HaGadol having a different Mincha time because of the drasha. Two starter rules are
  seeded with a placeholder value ("לפי הדרשה — ערוך") — edit them with your shul's
  actual times.

## What's ported from the workbook vs. simplified

- All astronomical zmanim math and both sheets' column formulas are ported directly
  from the workbook's own formulas.
- The Hebrew calendar (dates, parsha-of-week, special Shabbosim) is also fully
  self-contained, ported from the workbook's own calendar tables/formulas — no
  external calendar library or internet connection required.
- The timezone list is a small curated set (not the workbook's full 510-zone table).
- The full-year "Shabbos & Yom Tov Calendar" sheet, Daf Yomi, and Tachanun-day logic
  are not included yet — flagged as a follow-up.
