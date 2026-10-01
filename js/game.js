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
      lessons: {}
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

  function localDateStr(d) {
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

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
    save();
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
    listLessons
  };
})();

window.Game = Game;
