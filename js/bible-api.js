/* Thin wrapper around bible-api.com (free, no key required, serves several
   public-domain English translations). Docs: https://bible-api.com/ */

const BibleAPI = (() => {
  const BASE = "https://bible-api.com/";
  const cache = new Map();

  // reference like "john 3:16", "john 3:16-18", or "john 3" (whole chapter)
  async function fetchPassage(reference, translationId) {
    const key = `${translationId}::${reference}`;
    if (cache.has(key)) return cache.get(key);

    const url = `${BASE}${encodeURIComponent(reference)}?translation=${encodeURIComponent(
      translationId
    )}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Bible API error (${res.status}) fetching "${reference}"`);
    }
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    // Normalize: always return { reference, translation, verses: [{book,chapter,verse,text}] }
    const verses = (data.verses || []).map((v) => ({
      book: v.book_name,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text.trim().replace(/\s+/g, " ")
    }));
    const result = {
      reference: data.reference,
      translationId: data.translation_id || translationId,
      translationName: data.translation_name || translationId,
      verses,
      fullText: verses.map((v) => v.text).join(" ")
    };
    cache.set(key, result);
    return result;
  }

  async function fetchChapter(bookName, chapterNum, translationId) {
    return fetchPassage(`${bookName} ${chapterNum}`, translationId);
  }

  async function fetchVerseRange(bookName, chapterNum, startVerse, endVerse, translationId) {
    const ref =
      startVerse === endVerse
        ? `${bookName} ${chapterNum}:${startVerse}`
        : `${bookName} ${chapterNum}:${startVerse}-${endVerse}`;
    return fetchPassage(ref, translationId);
  }

  return { fetchPassage, fetchChapter, fetchVerseRange };
})();

window.BibleAPI = BibleAPI;
