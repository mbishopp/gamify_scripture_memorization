/* All DOM rendering + screen flow lives here. Vanilla JS, no framework,
   no build step — keeps the whole app runnable from a single index.html
   (including straight from GitHub Pages). */

const UI = (() => {
  const root = () => document.getElementById("app");

  let currentLessonRun = null; // holds in-progress lesson state

  // ---------------------------------------------------------------- utils
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2), v);
      } else {
        node.setAttribute(k, v);
      }
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtCoins(n) {
    return `🪙 ${n}`;
  }

  // -------------------------------------------------------------- header
  function renderHeader() {
    const state = Game.getState();
    return el("div", { class: "app-header" }, [
      el("button", { class: "brand", onclick: () => renderHome() }, "📖 Verses"),
      el("div", { class: "stats" }, [
        el("span", { class: "stat coins" }, fmtCoins(state.coins)),
        el("span", { class: "stat streak" }, `🔥 ${state.streak.count}`)
      ])
    ]);
  }

  // ---------------------------------------------------------- home screen
  function renderHome() {
    const container = root();
    clear(container);
    const lessons = Game.listLessons();

    const nodes = lessons.length
      ? lessons.map((lesson, i) => renderPathNode(lesson, i))
      : [el("p", { class: "empty-state" }, "No passages yet — add your first one below.")];

    container.appendChild(
      el("div", { class: "screen screen-home" }, [
        renderHeader(),
        el("h2", { class: "path-heading" }, "Your path"),
        el("div", { class: "path" }, nodes),
        el(
          "button",
          { class: "btn btn-primary btn-add", onclick: () => renderSetup() },
          "+ Add a passage"
        )
      ])
    );
  }

  function renderPathNode(lesson, index) {
    const progress = lesson.progress || 0;
    const offsets = [0, 48, 80, 48]; // gentle zig-zag like a trail
    const node = el("div", { class: "path-node-wrap", style: `margin-left:${offsets[index % 4]}px` }, [
      el(
        "button",
        {
          class: `path-node ${progress >= 100 ? "complete" : ""}`,
          onclick: () => openLesson(lesson.id)
        },
        el("span", { class: "path-node-icon" }, progress >= 100 ? "⭐" : "📘")
      ),
      el("div", { class: "path-node-label" }, [
        el("div", { class: "path-node-title" }, lesson.label),
        el("div", { class: "path-node-meta" }, `${(lesson.translationId || "").toUpperCase()} · ${progress}%`),
        el("div", { class: "progress-bar" }, [
          el("div", { class: "progress-bar-fill", style: `width:${progress}%` })
        ])
      ]),
      el(
        "button",
        {
          class: "path-node-remove",
          title: "Remove from path",
          "aria-label": `Remove ${lesson.label}`,
          onclick: () => {
            if (confirm(`Remove ${lesson.label} from your path?`)) {
              Game.removeLesson(lesson.id);
              renderHome();
            }
          }
        },
        "×"
      )
    ]);
    return node;
  }

  // --------------------------------------------------------- setup flow
  // v0.21: three steps instead of dropdowns —
  //   1. pick a book (grid, grouped by testament)
  //   2. pick a chapter (grid) — or memorize the whole book
  //   3. read the whole chapter and tick / highlight the verses to memorize

  // Compress [16,17,18,21] -> "16-18, 21"
  function formatVerseList(nums) {
    const sorted = [...nums].sort((a, b) => a - b);
    const parts = [];
    let start = null;
    let prev = null;
    for (const n of sorted) {
      if (start === null) {
        start = prev = n;
      } else if (n === prev + 1) {
        prev = n;
      } else {
        parts.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = prev = n;
      }
    }
    if (start !== null) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    return parts.join(", ");
  }

  function translationPicker(onChange) {
    const state = Game.getState();
    const select = el(
      "select",
      { class: "translation-select", "aria-label": "Translation" },
      TRANSLATIONS.map((t) =>
        el("option", { value: t.id, ...(t.id === state.translation ? { selected: "selected" } : {}) }, t.name)
      )
    );
    select.addEventListener("change", () => {
      Game.setTranslation(select.value);
      if (onChange) onChange(select.value);
    });
    return el("div", { class: "translation-row" }, [el("span", { class: "translation-label" }, "Translation"), select]);
  }

  function crumbs(items) {
    // items: [{ text, onclick? }]
    const parts = [];
    items.forEach((it, i) => {
      if (i) parts.push(el("span", { class: "crumb-sep" }, "›"));
      parts.push(
        it.onclick
          ? el("button", { class: "crumb crumb-link", onclick: it.onclick }, it.text)
          : el("span", { class: "crumb" }, it.text)
      );
    });
    return el("nav", { class: "crumbs" }, parts);
  }

  // Step 1 — book grid
  function renderSetup() {
    const container = root();
    clear(container);

    const section = (title, testament) =>
      el("section", { class: "book-section" }, [
        el("h3", { class: "section-title" }, title),
        el(
          "div",
          { class: "book-grid" },
          BIBLE_BOOKS.filter((b) => b.testament === testament).map((b) =>
            el("button", { class: "book-chip", onclick: () => renderChapterPicker(b.id) }, [
              el("span", { class: "book-chip-name" }, b.name),
              el("span", { class: "book-chip-meta" }, `${b.chapters} ch`)
            ])
          )
        )
      ]);

    const filter = el("input", {
      type: "search",
      class: "book-filter",
      placeholder: "Find a book…",
      "aria-label": "Find a book"
    });
    filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      container.querySelectorAll(".book-chip").forEach((chip) => {
        const name = chip.querySelector(".book-chip-name").textContent.toLowerCase();
        chip.style.display = !q || name.includes(q) ? "" : "none";
      });
    });

    container.appendChild(
      el("div", { class: "screen screen-setup" }, [
        renderHeader(),
        crumbs([{ text: "My path", onclick: () => renderHome() }, { text: "Choose a book" }]),
        translationPicker(),
        filter,
        section("Old Testament", "OT"),
        section("New Testament", "NT")
      ])
    );
    filter.focus();
  }

  // Step 2 — chapter grid (+ whole-book option)
  function renderChapterPicker(bookId) {
    const container = root();
    clear(container);
    const book = getBookById(bookId);

    const chips = [];
    for (let c = 1; c <= book.chapters; c++) {
      chips.push(el("button", { class: "chapter-chip", onclick: () => renderVersePicker(bookId, c) }, `${c}`));
    }

    const addBook = () => {
      const translationId = Game.getState().translation;
      Game.upsertLesson(`book:${book.id}:${translationId}`, {
        label: book.name,
        kind: "book",
        bookId: book.id,
        translationId,
        progress: 0,
        chapterProgress: {}
      });
      renderHome();
    };

    container.appendChild(
      el("div", { class: "screen screen-setup" }, [
        renderHeader(),
        crumbs([
          { text: "My path", onclick: () => renderHome() },
          { text: "Books", onclick: () => renderSetup() },
          { text: book.name }
        ]),
        el("h2", {}, book.name),
        el("p", { class: "hint" }, "Pick a chapter to read it and choose verses."),
        el("div", { class: "chapter-grid" }, chips),
        el("div", { class: "divider" }, "or"),
        el(
          "button",
          { class: "btn btn-secondary btn-block", onclick: addBook },
          `Memorize all of ${book.name} (${book.chapters} chapter lessons)`
        )
      ])
    );
  }

  // Step 3 — full chapter with selectable verses
  async function renderVersePicker(bookId, chapterNum, preselected = []) {
    const container = root();
    clear(container);
    const book = getBookById(bookId);
    const selected = new Set(preselected);

    const nav = crumbs([
      { text: "My path", onclick: () => renderHome() },
      { text: "Books", onclick: () => renderSetup() },
      { text: book.name, onclick: () => renderChapterPicker(bookId) },
      { text: `Chapter ${chapterNum}` }
    ]);

    const passageBox = el("div", { class: "passage" }, el("p", { class: "hint" }, "Loading chapter…"));
    const selectionLabel = el("div", { class: "selection-label" });
    const addBtn = el("button", { class: "btn btn-primary" }, "Add to my path");
    const status = el("div", { class: "form-status" });

    const prevBtn = el(
      "button",
      {
        class: "btn btn-ghost",
        onclick: () => renderVersePicker(bookId, chapterNum - 1)
      },
      "‹ Prev"
    );
    const nextBtn = el(
      "button",
      {
        class: "btn btn-ghost",
        onclick: () => renderVersePicker(bookId, chapterNum + 1)
      },
      "Next ›"
    );
    if (chapterNum <= 1) prevBtn.disabled = true;
    if (chapterNum >= book.chapters) nextBtn.disabled = true;

    const toolbar = el("div", { class: "passage-toolbar" }, [
      prevBtn,
      el("div", { class: "toolbar-center" }, [
        el("button", { class: "btn btn-ghost", onclick: () => setAll(true) }, "Select all"),
        el("button", { class: "btn btn-ghost", onclick: () => setAll(false) }, "Clear")
      ]),
      nextBtn
    ]);

    const footer = el("div", { class: "selection-footer" }, [selectionLabel, addBtn]);

    container.appendChild(
      el("div", { class: "screen screen-verses" }, [
        renderHeader(),
        nav,
        el("h2", {}, `${book.name} ${chapterNum}`),
        translationPicker(() => renderVersePicker(bookId, chapterNum, [...selected])),
        el(
          "p",
          { class: "hint" },
          "Tap verses to highlight them. Drag across verses, or Shift-click, to select a range."
        ),
        toolbar,
        passageBox,
        status,
        footer
      ])
    );

    let verses = [];
    const rows = new Map(); // verse number -> row element

    function refresh() {
      rows.forEach((row, n) => {
        const on = selected.has(n);
        row.classList.toggle("selected", on);
        row.querySelector("input").checked = on;
      });
      const count = selected.size;
      if (count) {
        selectionLabel.textContent = `${book.name} ${chapterNum}:${formatVerseList(selected)} · ${count} verse${
          count > 1 ? "s" : ""
        }`;
      } else {
        selectionLabel.textContent = "No verses selected";
      }
      addBtn.disabled = count === 0;
      footer.classList.toggle("has-selection", count > 0);
    }

    function setAll(on) {
      verses.forEach((v) => (on ? selected.add(v.verse) : selected.delete(v.verse)));
      refresh();
    }

    // Selection interactions: click toggles, shift-click selects a range,
    // press-and-drag paints (select or deselect, based on the first verse).
    let anchor = null;
    let dragMode = null; // true = selecting, false = deselecting

    function applyRange(a, b, on) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let n = lo; n <= hi; n++) {
        if (!rows.has(n)) continue;
        on ? selected.add(n) : selected.delete(n);
      }
    }

    // Touch/pen: a plain tap toggles (handled on click, so scrolling the
    // chapter with a finger doesn't accidentally select verses).
    function onRowClick(n, e) {
      if (e.pointerType === "mouse" || lastPointerType === "mouse") return;
      if (e.shiftKey && anchor !== null) applyRange(anchor, n, true);
      else selected.has(n) ? selected.delete(n) : selected.add(n);
      anchor = n;
      refresh();
    }

    let lastPointerType = null;
    function onRowPointerDown(n, e) {
      lastPointerType = e.pointerType;
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      if (e.shiftKey && anchor !== null) {
        applyRange(anchor, n, true);
        anchor = n;
        refresh();
        e.preventDefault();
        return;
      }
      dragMode = !selected.has(n);
      dragMode ? selected.add(n) : selected.delete(n);
      anchor = n;
      refresh();
      e.preventDefault(); // stop text selection while painting
    }

    function onRowPointerEnter(n) {
      if (dragMode === null) return;
      applyRange(anchor, n, dragMode);
      refresh();
    }

    const endDrag = () => {
      dragMode = null;
    };
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    addBtn.addEventListener("click", () => {
      const nums = [...selected].sort((a, b) => a - b);
      if (!nums.length) return;
      const translationId = Game.getState().translation;
      const allSelected = nums.length === verses.length;
      const label = allSelected
        ? `${book.name} ${chapterNum}`
        : `${book.name} ${chapterNum}:${formatVerseList(nums)}`;
      const lessonId = `verses:${book.id}:${chapterNum}:${nums.join(",")}:${translationId}`;
      Game.upsertLesson(lessonId, {
        label,
        kind: "verses",
        bookId: book.id,
        chapter: chapterNum,
        verses: nums,
        translationId,
        progress: (Game.getState().lessons[lessonId] || {}).progress || 0
      });
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      renderHome();
    });

    refresh();

    try {
      const data = await BibleAPI.fetchChapter(book.name, chapterNum, Game.getState().translation);
      verses = data.verses;
      clear(passageBox);
      verses.forEach((v) => {
        const checkbox = el("input", {
          type: "checkbox",
          class: "verse-check",
          tabindex: "-1",
          "aria-hidden": "true"
        });
        const row = el(
          "div",
          {
            class: "verse-row",
            role: "checkbox",
            tabindex: "0",
            "aria-label": `Verse ${v.verse}`
          },
          [checkbox, el("sup", { class: "verse-num" }, `${v.verse}`), el("span", { class: "verse-body" }, v.text)]
        );
        row.addEventListener("pointerdown", (e) => onRowPointerDown(v.verse, e));
        row.addEventListener("pointerenter", () => onRowPointerEnter(v.verse));
        row.addEventListener("click", (e) => onRowClick(v.verse, e));
        row.addEventListener("keydown", (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            selected.has(v.verse) ? selected.delete(v.verse) : selected.add(v.verse);
            anchor = v.verse;
            refresh();
          }
        });
        rows.set(v.verse, row);
        passageBox.appendChild(row);
      });
      // drop any preselected verses that don't exist in this translation
      [...selected].forEach((n) => rows.has(n) || selected.delete(n));
      refresh();
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      clear(passageBox);
      passageBox.appendChild(el("p", { class: "warning" }, `Couldn't load this chapter (${err.message}).`));
      passageBox.appendChild(
        el("button", { class: "btn btn-secondary", onclick: () => renderVersePicker(bookId, chapterNum) }, "Try again")
      );
    }
  }

  // -------------------------------------------------------- lesson screen
  async function openLesson(lessonId) {
    const lesson = Game.getState().lessons[lessonId];
    if (!lesson) return renderHome();

    if (lesson.kind === "book") {
      renderBookChapterPicker(lessonId, lesson);
      return;
    }

    const container = root();
    clear(container);
    container.appendChild(el("div", { class: "screen" }, [renderHeader(), el("p", {}, "Loading passage…")]));

    try {
      let data;
      if (lesson.kind === "verses") {
        // v0.21 lessons: fetch the whole chapter (cached) and keep the chosen verses
        const book = getBookById(lesson.bookId);
        const chapter = await BibleAPI.fetchChapter(book.name, lesson.chapter, lesson.translationId);
        const wanted = new Set(lesson.verses);
        const verses = chapter.verses.filter((v) => wanted.has(v.verse));
        data = { ...chapter, verses, fullText: verses.map((v) => v.text).join(" ") };
      } else {
        data = await BibleAPI.fetchPassage(lesson.reference, lesson.translationId);
      }
      runLessonSequence(lessonId, lesson.label, data, (finalAccuracy) => {
        Game.setLessonProgress(lessonId, Math.round(finalAccuracy * 100));
        renderHome();
      });
    } catch (err) {
      clear(container);
      container.appendChild(
        el("div", { class: "screen" }, [
          renderHeader(),
          el("p", {}, `Couldn't load this passage: ${err.message}`),
          el("button", { class: "btn", onclick: () => renderHome() }, "Back")
        ])
      );
    }
  }

  function renderBookChapterPicker(lessonId, lesson) {
    const container = root();
    clear(container);
    const book = getBookById(lesson.bookId);
    const nodes = [];
    for (let c = 1; c <= book.chapters; c++) {
      const prog = (lesson.chapterProgress || {})[c] || 0;
      nodes.push(
        el(
          "button",
          {
            class: `chapter-chip ${prog >= 100 ? "complete" : ""}`,
            onclick: () => openBookChapter(lessonId, c)
          },
          [el("div", {}, `${c}`), el("div", { class: "chip-progress" }, `${prog}%`)]
        )
      );
    }
    container.appendChild(
      el("div", { class: "screen" }, [
        renderHeader(),
        el("h2", {}, book.name),
        el("div", { class: "chapter-grid" }, nodes),
        el("button", { class: "btn btn-link", onclick: () => renderHome() }, "Back to path")
      ])
    );
  }

  async function openBookChapter(lessonId, chapterNum) {
    const lesson = Game.getState().lessons[lessonId];
    const book = getBookById(lesson.bookId);
    const container = root();
    clear(container);
    container.appendChild(el("div", { class: "screen" }, [renderHeader(), el("p", {}, "Loading chapter…")]));
    try {
      const data = await BibleAPI.fetchChapter(book.name, chapterNum, lesson.translationId);
      runLessonSequence(lessonId, `${book.name} ${chapterNum}`, data, (finalAccuracy) => {
        const cp = { ...(lesson.chapterProgress || {}) };
        cp[chapterNum] = Math.max(cp[chapterNum] || 0, Math.round(finalAccuracy * 100));
        const avg = Math.round(
          Object.values(cp).reduce((a, b) => a + b, 0) / book.chapters
        );
        Game.upsertLesson(lessonId, { chapterProgress: cp, progress: avg });
        renderBookChapterPicker(lessonId, Game.getState().lessons[lessonId]);
      });
    } catch (err) {
      clear(container);
      container.appendChild(
        el("div", { class: "screen" }, [
          renderHeader(),
          el("p", {}, `Couldn't load this chapter: ${err.message}`),
          el("button", { class: "btn", onclick: () => renderBookChapterPicker(lessonId, lesson) }, "Back")
        ])
      );
    }
  }

  // ------------------------------------------------- challenge sequencing
  // Splits long passages into rounds of up to `versesPerRound` verses so a
  // whole chapter isn't one overwhelming block.
  function chunkVerses(verses, versesPerRound = 4) {
    const rounds = [];
    for (let i = 0; i < verses.length; i += versesPerRound) {
      rounds.push(verses.slice(i, i + versesPerRound));
    }
    return rounds.length ? rounds : [verses];
  }

  function runLessonSequence(lessonId, label, passageData, onComplete) {
    const rounds = chunkVerses(passageData.verses);
    const challengeTypes = ["read", "fillblank", "typed", "spoken"];
    const plan = [];
    rounds.forEach((verseGroup) => {
      const text = verseGroup.map((v) => v.text).join(" ");
      challengeTypes.forEach((type) => plan.push({ type, text }));
    });

    let step = 0;
    let coinsEarned = 0;
    let accuracySum = 0;
    let accuracyCount = 0;

    function next() {
      if (step >= plan.length) {
        return showSummary();
      }
      const challenge = plan[step];
      step++;
      renderChallenge(challenge, label, (accuracy, coins) => {
        coinsEarned += coins;
        if (accuracy !== null) {
          accuracySum += accuracy;
          accuracyCount++;
        }
        Game.addCoins(coins);
        next();
      });
    }

    function showSummary() {
      Game.bumpStreak();
      const finalAccuracy = accuracyCount ? accuracySum / accuracyCount : 1;
      const container = root();
      clear(container);
      container.appendChild(
        el("div", { class: "screen screen-summary" }, [
          renderHeader(),
          el("h2", {}, "Lesson complete! 🎉"),
          el("p", {}, `${label}`),
          el("p", { class: "summary-stat" }, `Coins earned: ${fmtCoins(coinsEarned)}`),
          el("p", { class: "summary-stat" }, `Accuracy: ${Math.round(finalAccuracy * 100)}%`),
          el("button", { class: "btn btn-primary", onclick: () => onComplete(finalAccuracy) }, "Continue")
        ])
      );
    }

    next();
  }

  function progressDots(step, total) {
    const dots = [];
    for (let i = 0; i < total; i++) {
      dots.push(el("span", { class: `dot ${i < step ? "dot-done" : ""}` }));
    }
    return el("div", { class: "dots" }, dots);
  }

  function renderChallenge(challenge, label, onDone) {
    const container = root();
    clear(container);
    const wrap = el("div", { class: "screen screen-challenge" }, [renderHeader(), el("h3", {}, label)]);
    container.appendChild(wrap);

    if (challenge.type === "read") return renderReadChallenge(wrap, challenge, onDone);
    if (challenge.type === "fillblank") return renderFillBlankChallenge(wrap, challenge, onDone);
    if (challenge.type === "typed") return renderTypedChallenge(wrap, challenge, onDone);
    if (challenge.type === "spoken") return renderSpokenChallenge(wrap, challenge, onDone);
  }

  function renderReadChallenge(wrap, challenge, onDone) {
    wrap.appendChild(el("p", { class: "challenge-instructions" }, "Read it a few times, then continue."));
    wrap.appendChild(el("blockquote", { class: "verse-text" }, challenge.text));
    wrap.appendChild(
      el("button", { class: "btn btn-primary", onclick: () => onDone(null, 2) }, "I've got it")
    );
  }

  function renderFillBlankChallenge(wrap, challenge, onDone) {
    const { displayTokens, answerKey } = Challenges.makeFillBlank(challenge.text);
    wrap.appendChild(el("p", { class: "challenge-instructions" }, "Fill in the missing words."));

    const inputs = {};
    const line = el("div", { class: "fillblank-line" });
    displayTokens.forEach((tok) => {
      if (tok.blank) {
        const input = el("input", { class: "blank-input", type: "text", size: "8" });
        inputs[tok.index] = input;
        line.appendChild(input);
      } else {
        line.appendChild(document.createTextNode(tok.text + " "));
      }
    });
    wrap.appendChild(line);

    const feedback = el("div", { class: "feedback" });
    wrap.appendChild(feedback);

    wrap.appendChild(
      el(
        "button",
        {
          class: "btn btn-primary",
          onclick: () => {
            const userAnswers = {};
            Object.entries(inputs).forEach(([idx, input]) => {
              userAnswers[idx] = input.value;
            });
            const result = Challenges.gradeFillBlank(answerKey, userAnswers);
            Object.entries(inputs).forEach(([idx, input]) => {
              input.classList.add(result.results[idx] ? "correct" : "incorrect");
              input.disabled = true;
            });
            feedback.textContent = `${result.correct}/${result.total} correct`;
            const coins = Challenges.coinsForAccuracy(result.accuracy, 8);
            setTimeout(() => onDone(result.accuracy, coins), 900);
          }
        },
        "Check"
      )
    );
  }

  function renderTypedChallenge(wrap, challenge, onDone) {
    wrap.appendChild(el("p", { class: "challenge-instructions" }, "Type this passage from memory."));
    const textarea = el("textarea", { class: "typed-input", rows: "4" });
    wrap.appendChild(textarea);
    const feedback = el("div", { class: "feedback" });
    wrap.appendChild(feedback);

    wrap.appendChild(
      el(
        "button",
        {
          class: "btn btn-primary",
          onclick: () => {
            const result = Challenges.gradeTyped(challenge.text, textarea.value);
            feedback.innerHTML = "";
            feedback.appendChild(renderDiff(result.diff, challenge.text));
            feedback.appendChild(
              el("p", { class: "accuracy-line" }, `Accuracy: ${Math.round(result.accuracy * 100)}%`)
            );
            textarea.disabled = true;
            const coins = Challenges.coinsForAccuracy(result.accuracy, 15);
            const btn = wrap.querySelector(".btn-primary");
            btn.textContent = "Continue";
            btn.onclick = () => onDone(result.accuracy, coins);
          }
        },
        "Check"
      )
    );
  }

  function renderDiff(diff, referenceText) {
    const refWords = Challenges.tokenize(referenceText);
    const spanWrap = el("div", { class: "diff-line" });
    diff.forEach((d, i) => {
      const word = refWords[i] ?? d.given ?? "";
      spanWrap.appendChild(
        el("span", { class: `diff-word ${d.correct ? "diff-correct" : "diff-wrong"}` }, word + " ")
      );
    });
    return spanWrap;
  }

  function renderSpokenChallenge(wrap, challenge, onDone) {
    wrap.appendChild(el("p", { class: "challenge-instructions" }, "Say this passage out loud."));
    wrap.appendChild(el("blockquote", { class: "verse-text faint" }, challenge.text));

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const feedback = el("div", { class: "feedback" });

    if (!SpeechRecognition) {
      wrap.appendChild(
        el("p", { class: "warning" }, "Speech recognition isn't supported in this browser — skipping to text entry.")
      );
      return renderTypedChallenge(wrap, challenge, onDone);
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const recordBtn = el("button", { class: "btn btn-primary" }, "🎙️ Start speaking");
    wrap.appendChild(recordBtn);
    wrap.appendChild(feedback);

    recordBtn.addEventListener("click", () => {
      recordBtn.disabled = true;
      recordBtn.textContent = "Listening…";
      recognition.start();
    });

    recognition.addEventListener("result", (event) => {
      const transcript = event.results[0][0].transcript;
      const result = Challenges.gradeSpoken(challenge.text, transcript);
      feedback.innerHTML = "";
      feedback.appendChild(el("p", {}, `Heard: "${transcript}"`));
      feedback.appendChild(renderDiff(result.diff, challenge.text));
      feedback.appendChild(
        el("p", { class: "accuracy-line" }, `Accuracy: ${Math.round(result.accuracy * 100)}%`)
      );
      const coins = Challenges.coinsForAccuracy(result.accuracy, 15);
      recordBtn.textContent = "Continue";
      recordBtn.disabled = false;
      recordBtn.onclick = () => onDone(result.accuracy, coins);
    });

    recognition.addEventListener("error", (event) => {
      feedback.textContent = `Mic error (${event.error}). You can try again or type it instead.`;
      recordBtn.disabled = false;
      recordBtn.textContent = "🎙️ Try again";
    });
  }

  return { renderHome, renderSetup, openLesson };
})();

window.UI = UI;
