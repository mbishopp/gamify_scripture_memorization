/* Persistence + progress state, backed by localStorage.
   Schema (all under one key to keep it simple for v0.1):
   {
     coins: number,
     streak: { count: number, lastActiveDate: "YYYY-MM-DD" },
     translation: "web",
     lessons: {
       [lessonId]: {
         label, reference, translationId,
         progress: 0-100,
         chapters: [ { ref, label, progress } ]   // only for book-scope lessons
       }
     }
   }
*/

const Game = (() => {
  const STORAGE_KEY = "scripture-memorize-v0_1";

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch (e) {
      console.warn("Could not read saved progress, starting fresh.", e);
      return defaultState();
    }
  }

  function defaultState() {
    return {
      coins: 0,
      streak: { count: 0, lastActiveDate: null },
      translation: "web",
      lessons: {}
    };
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

  function setTranslation(id) {
    state.translation = id;
    save();
  }

  function addCoins(n) {
    state.coins = Math.max(0, state.coins + n);
    save();
    return state.coins;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function bumpStreak() {
    const today = todayStr();
    const last = state.streak.lastActiveDate;
    if (last === today) {
      // already counted today
    } else {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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
    state.lessons[lessonId].progress = Math.max(
      state.lessons[lessonId].progress || 0,
      progress
    );
    save();
  }

  function removeLesson(lessonId) {
    delete state.lessons[lessonId];
    save();
  }

  function listLessons() {
    return Object.entries(state.lessons).map(([id, data]) => ({ id, ...data }));
  }

  return {
    getState,
    setTranslation,
    addCoins,
    bumpStreak,
    upsertLesson,
    setLessonProgress,
    removeLesson,
    listLessons
  };
})();

window.Game = Game;
