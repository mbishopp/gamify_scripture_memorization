/* Persistence + progress state, backed by localStorage.
   Schema (one key; same key as v0.1 so existing progress is kept):
   {
     coins: number,
     xp: number,                                   // v0.22: points
     streak: { count, lastActiveDate: "YYYY-MM-DD" },
     translation: "web",
     settings: { voiceName, voiceRate, speakFirst, autoListen },   // v0.22
     lessons: {
       [lessonId]: {
         label, kind: "verses" | "book", bookId, chapter, verses, translationId,
         progress: 0-100,
         chapterProgress: { [chapter]: 0-100 },     // book lessons
         units: { [unitKey]: 0-100 }                // v0.22: per mini-lesson best score
       }
     },
     reviews: {                                     // v0.24: spaced repetition
       [unitId]: { lessonId, label, ref, text, note, box, due, last, reps, lapses }
     }
   }
*/

const Game = (() => {
  const STORAGE_KEY = "scripture-memorize-v0_1";

  function defaultSettings() {
    return { voiceName: "", voiceRate: 0.95, speakFirst: true, autoListen: false };
  }

  function defaultState() {
    return {
      coins: 0,
      xp: 0,
      streak: { count: 0, lastActiveDate: null },
      translation: "web",
      settings: defaultSettings(),
      lessons: {},
      reviews: {}
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const state = { ...defaultState(), ...parsed };
      state.settings = { ...defaultSettings(), ...(parsed.settings || {}) };
      return state;
    } catch (e) {
      console.warn("Could not read saved progress, starting fresh.", e);
      return defaultState();
    }
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save progress (localStorage unavailable).", e);
    }
  }

  function getState() {
    return state;
  }

  function getSettings() {
    return state.settings;
  }

  function updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    save();
    return state.settings;
  }

  function setTranslation(id) {
    state.translation = id;
    save();
  }

  function addCoins(n) {
    state.coins = Math.max(0, state.coins + n);
    save();
    return state.coins;
  }

  // Returns true if the learner had enough coins.
  function spendCoins(n) {
    if (state.coins < n) return false;
    state.coins -= n;
    save();
    return true;
  }

  function addXp(n) {
    state.xp = Math.max(0, (state.xp || 0) + n);
    save();
    return state.xp;
  }

  const localDateStr = Spacing.toDateStr;
  const todayStr = () => localDateStr(new Date());

  function bumpStreak() {
    const today = localDateStr(new Date());
    const last = state.streak.lastActiveDate;
    if (last !== today) {
      const yesterday = localDateStr(new Date(Date.now() - 86400000));
      state.streak.count = last === yesterday ? state.streak.count + 1 : 1;
      state.streak.lastActiveDate = today;
    }
    save();
    return state.streak;
  }

  function upsertLesson(lessonId, lessonData) {
    state.lessons[lessonId] = { ...(state.lessons[lessonId] || {}), ...lessonData };
    save();
    return state.lessons[lessonId];
  }

  function setLessonProgress(lessonId, progress) {
    if (!state.lessons[lessonId]) return;
    state.lessons[lessonId].progress = Math.max(state.lessons[lessonId].progress || 0, progress);
    save();
  }

  function getUnitProgress(lessonId, key) {
    const l = state.lessons[lessonId];
    return (l && l.units && l.units[key]) || 0;
  }

  // Keeps the best score for a mini-lesson.
  function setUnitProgress(lessonId, key, pct) {
    const l = state.lessons[lessonId];
    if (!l) return 0;
    l.units = l.units || {};
    l.units[key] = Math.max(l.units[key] || 0, pct);
    save();
    return l.units[key];
  }

  function removeLesson(lessonId) {
    delete state.lessons[lessonId];
    Object.keys(state.reviews).forEach((id) => {
      if (state.reviews[id].lessonId === lessonId) delete state.reviews[id];
    });
    save();
  }

  // ------------------------------------------------- spaced repetition
  function getReview(id) {
    return state.reviews[id] || null;
  }

  // Called when a learner finishes a lesson unit. A new unit is scheduled
  // for tomorrow. A unit that is already scheduled and overdue counts as a
  // review (so practicing it from the path isn't wasted); otherwise its
  // schedule is left alone — cramming the same day shouldn't push it out.
  function registerUnit(id, data, accuracy, hinted) {
    const today = todayStr();
    const existing = state.reviews[id];
    if (!existing) {
      state.reviews[id] = { ...data, ...Spacing.newEntry(today) };
    } else {
      const merged = { ...existing, ...data };
      state.reviews[id] = Spacing.isDue(existing, today) ? Spacing.review(merged, accuracy, hinted, today) : merged;
    }
    save();
    return state.reviews[id];
  }

  // Apply a spaced review result. Returns the updated entry.
  function recordReview(id, accuracy, hinted) {
    const e = state.reviews[id];
    if (!e) return null;
    state.reviews[id] = Spacing.review(e, accuracy, hinted, todayStr());
    save();
    return state.reviews[id];
  }

  function setReviewNote(id, note) {
    if (!state.reviews[id]) return;
    state.reviews[id].note = note;
    save();
  }

  function dueReviews() {
    const today = todayStr();
    return Spacing.sortByDue(
      Object.entries(state.reviews)
        .map(([id, r]) => ({ id, ...r }))
        .filter((r) => Spacing.isDue(r, today))
    );
  }

  function dueCountForLesson(lessonId) {
    const today = todayStr();
    return Object.values(state.reviews).filter((r) => r.lessonId === lessonId && Spacing.isDue(r, today)).length;
  }

  // Earliest upcoming due date among units that aren't due yet (or null).
  function nextDueDate() {
    const dates = Object.values(state.reviews).map((r) => r.due);
    return dates.length ? dates.sort()[0] : null;
  }

  function reviewCount() {
    return Object.keys(state.reviews).length;
  }

  function listLessons() {
    return Object.entries(state.lessons).map(([id, data]) => ({ id, ...data }));
  }

  return {
    getState,
    getSettings,
    updateSettings,
    setTranslation,
    addCoins,
    spendCoins,
    addXp,
    bumpStreak,
    upsertLesson,
    setLessonProgress,
    getUnitProgress,
    setUnitProgress,
    removeLesson,
    listLessons,
    todayStr,
    getReview,
    registerUnit,
    recordReview,
    setReviewNote,
    dueReviews,
    dueCountForLesson,
    nextDueDate,
    reviewCount
  };
})();

window.Game = Game;
