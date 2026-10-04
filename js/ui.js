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
        el("span", { class: "stat xp", title: "Points" }, `⚡ ${state.xp || 0}`),
        el("span", { class: "stat coins", title: "Coins" }, fmtCoins(state.coins)),
        el("span", { class: "stat streak", title: "Day streak" }, `🔥 ${state.streak.count}`),
        el(
          "button",
          { class: "stat stat-btn", title: "Settings", "aria-label": "Settings", onclick: () => renderSettings() },
          "⚙️"
        )
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
        reviewCard(),
        el("h2", { class: "path-heading" }, "Your path"),
        el("div", { class: "path" }, nodes),
        el(
          "button",
          { class: "btn btn-primary btn-add", onclick: () => renderSetup() },
          "+ Add a passage"
        ),
        el("button", { class: "btn btn-ghost btn-block science-link", onclick: () => renderScience() }, "🧠 How Verses helps you remember")
      ])
    );
  }

  // Spaced-review status: the most important thing on the home screen,
  // because spreading practice over days is what makes verses last.
  function reviewCard() {
    const total = Game.reviewCount();
    const due = Game.dueReviews().length;
    if (!total) {
      return el("section", { class: "review-banner idle" }, [
        el("strong", {}, "🧠 Spaced review"),
        el("small", {}, "Finish a verse and it is scheduled for review tomorrow, then days and weeks later. That is how it sticks for good.")
      ]);
    }
    if (!due) {
      const next = Game.nextDueDate();
      return el("section", { class: "review-banner caught-up" }, [
        el("strong", {}, "✅ All caught up"),
        el("small", {}, `${total} verse${total === 1 ? "" : "s"} in your review plan · next review ${Spacing.describeDue(next, Game.todayStr())}`)
      ]);
    }
    return el("section", { class: "review-banner due" }, [
      el("div", {}, [
        el("strong", {}, `🧠 Daily review · ${due} verse${due === 1 ? "" : "s"} due`),
        el("small", {}, "Short and effective: say each verse from memory. The 5 minutes that matter most.")
      ]),
      el("button", { class: "btn btn-primary", onclick: () => Lesson.startDailyReview(renderHome) }, "Start review")
    ]);
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
        el("div", { class: "path-node-title" }, [
          lesson.label,
          Game.dueCountForLesson(lesson.id) ? el("span", { class: "due-badge" }, `${Game.dueCountForLesson(lesson.id)} due`) : null
        ]),
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
  // v0.22: the lesson flow lives in js/lesson.js.
  function openLesson(lessonId) {
    Lesson.open(lessonId);
  }

  // ------------------------------------------------------------- settings
  function renderSettings(onBack = renderHome) {
    const container = root();
    clear(container);
    const s = Game.getSettings();

    const voiceSelect = el("select", { class: "translation-select", "aria-label": "Voice" });
    function fillVoices() {
      clear(voiceSelect);
      const list = Speech.listVoices();
      voiceSelect.appendChild(
        el("option", { value: "" }, list.length ? `Automatic — best available (${list[0].name})` : "Automatic")
      );
      list.forEach((v, i) => {
        const opt = el("option", { value: v.name }, `${i < 3 ? "★ " : ""}${v.name} (${v.lang})`);
        if (v.name === Game.getSettings().voiceName) opt.selected = true;
        voiceSelect.appendChild(opt);
      });
    }
    fillVoices();
    const unsub = Speech.onVoicesChanged(fillVoices);
    voiceSelect.addEventListener("change", () => Game.updateSettings({ voiceName: voiceSelect.value }));

    const rateLabel = el("span", { class: "range-value" }, `${s.voiceRate.toFixed(2)}×`);
    const rate = el("input", { type: "range", min: "0.6", max: "1.3", step: "0.05", value: String(s.voiceRate) });
    rate.addEventListener("input", () => {
      Game.updateSettings({ voiceRate: parseFloat(rate.value) });
      rateLabel.textContent = `${parseFloat(rate.value).toFixed(2)}×`;
    });

    const toggle = (key, label, sub) => {
      const box = el("input", { type: "checkbox" });
      box.checked = !!Game.getSettings()[key];
      box.addEventListener("change", () => Game.updateSettings({ [key]: box.checked }));
      return el("label", { class: "toggle-row" }, [
        box,
        el("span", {}, [el("strong", {}, label), el("small", {}, sub)])
      ]);
    };

    const back = () => {
      unsub();
      Speech.stop();
      onBack();
    };

    container.appendChild(
      el("div", { class: "screen screen-settings" }, [
        renderHeader(),
        crumbs([{ text: "My path", onclick: back }, { text: "Settings" }]),
        el("h2", {}, "Settings"),
        el("section", { class: "settings-card" }, [
          el("h3", {}, "🔊 Listening voice"),
          Speech.canSpeak()
            ? el("div", {}, [
                voiceSelect,
                el("div", { class: "range-row" }, [el("span", {}, "Speed"), rate, rateLabel]),
                el(
                  "button",
                  {
                    class: "btn btn-secondary",
                    onclick: () => Speech.speak("The Lord is my shepherd; I shall not want.")
                  },
                  "▶ Test voice"
                ),
                el(
                  "p",
                  { class: "hint small" },
                  "Tip: Microsoft Edge has the most natural free voices (look for “Natural”). On iPhone or Mac, download an “Enhanced” or “Premium” voice in Settings › Accessibility › Spoken Content, and it will show up here."
                )
              ])
            : el("p", { class: "warning" }, "This browser can't read text aloud.")
        ]),
        el("section", { class: "settings-card" }, [
          el("h3", {}, "🎙️ Practice"),
          toggle("speakFirst", "Answer by speaking", "Saying a verse out loud helps it stick. You can always switch to typing."),
          toggle("autoListen", "Read verses aloud automatically", "Plays the verse when it's first shown in a lesson.")
        ]),
        el("button", { class: "btn btn-secondary btn-block", onclick: () => renderScience(() => renderSettings(onBack)) }, "🧠 How Verses helps you remember"),
        el("button", { class: "btn btn-primary btn-block", onclick: back }, "Done")
      ])
    );
  }

  // ------------------------------------------------------- how it works
  const TECHNIQUES = [
    {
      icon: "🎯",
      name: "Pull it out, don't just read it",
      why: "Trying to recall something strengthens memory far more than re-reading it, even when you get it wrong (the testing effect).",
      how: "Every exercise asks you to produce the words, and shrinking clues (blanks, first letters, then nothing) lead to full recall."
    },
    {
      icon: "🗓️",
      name: "Spread it over days",
      why: "The same practice split across days beats one long session by a wide margin (the spacing effect). Cramming feels good and fades fast.",
      how: "Finish a verse and it is scheduled for review tomorrow, then in 3, 7, 14, 30 days and beyond. A clean recall stretches the gap; a miss brings it back sooner."
    },
    {
      icon: "🌙",
      name: "Sleep on it",
      why: "Sleep turns fresh memories into lasting ones. A verse learned in the evening and recalled the next morning is far more durable.",
      how: "The first review is always the next day. Learning a verse right before bed, then reviewing it in the morning, is a great pattern."
    },
    {
      icon: "🗣️",
      name: "Say it out loud",
      why: "Words you speak are remembered better than words you only read or type (the production effect).",
      how: "Speaking is the default way to answer, and the read step asks you to say the verse aloud."
    },
    {
      icon: "🧩",
      name: "Chunk it",
      why: "Short working memory copes by grouping. Phrases are easier to hold than a long string of words.",
      how: "Verses show in natural phrases, and long ones are built up part by part (parts 1, then 1–2, then 1–3)."
    },
    {
      icon: "💭",
      name: "Make it meaningful",
      why: "Thinking about what words mean, picturing them, or tying them to your life makes them stick far better than parroting (elaboration).",
      how: "A short “make it meaningful” step prompts you to picture it or put it in your own words. Your note comes back at review time."
    },
    {
      icon: "📍",
      name: "Learn the address too",
      why: "Knowing where a verse lives lets you find it, share it, and recall it on cue.",
      how: "Each verse shows its reference, has a “where is this?” question, and recall exercises ask you to say the reference first."
    },
    {
      icon: "🔀",
      name: "Mix it up",
      why: "Reviewing different things in a mixed order is harder, and builds more flexible, longer-lasting memory (interleaving).",
      how: "Daily review mixes verses from all your passages in random order."
    },
    {
      icon: "🎯",
      name: "Fix the tricky spots",
      why: "Most forgetting clusters on a few words. Targeted correction beats going over everything again.",
      how: "Words you miss are collected and drilled together right before the final recall."
    },
    {
      icon: "💪",
      name: "Make it a little hard",
      why: "Effortful recall that you sometimes miss builds stronger memory than easy recall (“desirable difficulty”). Peeking early robs you of that effect.",
      how: "A hint can be the next words or your own word picture (your note), and any hint during review means the verse comes back sooner."
    }
  ];

  function renderScience(onBack = renderHome) {
    const container = root();
    clear(container);
    container.appendChild(
      el("div", { class: "screen screen-science" }, [
        renderHeader(),
        crumbs([{ text: "Back", onclick: onBack }, { text: "How it works" }]),
        el("h2", {}, "How Verses helps you remember"),
        el("p", { class: "hint" }, "Everything in the app comes from what memory research shows works best."),
        ...TECHNIQUES.map((t) =>
          el("section", { class: "settings-card technique" }, [
            el("h3", {}, `${t.icon} ${t.name}`),
            el("p", { class: "why" }, t.why),
            el("p", { class: "how" }, [el("strong", {}, "In Verses: "), t.how])
          ])
        ),
        el("section", { class: "settings-card technique tips" }, [
          el("h3", {}, "✨ Your best habits"),
          el("ul", {}, [
            el("li", {}, "A little every day beats a lot once a week. Aim for 10 minutes."),
            el("li", {}, "Do your daily review first, then learn something new."),
            el("li", {}, "Attach it to a habit you already have: coffee, commute, bedtime."),
            el("li", {}, "Learn only a few new verses at a time, and let each settle for a night or two."),
            el("li", {}, "Say your verses to a friend, or while walking. Use them in prayer, and teach one to someone.")
          ])
        ]),
        el("button", { class: "btn btn-primary btn-block", onclick: onBack }, "Got it")
      ])
    );
  }

  return { formatVerseList, renderScience, renderHome, renderSetup, renderSettings, openLesson, el, clear, root, renderHeader, fmtCoins };
})();

window.UI = UI;
