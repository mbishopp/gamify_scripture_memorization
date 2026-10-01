/* Pure grading / exercise-generation logic. No DOM, no storage — so it can
   be tested with plain Node (see tests/challenges.test.js).

   v0.22: alignment-based grading (a missed word no longer shifts every
   later word to "wrong"), light leniency for speech (homophones, digits,
   small typos), and a "ladder" of 10+ exercises per verse that starts
   easy and builds to full recall. */

const Challenges = (() => {
  // ------------------------------------------------------------ scoring
  // All tunable numbers live here.
  const SCORING = {
    // points multiplier by attempt: 1st try, 1st retry, 2nd retry, 3rd+ retry
    retryMultipliers: [1, 0.8, 0.6, 0.3],
    // coins to pay for a retry at full points: (n/a), 1st retry, 2nd, 3rd+
    buybackCosts: [0, 20, 40, 60],
    coinsPerPoint: 0.5, // coins earned per point (XP) earned
    roundBonusCoins: 5 // bonus coins for finishing a lesson
  };

  function multiplierForAttempt(attempt) {
    const m = SCORING.retryMultipliers;
    return m[Math.min(attempt, m.length - 1)];
  }

  function buybackCost(attempt) {
    const c = SCORING.buybackCosts;
    return c[Math.min(attempt, c.length - 1)];
  }

  function pointsFor(base, accuracy, multiplier) {
    return Math.round(base * accuracy * multiplier);
  }

  function coinsForPoints(points) {
    return Math.round(points * SCORING.coinsPerPoint);
  }

  // ------------------------------------------------------------- words
  const NUMBER_WORDS = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty"
  ];

  function normalizeWord(w) {
    let n = String(w)
      .toLowerCase()
      .replace(/[’‘`']/g, "") // God's == gods (speech engines drop apostrophes)
      .replace(/[^a-z0-9]/g, "");
    if (/^\d+$/.test(n) && +n <= 20) n = NUMBER_WORDS[+n];
    return n;
  }

  function tokenize(text) {
    return String(text).split(/\s+/).filter(Boolean);
  }

  // Words that speech recognition commonly confuses.
  const HOMOPHONES = [
    ["to", "too", "two"], ["there", "their", "theyre"], ["for", "four", "fore"],
    ["one", "won"], ["son", "sun"], ["whole", "hole"], ["knew", "new"], ["know", "no"],
    ["hear", "here"], ["be", "bee"], ["right", "write", "rite"], ["through", "threw"],
    ["i", "eye", "aye"], ["peace", "piece"], ["which", "witch"], ["prey", "pray"],
    ["sow", "sew", "so"], ["reign", "rain", "rein"], ["seen", "scene"], ["way", "weigh"],
    ["wholly", "holy"], ["our", "hour"], ["by", "buy", "bye"], ["made", "maid"],
    ["mourning", "morning"], ["alter", "altar"], ["heal", "heel"],
    ["o", "oh"], ["lo", "low"], ["yea", "yeah"], ["cannot", "cant"], ["saviour", "savior"],
    ["honour", "honor"], ["labour", "labor"], ["neighbour", "neighbor"], ["colour", "color"]
  ];
  const canon = new Map();
  HOMOPHONES.forEach((group, i) => group.forEach((w) => canon.set(w, i)));

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // a, b are already normalized
  function wordsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (canon.has(a) && canon.get(a) === canon.get(b)) return true;
    const longest = Math.max(a.length, b.length);
    if (longest >= 5 && levenshtein(a, b) <= 1) return true;
    if (longest >= 9 && levenshtein(a, b) <= 2) return true;
    return false;
  }

  // Split "“For" -> { lead: "“", core: "For", trail: "" }
  function splitPunct(word) {
    const m = String(word).match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    return m ? { lead: m[1], core: m[2], trail: m[3] } : { lead: "", core: word, trail: "" };
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function randInt(n) {
    return Math.floor(Math.random() * n);
  }

  // ---------------------------------------------------------- alignment
  // Longest-common-subsequence alignment of reference words vs. given words.
  // Returns refToGot[i] = index in `got` matched to ref word i, or -1.
  function alignWords(refNorm, gotNorm) {
    const n = refNorm.length, m = gotNorm.length;
    const match = (i, j) => wordsMatch(refNorm[i], gotNorm[j]);
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = match(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const refToGot = new Array(n).fill(-1);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (match(i, j) && dp[i][j] === dp[i + 1][j + 1] + 1) {
        refToGot[i] = j;
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return refToGot;
  }

  // Grade a typed or spoken recall of `refText`.
  // Returns { accuracy, correct, total, diff: [{ text, correct }] }
  function gradeRecall(refText, given) {
    const refRaw = tokenize(refText);
    const refIdx = [];
    const refNorm = [];
    refRaw.forEach((w, i) => {
      const n = normalizeWord(w);
      if (n) {
        refIdx.push(i);
        refNorm.push(n);
      }
    });
    const gotRaw = tokenize(given || "");
    const gotNorm = gotRaw.map(normalizeWord).filter(Boolean);
    const map = alignWords(refNorm, gotNorm);
    const correctSet = new Set();
    map.forEach((g, k) => {
      if (g >= 0) correctSet.add(refIdx[k]);
    });
    const total = refNorm.length;
    const correct = correctSet.size;
    let accuracy = total ? correct / total : 0;
    // Mild penalty for lots of extra words (e.g. rambling into the next verse).
    const extra = gotNorm.length - correct - Math.ceil(total * 0.25);
    if (extra > 0 && total) accuracy = Math.max(0, accuracy - (extra / total) * 0.5);
    const diff = refRaw.map((w, i) => ({ text: w, correct: !normalizeWord(w) || correctSet.has(i) }));
    return { accuracy, correct, total, diff };
  }

  // Kept for backwards compatibility with v0.21 callers.
  const gradeTyped = gradeRecall;
  const gradeSpoken = gradeRecall;

  // ------------------------------------------------------------ phrases
  // Break text into natural phrases at punctuation, ~3-12 words each.
  function splitPhrases(text, maxWords = 12) {
    const words = tokenize(text);
    const phrases = [];
    let cur = [];
    words.forEach((w) => {
      cur.push(w);
      const endsPunct = /[,;:.!?)\]—–]["'”’)]*$/.test(w);
      if ((endsPunct && cur.length >= 3) || cur.length >= maxWords) {
        phrases.push(cur);
        cur = [];
      }
    });
    if (cur.length) {
      if (cur.length < 3 && phrases.length) phrases[phrases.length - 1].push(...cur);
      else phrases.push(cur);
    }
    return phrases.map((p) => p.join(" "));
  }

  // Merge phrases into at most `maxGroups` contiguous, roughly equal groups.
  function groupSegments(phrases, maxGroups = 3) {
    if (phrases.length <= maxGroups) return [...phrases];
    const counts = phrases.map((p) => tokenize(p).length);
    const total = counts.reduce((a, b) => a + b, 0);
    const groups = [];
    let cur = [];
    let acc = 0;
    phrases.forEach((p, i) => {
      cur.push(p);
      acc += counts[i];
      const remainingPhrases = phrases.length - i - 1;
      const remainingGroups = maxGroups - groups.length - 1;
      if (
        remainingGroups > 0 &&
        remainingPhrases >= remainingGroups &&
        acc >= (total * (groups.length + 1)) / maxGroups
      ) {
        groups.push(cur.join(" "));
        cur = [];
      }
    });
    if (cur.length) groups.push(cur.join(" "));
    return groups;
  }

  // ------------------------------------------------------------- blanks
  // Returns { tokens: [{ text } | { blank, index, lead, core, trail }], blanks: [index] }
  function makeBlanks(text, ratio = 0.25) {
    const words = tokenize(text);
    let eligible = words.map((_, i) => i).filter((i) => normalizeWord(words[i]).length >= 3);
    if (!eligible.length) eligible = words.map((_, i) => i).filter((i) => normalizeWord(words[i]));
    const count = Math.min(eligible.length, Math.max(1, Math.round(eligible.length * ratio)));
    const order = shuffle(eligible);
    const chosen = new Set();
    // first pass: avoid adjacent blanks so there's context around each
    for (const i of order) {
      if (chosen.size >= count) break;
      if (chosen.has(i - 1) || chosen.has(i + 1)) continue;
      chosen.add(i);
    }
    for (const i of order) {
      if (chosen.size >= count) break;
      chosen.add(i);
    }
    const tokens = words.map((w, i) =>
      chosen.has(i) ? { blank: true, index: i, ...splitPunct(w) } : { blank: false, text: w }
    );
    return { tokens, blanks: [...chosen].sort((a, b) => a - b) };
  }

  // answers: { [index]: string }
  function gradeBlanks(blankData, answers) {
    const results = {};
    let correct = 0;
    blankData.tokens.forEach((t) => {
      if (!t.blank) return;
      const ok = wordsMatch(normalizeWord(t.core), normalizeWord(answers[t.index] || ""));
      results[t.index] = ok;
      if (ok) correct++;
    });
    const total = blankData.blanks.length;
    return { correct, total, accuracy: total ? correct / total : 0, results };
  }

  // Speak the whole verse; only the blanked words are graded.
  // Returns same shape as gradeBlanks, plus heard[index] = word heard there.
  function gradeBlanksFromSpeech(text, blankData, transcript) {
    const words = tokenize(text);
    const refIdx = [];
    const refNorm = [];
    words.forEach((w, i) => {
      const n = normalizeWord(w);
      if (n) {
        refIdx.push(i);
        refNorm.push(n);
      }
    });
    const gotRaw = tokenize(transcript || "").filter((w) => normalizeWord(w));
    const map = alignWords(refNorm, gotRaw.map(normalizeWord));
    const matchedAt = new Map();
    map.forEach((g, k) => matchedAt.set(refIdx[k], g));
    const results = {};
    const heard = {};
    let correct = 0;
    blankData.blanks.forEach((i) => {
      const g = matchedAt.has(i) ? matchedAt.get(i) : -1;
      results[i] = g >= 0;
      heard[i] = g >= 0 ? gotRaw[g] : "";
      if (g >= 0) correct++;
    });
    const total = blankData.blanks.length;
    return { correct, total, accuracy: total ? correct / total : 0, results, heard };
  }

  // Extra wrong-but-plausible words for a word bank.
  function bankDistractors(text, blankData, n = 2) {
    const blankWords = new Set(blankData.blanks.map((i) => normalizeWord(blankData.tokens[i].core)));
    const pool = [];
    const seen = new Set();
    tokenize(text).forEach((w) => {
      const core = splitPunct(w).core;
      const norm = normalizeWord(core);
      if (norm.length >= 3 && !blankWords.has(norm) && !seen.has(norm)) {
        seen.add(norm);
        pool.push(core);
      }
    });
    const extra = shuffle(pool).slice(0, n);
    for (const w of shuffle(FILLER_WORDS)) {
      if (extra.length >= n) break;
      if (!blankWords.has(w) && !seen.has(w)) extra.push(w);
    }
    return extra;
  }

  // -------------------------------------------------------------- tiles
  // Word tiles to put in order. Long passages use 2-4 word tiles.
  function makeTiles(text) {
    const words = tokenize(text);
    const size = words.length <= 12 ? 1 : Math.ceil(words.length / 10);
    const tiles = [];
    for (let i = 0; i < words.length; i += size) {
      tiles.push({ id: tiles.length, text: words.slice(i, i + size).join(" ") });
    }
    let shuffled = shuffle(tiles);
    for (let tries = 0; tries < 10 && tiles.length > 1; tries++) {
      if (shuffled.some((t, i) => t.text !== tiles[i].text)) break;
      shuffled = shuffle(tiles);
    }
    return { tiles, shuffled };
  }

  // chosenIds: tile ids in the order the learner placed them
  function gradeTiles(tileData, chosenIds) {
    const byId = new Map(tileData.tiles.map((t) => [t.id, t]));
    let correct = 0;
    const results = chosenIds.map((id, i) => {
      const ok = tileData.tiles[i] && byId.get(id).text === tileData.tiles[i].text;
      if (ok) correct++;
      return ok;
    });
    const total = tileData.tiles.length;
    return { correct, total, accuracy: total ? correct / total : 0, results };
  }

  // ----------------------------------------------------------- variants
  const FILLER_WORDS = [
    "world", "heart", "people", "spirit", "father", "life", "light", "word", "love", "faith",
    "grace", "earth", "heaven", "truth", "peace", "glory", "power", "kingdom", "hope", "mercy",
    "shall", "given", "great", "walk", "strength", "salvation"
  ];

  function matchCase(template, word) {
    if (template[0] && template[0] === template[0].toUpperCase() && template[0] !== template[0].toLowerCase()) {
      return word[0].toUpperCase() + word.slice(1);
    }
    return word.toLowerCase() === word ? word : word.toLowerCase();
  }

  // A subtly wrong version of `text` (swapped, replaced, or dropped word).
  function makeVariant(text) {
    const words = tokenize(text);
    const content = words.map((_, i) => i).filter((i) => normalizeWord(words[i]).length >= 3);
    const ops = [];
    if (content.length >= 1) ops.push("replace");
    if (words.length >= 4) ops.push("swap", "drop");
    if (!ops.length) ops.push("replace");
    const op = ops[randInt(ops.length)];
    const out = [...words];
    if (op === "swap") {
      const i = randInt(words.length - 1);
      const a = splitPunct(out[i]);
      const b = splitPunct(out[i + 1]);
      out[i] = a.lead + matchCase(a.core, b.core) + a.trail;
      out[i + 1] = b.lead + matchCase(b.core, a.core) + b.trail;
    } else if (op === "drop") {
      const candidates = content.filter((i) => i > 0);
      const i = candidates.length ? candidates[randInt(candidates.length)] : 1;
      const dropped = splitPunct(out[i]);
      out.splice(i, 1);
      // keep trailing punctuation on the previous word
      if (dropped.trail && i > 0) out[i - 1] = out[i - 1].replace(/[^A-Za-z0-9]*$/, "") + dropped.trail;
    } else {
      const pool = content.length ? content : words.map((_, i) => i);
      const i = pool[randInt(pool.length)];
      const target = splitPunct(out[i]);
      const others = content
        .map((k) => splitPunct(words[k]).core)
        .filter((c) => normalizeWord(c) !== normalizeWord(target.core));
      const choices = others.length ? [...others, ...FILLER_WORDS] : FILLER_WORDS;
      let pick = choices[randInt(choices.length)];
      if (normalizeWord(pick) === normalizeWord(target.core)) pick = "people";
      out[i] = target.lead + matchCase(target.core, pick) + target.trail;
    }
    return out.join(" ");
  }

  function distinctVariants(text, n) {
    const seen = new Set([normalizeText(text)]);
    const out = [];
    for (let tries = 0; tries < 40 && out.length < n; tries++) {
      const v = makeVariant(text);
      const key = normalizeText(v);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(v);
      }
    }
    return out;
  }

  function normalizeText(t) {
    return tokenize(t).map(normalizeWord).filter(Boolean).join(" ");
  }

  // "Which one is exactly right?" — returns { options: [{ text, correct }] }
  function makePick(text) {
    const options = [{ text, correct: true }, ...distinctVariants(text, 2).map((t) => ({ text: t, correct: false }))];
    return { options: shuffle(options) };
  }

  // "What comes next?" — prompt phrase i, choose phrase i+1.
  function makeNext(phrases) {
    if (phrases.length < 2) return null;
    const i = randInt(phrases.length - 1);
    const answer = phrases[i + 1];
    const seen = new Set([normalizeText(answer)]);
    const distractors = [];
    shuffle(phrases.filter((_, k) => k !== i + 1 && k !== i)).forEach((p) => {
      const key = normalizeText(p);
      if (distractors.length < 1 && !seen.has(key)) {
        seen.add(key);
        distractors.push(p);
      }
    });
    distinctVariants(answer, 3).forEach((v) => {
      const key = normalizeText(v);
      if (distractors.length < 2 && !seen.has(key)) {
        seen.add(key);
        distractors.push(v);
      }
    });
    const options = [{ text: answer, correct: true }, ...distractors.map((t) => ({ text: t, correct: false }))];
    return { prompt: phrases[i], isStart: i === 0, options: shuffle(options) };
  }

  // -------------------------------------------------------- first letters
  // "For God so loved the world," -> "F G s l t w,"
  function firstLetters(text) {
    return tokenize(text)
      .map((w) => {
        const { lead, core, trail } = splitPunct(w);
        return lead + (core ? core[0] : "") + trail;
      })
      .join(" ");
  }

  function hintWords(text, count) {
    const words = tokenize(text);
    return words.slice(0, Math.min(count, Math.max(1, words.length - 1))).join(" ");
  }

  // ------------------------------------------------------------- ladder
  // Exercises for one small chunk (usually a single verse), easy -> hard.
  // `base` is the points (XP) a perfect first try earns.
  function buildLadder(text) {
    const phrases = splitPhrases(text);
    const segments = groupSegments(phrases, 3);
    const ex = [];
    ex.push({ type: "read", text });
    ex.push({ type: "tiles", text, base: 10 });
    ex.push({ type: "blanks", text, ratio: 0.15, bank: true, base: 10 });
    ex.push({ type: "pick", text, base: 10 });
    if (phrases.length >= 2) ex.push({ type: "next", text, phrases, base: 10 });
    ex.push({ type: "blanks", text, ratio: 0.35, bank: false, base: 15 });
    // build it up in small bits: part 1, then parts 1-2, ...
    for (let k = 1; k < segments.length; k++) {
      ex.push({ type: "bits", text: segments.slice(0, k).join(" "), part: k, parts: segments.length, base: 15 });
    }
    ex.push({ type: "letters", text, base: 20 });
    ex.push({ type: "blanks", text, ratio: 0.65, bank: false, base: 20 });
    ex.push({ type: "recall", text, base: 30 });
    return ex;
  }

  // A short review across several verses already learned one by one.
  function buildReviewLadder(verseTexts) {
    const text = verseTexts.join(" ");
    const ex = [];
    if (verseTexts.length >= 2) ex.push({ type: "next", text, phrases: verseTexts, base: 15 });
    ex.push({ type: "blanks", text, ratio: 0.4, bank: false, base: 20 });
    ex.push({ type: "letters", text, base: 25 });
    ex.push({ type: "recall", text, base: 40 });
    return ex;
  }

  return {
    SCORING,
    multiplierForAttempt,
    buybackCost,
    pointsFor,
    coinsForPoints,
    normalizeWord,
    tokenize,
    wordsMatch,
    splitPunct,
    alignWords,
    gradeRecall,
    gradeTyped,
    gradeSpoken,
    splitPhrases,
    groupSegments,
    makeBlanks,
    gradeBlanks,
    gradeBlanksFromSpeech,
    bankDistractors,
    makeTiles,
    gradeTiles,
    makeVariant,
    makePick,
    makeNext,
    firstLetters,
    hintWords,
    shuffle,
    buildLadder,
    buildReviewLadder
  };
})();

if (typeof window !== "undefined") {
  window.Challenges = Challenges;
}
if (typeof module !== "undefined") {
  module.exports = Challenges;
}
