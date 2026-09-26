/* Pure grading/generation logic for the four challenge types.
   Kept dependency-free and side-effect-free so it can be unit-tested
   with plain `node --check` / a small test harness. */

const Challenges = (() => {
  function normalizeWord(w) {
    return w
      .toLowerCase()
      .replace(/[^a-z0-9']/g, "")
      .trim();
  }

  function tokenize(text) {
    return text.split(/\s+/).filter(Boolean);
  }

  // --- Fill in the blank -----------------------------------------------
  // Blanks ~25% of words (min 1), skipping very short filler words so the
  // blanks are meaningful. Returns { displayTokens, answerKey } where
  // displayTokens is the array of words/blanks to render, and answerKey
  // maps blank index -> correct word (normalized for comparison).
  function makeFillBlank(text, ratio = 0.25) {
    const words = tokenize(text);
    const eligible = words
      .map((w, i) => ({ i, w }))
      .filter(({ w }) => normalizeWord(w).length >= 3);
    const blankCount = Math.max(1, Math.round(eligible.length * ratio));
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const blankIndices = new Set(shuffled.slice(0, blankCount).map((e) => e.i));

    const displayTokens = words.map((w, i) =>
      blankIndices.has(i) ? { blank: true, index: i } : { blank: false, text: w }
    );
    const answerKey = {};
    blankIndices.forEach((i) => {
      answerKey[i] = normalizeWord(words[i]);
    });
    return { displayTokens, answerKey, totalBlanks: blankIndices.size };
  }

  function gradeFillBlank(answerKey, userAnswers) {
    let correct = 0;
    const total = Object.keys(answerKey).length;
    const results = {};
    for (const idx of Object.keys(answerKey)) {
      const given = normalizeWord(userAnswers[idx] || "");
      const isRight = given === answerKey[idx];
      if (isRight) correct++;
      results[idx] = isRight;
    }
    return { correct, total, accuracy: total ? correct / total : 0, results };
  }

  // --- Type the whole passage from memory -------------------------------
  // Word-by-word diff against the reference. Returns per-word correctness
  // plus an overall accuracy percentage.
  function gradeTyped(referenceText, typedText) {
    const refWords = tokenize(referenceText).map(normalizeWord);
    const typedWords = tokenize(typedText).map(normalizeWord);
    const len = Math.max(refWords.length, typedWords.length);
    let correct = 0;
    const diff = [];
    for (let i = 0; i < len; i++) {
      const ref = refWords[i];
      const got = typedWords[i];
      const ok = ref !== undefined && ref === got;
      if (ok) correct++;
      diff.push({ index: i, expected: ref ?? null, given: got ?? null, correct: ok });
    }
    const accuracy = refWords.length ? correct / refWords.length : 0;
    return { accuracy, correct, total: refWords.length, diff };
  }

  // --- Speak it aloud -----------------------------------------------------
  // Same word-overlap scoring as typed mode, applied to the speech-to-text
  // transcript. Kept as a separate export in case scoring diverges later
  // (e.g. leniency for homophones).
  function gradeSpoken(referenceText, transcript) {
    return gradeTyped(referenceText, transcript);
  }

  // --- Coin rewards ---------------------------------------------------
  function coinsForAccuracy(accuracy, base = 10) {
    if (accuracy >= 0.95) return base;
    if (accuracy >= 0.8) return Math.round(base * 0.7);
    if (accuracy >= 0.5) return Math.round(base * 0.4);
    return Math.round(base * 0.1);
  }

  return {
    normalizeWord,
    tokenize,
    makeFillBlank,
    gradeFillBlank,
    gradeTyped,
    gradeSpoken,
    coinsForAccuracy
  };
})();

if (typeof window !== "undefined") {
  window.Challenges = Challenges;
}

// Export for node --check / a future node-based test harness (no-op in browser).
if (typeof module !== "undefined") {
  module.exports = Challenges;
}
