# Logbook

A study planner for library days, Monday to Friday, 09:00 to 17:00. It plans each week from how many sessions you want to give each area of work, runs a focus timer inside the day's timeline, logs every session as it ends, and on Friday compares what you planned with what you did.

It runs in Chrome from a file on your laptop. There is no server, account or sync, and nothing leaves the browser unless you export it.

## The week

- Seven sessions a day, each starting on the hour: 09:00, 10:00, 11:00, then lunch, then 13:00 to 16:00. A session is 50 minutes of focus and a 10 minute break by default.
- Friday at 16:00 is the weekly review, which leaves 34 sessions to plan.
- Weekly fixed events, such as a group meeting, are placed first. Link one to an area and it counts towards that area.
- The rest is shared out by your targets per area. If the targets ask for more than the week holds, the buffer is cut first and the rest scaled down, with projects first.
- Click any slot in Week to change it for that week only.

## Requirements

- Node 26 or later, to build.
- Chrome, which is what it is built and checked for. The backup file needs the File System Access API, which Chrome provides on pages opened from disk; where it is missing, the option is hidden and export still works.

## Build and open

```
npm ci
npm run build
```

Then open `index.html` in Chrome, by double click or by dragging it into a window. The build writes one script, `dist/logbook.js`, because Chrome does not load module scripts from `file://` pages.

While changing the code, `npm run dev` rebuilds on every save; reload the page to see the change.

## Checks

```
npm test            # behaviour tests, node:test
npm run typecheck   # TypeScript over the JSDoc types in src/
```

## Where your data lives and how to back it up

Everything is kept in this browser's local storage for `file://` pages. Clearing browsing data, or opening `index.html` in a different browser or profile, starts from empty. Two ways to keep a copy:

- **Export backup**, in Settings or at the bottom of Review, downloads `logbook-backup-<date>.json`. Review shows when you last exported, as a weekly reminder.
- **Backup file**, in Settings, asks once for a file and then rewrites it a moment after every change. After Chrome restarts it needs one click on "Reconnect backup file" to write again; until then a notice says so.

**Import backup** in Settings replaces everything with a backup file after asking. A file that is damaged, or was saved by a newer version, is refused with the reason and nothing is changed.

If the saved data ever cannot be read, Logbook does not overwrite it. It keeps the unreadable copy in the browser, offers it as a download, and lets you import a backup or start fresh.

If browser storage is full, the change stays on screen and a notice asks you to export, so nothing is lost.

With two tabs open, each takes the other's changes as they are saved, so the last action wins and neither writes back stale data.

## Keyboard

| Key | Does |
|---|---|
| 1 to 6 | Today, Week, Tasks, Deadlines, Review, Settings |
| N | Add a task |
| Space | Start the next session, stop early, or skip the break |
| Tab, Enter, Escape | Every control is reachable by Tab; dialogs close with Escape |

Shortcuts are ignored while you type in a field or a dialog is open.

## Fonts

IBM Plex Sans and IBM Plex Mono, copyright IBM Corp., are included in `assets/fonts/` so the app works offline. They are licensed under the SIL Open Font License 1.1; the full text is in `assets/fonts/OFL.txt`.
