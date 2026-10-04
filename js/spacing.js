/* Spaced-repetition scheduling (pure functions, no DOM, no storage — tested
   with plain Node, see tests/spacing.test.js).

   Why: the single most reliable finding in memory research is that
   practice spread over days beats the same practice crammed into one
   sitting (the spacing effect), and that pulling a verse out of memory
   beats re-reading it (the testing effect). Combined, that is "successive
   relearning": retrieve it correctly, wait, retrieve it again, with the
   gaps growing each time.

   Each learned verse has a "box" (how many successful reviews in a row).
   The wait before the next review grows with the box. A review that goes
   badly drops the box so the verse comes back sooner. */

const Spacing = (() => {
  // Days to wait after reaching each box. First review is the next day
  // (after a night's sleep), then the gaps stretch out.
  const INTERVALS = [1, 3, 7, 14, 30, 60, 120, 240];
  const MAX_BOX = INTERVALS.length - 1;

  // First-try accuracy thresholds for a review.
  const GOOD = 0.9; // box + 1
  const OK = 0.7; // stay (and come back a bit sooner)

  const pad = (x) => String(x).padStart(2, "0");

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // "YYYY-MM-DD" -> Date at local noon (immune to DST edges)
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function daysBetween(fromStr, toStr) {
    return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
  }

  function intervalFor(box) {
    return INTERVALS[Math.max(0, Math.min(box, MAX_BOX))];
  }

  // A brand-new learned unit: first review tomorrow.
  function newEntry(today) {
    return { box: 0, due: addDays(today, intervalFor(0)), last: today, reps: 0, lapses: 0 };
  }

  // Apply the result of a review. `accuracy` is the FIRST-try accuracy of the
  // cold recall (0-1); `hinted` means a hint was used, which caps the result
  // at "ok" because a hint means the verse wasn't fully retrieved unaided.
  function review(entry, accuracy, hinted, today) {
    const e = { ...entry };
    let signal = accuracy;
    if (hinted) signal = Math.min(signal, GOOD - 0.01);
    e.reps = (e.reps || 0) + 1;
    e.last = today;
    if (signal >= GOOD) {
      e.box = Math.min((e.box || 0) + 1, MAX_BOX);
      e.due = addDays(today, intervalFor(e.box));
    } else if (signal >= OK) {
      // shaky: same box, but sooner than a clean pass would earn
      e.due = addDays(today, Math.max(1, intervalFor(Math.max(0, (e.box || 0) - 1))));
    } else {
      // forgot: drop back (keeps some savings), see it again tomorrow
      e.lapses = (e.lapses || 0) + 1;
      e.box = Math.floor((e.box || 0) / 2);
      e.due = addDays(today, 1);
    }
    return e;
  }

  function isDue(entry, today) {
    return !!entry && entry.due <= today;
  }

  // Most overdue first.
  function sortByDue(entries) {
    return [...entries].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }

  function describeDue(due, today) {
    const n = daysBetween(today, due);
    if (n <= 0) return "today";
    if (n === 1) return "tomorrow";
    if (n < 14) return `in ${n} days`;
    if (n < 60) return `in ${Math.round(n / 7)} weeks`;
    return `in ${Math.round(n / 30)} months`;
  }

  // Rough "how well is it locked in" label for a box.
  function strengthLabel(box) {
    if (box <= 0) return "New";
    if (box <= 2) return "Learning";
    if (box <= 4) return "Familiar";
    return "Strong";
  }

  return {
    INTERVALS,
    GOOD,
    OK,
    toDateStr,
    addDays,
    daysBetween,
    intervalFor,
    newEntry,
    review,
    isDue,
    sortByDue,
    describeDue,
    strengthLabel
  };
})();

if (typeof window !== "undefined") window.Spacing = Spacing;
if (typeof module !== "undefined") module.exports = Spacing;
