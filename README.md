# Verses — Scripture Memorization (v0.24)

A Duolingo-style web game for memorizing Bible passages, built as a
single static site (plain HTML/CSS/JS, no build step, no backend).

## What v0.1 does

- Pick a free, public-domain English translation: WEB, WEBBE, KJV, BBE,
  OEB-US, or OEB-CW (served live by [bible-api.com](https://bible-api.com), no
  API key needed).
- Choose a passage in three steps: pick a book (searchable grid) → pick
  a chapter → read the whole chapter and tap/highlight the verses you
  want. Drag across verses or Shift-click to select a range; verses
  don't have to be contiguous (e.g. John 3:16-18, 21). Or memorize a
  whole book (one lesson per chapter).
- Each passage is split into short lessons (about one verse each, plus a
  "Review all" lesson). Each lesson has 10+ exercises that build from
  easy to hard: listen & read → word tiles → word-bank blanks → pick
  the right wording → what comes next → more blanks → build it up in
  small bits → first-letter clues → mostly blanks → say it all from
  memory.
- Speaking comes first (Web Speech API, graded leniently for
  homophones, digits and small slips); typing is always one tap away.
- Listen to any verse in the most natural voice your browser has
  (choose voice and speed in ⚙️ Settings).
- Hints reveal the first couple of words. Every exercise can be skipped
  (no points). Retries earn 80% / 60% / 30% of the points, or pay
  20 / 40 / 60 coins to retry for full points.
- Earn points (⚡) and coins (🪙), and build a daily streak.
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
js/spacing.js         spaced-repetition scheduling (pure functions)
js/game.js            localStorage-backed progress/coins/xp/streak/settings
js/speech.js          text-to-speech (best natural voice) + speech recognition
js/ui.js              home, passage picker, settings screens
js/lesson.js          lesson units, exercise runner, scoring/retries
tests/                node tests (node tests/challenges.test.js, node tests/spacing.test.js)
```

## Roadmap (later versions)

- v0.3: speaking is always an option instead of filling in the blanks by typing (more mobile friendly for this type of thing)
- v2.x: friends/contacts, shared challenges and leaderboards.

## Roadmap now
- v0.22: Have a way for the learner to listen to the verse (voice needs to be a more natural speech reader--not a computer sounding one).  This is for when a verse(s) is first displayed (but is optional if the learner wants to listen to the verse).  There needs to be way more ways to practice.  Try first letters taken out, going in small bits (parts of 1st verse; then another part, etc.). The other methods are good, but don't have so many blanks words at first.  Build this up over a few trials. There should be at least 7-10 ways to do each verse in varying forms of difficulty.  Typing the verse is one thing, but saying it is better, so emphasize that.  If a person needs a hint, especially when they are at the write the (entire) verse or say the verse, this should give the first couple of words to get people on the right track.  Allow for try again buttons, but each time reduce the points that are awarded (1st time backwards, is 80% of the points, second is 60% points, 3rd is 30% points).  But if a person wants to use coins to pay for full points, they can do that too.  So if they go back and pay 40 coins, then it is 100% points, 20 coins it is 60% points, etc.  Allow a person to skip any of the lessons, such as speaking (because they might be in a place where they cannot speak).  Always provide a skip button, but do not award any points for skipping.

## How it applies memory science (v0.24)

| Technique (research) | What Verses does |
| --- | --- |
| Testing effect: retrieving beats re-reading | Every exercise asks the learner to produce words; scaffolds fade from many blanks, to first letters, to nothing |
| Spacing effect + successive relearning | Finishing a verse schedules reviews at 1, 3, 7, 14, 30, 60, 120, 240 days. A clean first-try recall advances the box, a shaky one comes back sooner, a miss drops back and returns tomorrow (`js/spacing.js`) |
| Sleep consolidation | First review is always the next day |
| Production effect | Speaking is the default answer mode; the read step asks you to read aloud |
| Chunking | Verses are shown phrase by phrase; long ones are built up part by part |
| Elaboration / depth of processing | "Make it meaningful" step (picture it, own words, personal link); an optional note is saved and shown at review time |
| Memorizing the address | Reference shown with the verse, a "where is this found?" question, and recall exercises ask for the reference first (a spoken or typed reference is not penalised) |
| Interleaving | Daily review mixes verses from every passage in random order |
| Targeted feedback | Words you miss are collected and drilled together before the final recall |
| Desirable difficulty / honest measurement | Review starts with a cold recall from the address only; scheduling uses the first-try accuracy, and using a hint stops the box from advancing |

The home screen shows a **Daily review** card with how many verses are due,
and an in-app "How Verses helps you remember" page explains each technique.

## Changelog
- v0.24: Memory-science pass. Spaced-repetition review (Daily review on the
  home screen, due badges on the path, next-review card after each lesson).
  Retrieval-first reviews with a scaffolded fallback. New exercises: "make
  it meaningful" (with saved note), "where is this verse found?", and an
  adaptive tricky-words drill built from the words you missed. Verses are
  shown in phrase chunks with their reference; recall exercises accept a
  spoken/typed reference. New "How Verses helps you remember" page.
- v0.23: Roadmap v0.2 wrapped up. The visual book/chapter browser (v0.21)
  and lenient speech grading (v0.22) were already in; this adds the
  Open English Bible, Commonwealth Edition (OEB-CW) as a sixth translation.
- v0.22: Much more practice per verse. Passages are split into small
  lessons of 10+ exercises each, from easy to hard (word tiles,
  word-bank blanks, pick the right wording, what comes next, build it
  up in small bits, first-letter clues, full recall), plus a review
  lesson. Speaking is the main way to answer, with typing as a toggle.
  Word-by-word grading no longer marks everything after one missed
  word as wrong, and it allows for sound-alike words and small typos.
  Listen button using the most natural browser voice, with voice and
  speed settings. Hints, Skip on every exercise, retries at 80/60/30%
  points, paid retries for full points (20/40/60 coins), points (XP)
  and a lesson summary screen.
- v0.21: Renamed to **Verses**. Replaced the dropdown setup with a
  book → chapter → full-chapter view where verses are selected with
  checkboxes / highlighting (click, drag, Shift-click, Select all).
  Refreshed look and feel (Nunito UI font, Literata for scripture text,
  card-style path with remove buttons). Existing saved progress is kept.
