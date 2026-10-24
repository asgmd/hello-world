# Family Eats 🍽️

A small app for our family to keep track of the restaurants we go to. It runs on our phones and is installed from the browser.

## What it does

- **Finds the restaurant for you.** Tap **📍 Find restaurants near me** to see nearby restaurants, cafés and bars, with name, cuisine, address, phone and website. Restaurant info comes from OpenStreetMap, which is free and needs no account or API key. You can also **search by name anywhere** (e.g. "Pizzeria Regina Boston") or **enter a place by hand**.
- **1–5 star rating.** Whole stars only. A visit can't be saved without a rating.
- **Date defaults to today.** Pick any earlier date to log **past visits**. Future dates are blocked.
- **Photos (optional).** Add several per visit from the camera or photo library. They're shrunk to about 1600px so they don't fill up the phone.
- **Who went.** Tap family members' names. Names you add once are remembered.
- **Notes.** For example, what you ordered.
- **Places list** with average rating, number of visits and last visit. Filter it, or sort by recent, top rated, most visited or A–Z.
- **History**: every visit in a timeline by month, which you can filter by year or family member.
- Edit or delete any visit, and fix a restaurant's details.
- Works offline once it has been opened (finding restaurants still needs internet).

## Where the data lives

Everything, photos included, is stored **on the device** in the browser's IndexedDB. There is no server and no account.
To back up, or to share with another family member: **Settings → Export backup**, send the file, then on the other phone use **Settings → Import backup**. Importing *merges* the two; it never deletes anything.

## Running it

It's plain HTML/JS with no build step. Location only works over `https://` or `localhost`.

**On your phones (recommended): GitHub Pages**
1. In GitHub, go to repo **Settings → Pages**, set *Source* to "Deploy from a branch", choose `main` and `/ (root)`, then click Save.
2. Open `https://asgmd.github.io/hello-world/restaurant-tracker/` on each phone.
3. Add it to the home screen. iPhone: Share → *Add to Home Screen*. Android: menu → *Install app*.

**Locally**
```sh
cd restaurant-tracker
python3 -m http.server 8000   # then open http://localhost:8000
```

## Tests

```sh
cd restaurant-tracker
npm test   # Node 18+, no dependencies
```

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Page shell and styling (light and dark mode) |
| `js/app.js` | Screens: places, history, log visit, settings |
| `js/places.js` | Location and restaurant lookup (OpenStreetMap Overpass and Nominatim) |
| `js/db.js` | On-device storage, plus backup export/import |
| `js/util.js` | Pure helpers (dates, rating checks, parsing), unit tested |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Installable app and offline support |

Restaurant data © OpenStreetMap contributors.
