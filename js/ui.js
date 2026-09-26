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
      el("div", { class: "brand" }, "📖 Verse Quest"),
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
    const node = el("div", { class: "path-node-wrap", style: index % 2 ? "margin-left:70px" : "" }, [
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
        el("div", { class: "progress-bar" }, [
          el("div", { class: "progress-bar-fill", style: `width:${progress}%` })
        ])
      ])
    ]);
    return node;
  }

  // --------------------------------------------------------- setup screen
  function renderSetup() {
    const container = root();
    clear(container);
    const state = Game.getState();

    const translationSelect = el(
      "select",
      { id: "sel-translation" },
      TRANSLATIONS.map((t) =>
        el("option", { value: t.id, ...(t.id === state.translation ? { selected: "selected" } : {}) }, t.name)
      )
    );

    const scopeSelect = el("select", { id: "sel-scope" }, [
      el("option", { value: "verse" }, "Single verse"),
      el("option", { value: "passage" }, "Multiple verses"),
      el("option", { value: "chapter" }, "Whole chapter"),
      el("option", { value: "book" }, "Whole book (one lesson per chapter)")
    ]);

    const bookSelect = el(
      "select",
      { id: "sel-book" },
      BIBLE_BOOKS.map((b) => el("option", { value: b.id }, b.name))
    );

    const chapterSelect = el("select", { id: "sel-chapter" });
    const verseRow = el("div", { class: "form-row", id: "verse-row" }, [
      el("label", {}, "Verse(s)"),
      el("input", { type: "number", id: "inp-verse-start", min: "1", value: "1", class: "verse-input" }),
      el("span", {}, " to "),
      el("input", { type: "number", id: "inp-verse-end", min: "1", value: "1", class: "verse-input" })
    ]);

    function populateChapters() {
      const book = getBookById(bookSelect.value);
      clear(chapterSelect);
      for (let c = 1; c <= book.chapters; c++) {
        chapterSelect.appendChild(el("option", { value: String(c) }, `Chapter ${c}`));
      }
    }
    populateChapters();
    bookSelect.addEventListener("change", populateChapters);

    function syncScopeVisibility() {
      const scope = scopeSelect.value;
      chapterSelect.parentElement.style.display = scope === "book" ? "none" : "";
      verseRow.style.display = scope === "verse" || scope === "passage" ? "" : "none";
    }
    scopeSelect.addEventListener("change", syncScopeVisibility);

    const chapterRow = el("div", { class: "form-row" }, [el("label", {}, "Chapter"), chapterSelect]);

    const status = el("div", { class: "form-status" });

    const addBtn = el(
      "button",
      {
        class: "btn btn-primary",
        onclick: () => handleAdd()
      },
      "Add to my path"
    );

    async function handleAdd() {
      addBtn.disabled = true;
      status.textContent = "Loading passage…";
      try {
        const translationId = translationSelect.value;
        Game.setTranslation(translationId);
        const scope = scopeSelect.value;
        const book = getBookById(bookSelect.value);

        if (scope === "book") {
          const lessonId = `book:${book.id}:${translationId}`;
          Game.upsertLesson(lessonId, {
            label: book.name,
            kind: "book",
            bookId: book.id,
            translationId,
            progress: 0,
            chapterProgress: {}
          });
        } else if (scope === "chapter") {
          const chapter = chapterSelect.value;
          const data = await BibleAPI.fetchChapter(book.name, chapter, translationId);
          const lessonId = `chapter:${book.id}:${chapter}:${translationId}`;
          Game.upsertLesson(lessonId, {
            label: `${book.name} ${chapter}`,
            kind: "single",
            reference: data.reference,
            translationId,
            progress: 0
          });
        } else {
          const chapter = chapterSelect.value;
          const vStart = parseInt(document.getElementById("inp-verse-start").value, 10) || 1;
          const vEnd =
            scope === "verse" ? vStart : parseInt(document.getElementById("inp-verse-end").value, 10) || vStart;
          const data = await BibleAPI.fetchVerseRange(book.name, chapter, vStart, vEnd, translationId);
          const lessonId = `verse:${book.id}:${chapter}:${vStart}-${vEnd}:${translationId}`;
          Game.upsertLesson(lessonId, {
            label: `${book.name} ${chapter}:${vStart}${vEnd !== vStart ? "-" + vEnd : ""}`,
            kind: "single",
            reference: data.reference,
            translationId,
            progress: 0
          });
        }
        renderHome();
      } catch (err) {
        console.error(err);
        status.textContent = `Couldn't load that passage (${err.message}). Try again.`;
        addBtn.disabled = false;
      }
    }

    syncScopeVisibility();

    container.appendChild(
      el("div", { class: "screen screen-setup" }, [
        renderHeader(),
        el("h2", {}, "Choose a passage"),
        el("div", { class: "form-row" }, [el("label", {}, "Translation"), translationSelect]),
        el("div", { class: "form-row" }, [el("label", {}, "Memorize"), scopeSelect]),
        el("div", { class: "form-row" }, [el("label", {}, "Book"), bookSelect]),
        chapterRow,
        verseRow,
        status,
        addBtn,
        el("button", { class: "btn btn-link", onclick: () => renderHome() }, "Cancel")
      ])
    );
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
      const data = await BibleAPI.fetchPassage(lesson.reference, lesson.translationId);
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
