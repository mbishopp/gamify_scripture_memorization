# Verse Quest — Scripture Memorization (v0.1)

A Duolingo-style web game for memorizing Bible passages, built as a
single static site (plain HTML/CSS/JS, no build step, no backend).

## What v0.1 does

- Pick a free, public-domain English translation: WEB, WEBBE, KJV, BBE,
  or OEB-US (served live by [bible-api.com](https://bible-api.com), no
  API key needed).
- Pick a single verse, a range of verses, a whole chapter, or a whole
  book (a book becomes a path with one lesson per chapter).
- Each lesson runs you through a sequence of challenges per few-verse
  chunk: read & recall, fill-in-the-blank, type it from memory, and say
  it out loud (uses the browser's Web Speech API, graded against the
  reference text).
- Earn coins based on accuracy, and build a daily streak.
- Progress, coins, and streak are saved in the browser via
  `localStorage` — this is a single-player, single-browser v0.1. Multi
  device sync and friends/challenges are planned for a later version.

## Running it locally

No install needed — it's static files. Two options:

**Just open it:**
Double-click `index.html`. It should work, since bible-api.com allows
cross-origin requests. If your browser blocks the fetch from a
`file://` page, use the local server option below instead — and note
that speech recognition (the "say it out loud" challenge) requires a
secure context (`https://` or `localhost`), so it won't work opened
directly from disk in most browsers.

**Local server (recommended, and needed for the speech challenge):**
```bash
# from the project folder
python3 -m http.server 8080
# then open http://localhost:8080
```
or, with Node installed:
```bash
npx serve .
```

## Hosting on GitHub Pages

This app is a perfect fit for GitHub Pages — it's 100% static, and
Pages serves it over HTTPS, which the speech-recognition challenge
needs anyway.

1. Push this repo to GitHub (see below).
2. In the repo on GitHub: **Settings → Pages → Source**, choose the
   `main` branch and `/ (root)` folder, then save.
3. GitHub will publish it at `https://<your-username>.github.io/<repo-name>/`.

All asset paths in this project are relative, so it works whether it's
served from the domain root or from a `/repo-name/` subpath.

## Connecting this project to a GitHub remote

This folder is already a git repository with an initial commit. To
push it to GitHub:

1. Create a new, empty repository on GitHub (no README/license, so it
   doesn't conflict with what's already here).
2. In a terminal, from this project folder, run:
   ```bash
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```
   (Use the SSH URL instead of HTTPS if that's how you normally
   authenticate to GitHub.)

## Project structure

```
index.html          entry point
style.css            styling
js/bible-data.js      static book/chapter list + translation list
js/bible-api.js       fetch wrapper around bible-api.com
js/challenges.js      grading logic for each challenge type (pure functions)
js/game.js            localStorage-backed progress/coins/streak state
js/ui.js              screen rendering + challenge flow
```

## Roadmap (later versions)

- v0.2: a visual "scan the Bible" browser instead of dropdowns, more
  translations, better speech-grading leniency (homophones, minor
  variants).
- v2.x: friends/contacts, shared challenges and leaderboards.
