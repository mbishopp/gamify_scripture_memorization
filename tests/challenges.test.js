// Run with: node tests/challenges.test.js
const assert = require("assert");
const C = require("../js/challenges.js");

const V = "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.";
let passed = 0;
function t(name, fn) { fn(); passed++; console.log("ok -", name); }

t("perfect recall", () => assert.strictEqual(C.gradeRecall(V, V).accuracy, 1));
t("missing word doesn't cascade", () => {
  const r = C.gradeRecall(V, V.replace("so ", ""));
  assert.strictEqual(r.correct, r.total - 1);
  assert.ok(r.accuracy > 0.95);
});
t("speech leniency: homophones, digits, no punctuation", () => {
  const spoken = "for god so loved the world that he gave his 1 and only sun that whoever believes in him should not perish but have eternal life";
  assert.strictEqual(C.gradeRecall(V, spoken).accuracy, 1);
});
t("small typo ok on long words", () => assert.ok(C.wordsMatch("believes", "beleives") || C.wordsMatch("believes", "belives")));
t("short word typo not ok", () => assert.ok(!C.wordsMatch("god", "good")));
t("empty answer = 0", () => assert.strictEqual(C.gradeRecall(V, "").accuracy, 0));
t("rambling penalized", () => assert.ok(C.gradeRecall("The Lord is my shepherd", "The Lord is my shepherd I shall not want he makes me lie down in green pastures").accuracy < 1));

t("phrases", () => {
  const p = C.splitPhrases(V);
  assert.ok(p.length >= 3, p);
  assert.strictEqual(p.join(" "), V);
});
t("segments <= 3 and cover text", () => {
  const s = C.groupSegments(C.splitPhrases(V), 3);
  assert.ok(s.length <= 3 && s.length >= 2);
  assert.strictEqual(s.join(" "), V);
});
t("blanks ratio + grading", () => {
  const b = C.makeBlanks(V, 0.15);
  assert.ok(b.blanks.length >= 1 && b.blanks.length <= 5, b.blanks.length);
  const answers = {};
  b.blanks.forEach((i) => (answers[i] = b.tokens[i].core));
  assert.strictEqual(C.gradeBlanks(b, answers).accuracy, 1);
  assert.ok(C.makeBlanks(V, 0.65).blanks.length > b.blanks.length);
});
t("blanks from speech", () => {
  const b = C.makeBlanks(V, 0.35);
  const r = C.gradeBlanksFromSpeech(V, b, V.toLowerCase());
  assert.strictEqual(r.accuracy, 1);
  const r2 = C.gradeBlanksFromSpeech(V, b, "");
  assert.strictEqual(r2.accuracy, 0);
});
t("tiles", () => {
  const td = C.makeTiles(V);
  assert.ok(td.tiles.length <= 12);
  assert.strictEqual(C.gradeTiles(td, td.tiles.map((x) => x.id)).accuracy, 1);
  assert.strictEqual(td.tiles.map((x) => x.text).join(" "), V);
});
t("variants differ from original", () => {
  for (let i = 0; i < 50; i++) {
    const p = C.makePick(V);
    assert.strictEqual(p.options.filter((o) => o.correct).length, 1);
    assert.strictEqual(new Set(p.options.map((o) => o.text)).size, p.options.length);
  }
  const short = C.makePick("Jesus wept.");
  assert.ok(short.options.length >= 2);
});
t("next phrase", () => {
  for (let i = 0; i < 30; i++) {
    const n = C.makeNext(C.splitPhrases(V));
    assert.strictEqual(n.options.filter((o) => o.correct).length, 1);
    assert.ok(n.options.length >= 2);
  }
});
t("first letters", () => assert.strictEqual(C.firstLetters("For God so loved the world,"), "F G s l t w,"));
t("ladder has 10+ exercises, increasing blanks", () => {
  const l = C.buildLadder(V);
  console.log("   ", l.map((e) => e.type + (e.ratio ? "(" + e.ratio + ")" : "") + (e.part ? "(" + e.part + "/" + e.parts + ")" : "")).join(" → "));
  assert.ok(l.length >= 10, l.length);
  assert.ok(new Set(l.map((e) => e.type)).size >= 8);
});
t("ladder for tiny verse", () => {
  const l = C.buildLadder("Jesus wept.");
  console.log("   ", l.map((e) => e.type).join(" → "));
  assert.ok(l.length >= 7);
});
t("scoring", () => {
  assert.deepStrictEqual([0, 1, 2, 3, 7].map(C.multiplierForAttempt), [1, 0.8, 0.6, 0.3, 0.3]);
  assert.deepStrictEqual([1, 2, 3, 9].map(C.buybackCost), [20, 40, 60, 60]);
  assert.strictEqual(C.pointsFor(30, 1, 0.8), 24);
});
console.log(`\n${passed} passed`);
