// Run with: node tests/spacing.test.js
const assert = require("assert");
const S = require("../js/spacing.js");

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("ok -", name); }

const D0 = "2026-03-01";

t("date helpers cross month/year/DST boundaries", () => {
  assert.strictEqual(S.addDays("2026-02-28", 1), "2026-03-01");
  assert.strictEqual(S.addDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(S.addDays("2026-03-07", 1), "2026-03-08"); // US DST start
  assert.strictEqual(S.addDays("2026-11-01", 1), "2026-11-02"); // US DST end
  assert.strictEqual(S.daysBetween("2026-03-01", "2026-03-31"), 30);
});
t("new unit is due tomorrow", () => {
  const e = S.newEntry(D0);
  assert.strictEqual(e.due, "2026-03-02");
  assert.ok(!S.isDue(e, D0));
  assert.ok(S.isDue(e, "2026-03-02"));
  assert.ok(S.isDue(e, "2026-04-01")); // overdue still counts as due
});
t("clean reviews expand the gap each time", () => {
  let e = S.newEntry(D0);
  let day = e.due;
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    e = S.review(e, 1, false, day);
    gaps.push(S.daysBetween(day, e.due));
    day = e.due;
  }
  assert.deepStrictEqual(gaps, [3, 7, 14, 30, 60, 120]);
});
t("box is capped", () => {
  let e = { box: 7, due: D0, reps: 0, lapses: 0 };
  e = S.review(e, 1, false, D0);
  assert.strictEqual(e.box, 7);
  assert.strictEqual(S.daysBetween(D0, e.due), 240);
});
t("a hint prevents advancing", () => {
  const e = S.review({ box: 2, due: D0, reps: 3, lapses: 0 }, 1, true, D0);
  assert.strictEqual(e.box, 2);
  assert.ok(S.daysBetween(D0, e.due) < S.intervalFor(2));
});
t("shaky recall stays, sooner than a clean pass", () => {
  const e = S.review({ box: 3, due: D0, reps: 3, lapses: 0 }, 0.8, false, D0);
  assert.strictEqual(e.box, 3);
  assert.strictEqual(S.daysBetween(D0, e.due), S.intervalFor(2));
});
t("forgetting drops the box, returns tomorrow, counts a lapse", () => {
  const e = S.review({ box: 5, due: D0, reps: 5, lapses: 0 }, 0.4, false, D0);
  assert.strictEqual(e.box, 2);
  assert.strictEqual(e.due, "2026-03-02");
  assert.strictEqual(e.lapses, 1);
  assert.strictEqual(S.review({ box: 0, due: D0 }, 0, false, D0).box, 0);
});
t("review does not mutate its input", () => {
  const e = Object.freeze({ box: 1, due: D0, reps: 1, lapses: 0 });
  S.review(e, 1, false, D0);
});
t("sort: most overdue first", () => {
  const out = S.sortByDue([{ due: "2026-03-05" }, { due: "2026-03-01" }, { due: "2026-03-03" }]);
  assert.deepStrictEqual(out.map((x) => x.due), ["2026-03-01", "2026-03-03", "2026-03-05"]);
});
t("describeDue", () => {
  assert.strictEqual(S.describeDue("2026-03-01", D0), "today");
  assert.strictEqual(S.describeDue("2026-02-20", D0), "today");
  assert.strictEqual(S.describeDue("2026-03-02", D0), "tomorrow");
  assert.strictEqual(S.describeDue("2026-03-06", D0), "in 5 days");
  assert.strictEqual(S.describeDue("2026-03-31", D0), "in 4 weeks");
  assert.strictEqual(S.describeDue("2026-07-01", D0), "in 4 months");
});
console.log(`\n${passed} passed`);
