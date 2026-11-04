# Campus Pulse

One place where Bennett University students see every club event, with the time and the room.

Three pages: **Events** (Today, Upcoming, Past, with search and filters), **Clubs**, and **My schedule** (saved events with a clash warning). Click any event for its poster, room, seats, a registration link, an .ics calendar file and a share link.

No build step, no server, no dependencies. It is plain HTML, CSS and JavaScript.

## Files

```
index.html
css/style.css
js/app.js
data/data.js              clubs and events (edit this)
data/events-template.csv  column layout for the Google Sheet
.nojekyll
```

## Run it locally

Double-click `index.html`. That is enough.

## Put it on GitHub Pages

1. Create a repository (use a shared GitHub organization, not a personal account, so the project survives graduation).
2. Upload everything in this folder to the repository root.
3. Go to Settings, Pages, choose "Deploy from a branch", pick `main` and `/ (root)`, and save.
4. The site goes live at `https://<account>.github.io/<repository>/` in a minute or two.

## Update events

### Option A: edit `data/data.js`

Add or change entries in `window.CAMPUS_EVENTS` and commit. Use `"date": "2026-11-12"`. The demo entries use `daysFromToday` so they never look old; delete that field once you go live.

### Option B: a Google Sheet (no coding for coordinators)

1. Make a sheet with these headers in row 1, exactly as written:

   `id, title, club, date, start, end, venue, description, capacity, registered, link, contact`

   You can import `data/events-template.csv` to start.
2. Format the `date` column as plain text, written `YYYY-MM-DD`. Times as `17:30`.
3. The `club` column holds the club id from `data/data.js` (for example `acm-bu`) or the exact club name.
4. In Google Sheets: File, Share, Publish to web, choose the events tab and **Comma-separated values (.csv)**, then Publish. "Anyone with the link" sharing is not the same and will not work.
5. Copy the link into `sheetCsvUrl` in `data/data.js` and commit once.

From then on, edits in the sheet appear on the site within about five minutes. If the sheet cannot be read, the site falls back to the events in `data/data.js`. Rows with a missing title, unknown club, bad date, bad time or a venue left empty are skipped, and the reason is printed in the browser console (press F12).

Only give edit access to the sheet to club coordinators and the admin team.

## Clubs

Clubs live in `window.CAMPUS_CLUBS` in `data/data.js`. Each club has an id, name, category, tagline, colour, recruitment status (`Open`, `Auditions` or `Closed`), meeting slot and contact email. The colour is used on that club's posters.

## Posters

There are no image files. Every poster is drawn in code from the event's title, club, date, time and room, so coordinators only type text.

## Security

- Content Security Policy in `index.html` limits scripts to this site and the sheet host.
- Every value from the data file or the sheet is escaped before display.
- Links must be `http` or `https`. External links open with `rel="noopener noreferrer"`.
- Saved events are kept in the browser's local storage on that device only.
- No secrets, accounts or backend.

## Who looks after it

- Club coordinators add their own events.
- A small student admin team checks the sheet once or twice a week.
- One faculty owner keeps the project going when students graduate.
