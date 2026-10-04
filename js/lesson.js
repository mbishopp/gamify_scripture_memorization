/* Lesson flow (v0.22, memory-science pass in v0.24).

   A passage is split into small "units" (usually one verse; very short
   verses are merged). Each unit is a mini-lesson of 10+ exercises that
   builds from easy (listen, word tiles, a few blanks) to hard (say the
   whole verse from memory). Passages with several units finish with a
   "Review all" unit.

   Every graded exercise supports:
     - Try again: 1st retry earns 80% of the points, 2nd 60%, 3rd+ 30%
     - Try again at full points by paying coins (20 / 40 / 60)
     - Skip (always available, earns nothing)
     - Hints on the recall exercises (reveal the first couple of words)

   v0.24 adds the pieces that make memory last:
     - Spaced review: finishing a unit schedules it for tomorrow, then
       3 / 7 / 14 / 30 ... days. startDailyReview() quizzes whatever is due,
       mixing verses from different passages (interleaving), retrieval first
       (cold recall from just the address), scaffolding only if it fails.
     - Tricky words: words missed earlier in a unit are drilled again
       right before the final recall.
     - Reference practice, "think about it" step, chunked display. */

const Lesson = (() => {
  const { el, clear, root, renderHeader, fmtCoins } = UI;

  // ------------------------------------------------------------ helpers
  function instr(text) {
    return el("p", { class: "challenge-instructions" }, text);
  }

  function screenMessage(message, backLabel, back) {
    const c = root();
    clear(c);
    c.appendChild(
      el("div", { class: "screen" }, [
        renderHeader(),
        el("p", {}, message),
        back ? el("button", { class: "btn btn-secondary", onclick: back }, backLabel) : null
      ])
    );
  }

  function listenButton(text, label = "🔊 Listen") {
    if (!Speech.canSpeak()) return null;
    const btn = el("button", { class: "btn btn-listen", type: "button" }, label);
    let playing = false;
    const reset = () => {
      playing = false;
      btn.textContent = label;
    };
    btn.addEventListener("click", () => {
      if (playing) {
        Speech.stop();
        reset();
        return;
      }
      playing = true;
      btn.textContent = "⏹ Stop";
      Speech.speak(text, { onend: reset });
    });
    return btn;
  }

  function diffNode(diff) {
    return el(
      "div",
      { class: "diff-line" },
      diff.map((d) => el("span", { class: `diff-word ${d.correct ? "diff-correct" : "diff-wrong"}` }, d.text + " "))
    );
  }

  function correctAnswer(text) {
    return el("div", { class: "correct-answer" }, [el("span", { class: "label" }, "Correct: "), text]);
  }

  function randomOf(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // --------------------------------------------------------- opening
  async function open(lessonId) {
    const lesson = Game.getState().lessons[lessonId];
    if (!lesson) return UI.renderHome();
    if (lesson.kind === "book") return renderBookChapters(lessonId);

    screenMessage("Loading passage…");
    try {
      let verses;
      if (lesson.kind === "verses") {
        const book = getBookById(lesson.bookId);
        const chapter = await BibleAPI.fetchChapter(book.name, lesson.chapter, lesson.translationId);
        const wanted = new Set(lesson.verses);
        verses = chapter.verses.filter((v) => wanted.has(v.verse));
      } else {
        verses = (await BibleAPI.fetchPassage(lesson.reference, lesson.translationId)).verses;
      }
      if (!verses.length) throw new Error("no verses found");
      const refBase = lesson.kind === "verses" ? `${getBookById(lesson.bookId).name} ${lesson.chapter}` : null;
      const rounds = buildRounds(verses, refBase);
      renderUnits({
        lessonId,
        title: lesson.label,
        translationId: lesson.translationId,
        rounds,
        prefix: "",
        back: UI.renderHome,
        recompute: () => Game.setLessonProgress(lessonId, averageUnits(lessonId, rounds, ""))
      });
    } catch (err) {
      console.error(err);
      screenMessage(`Couldn't load this passage: ${err.message}`, "Back", UI.renderHome);
    }
  }

  function renderBookChapters(lessonId) {
    const lesson = Game.getState().lessons[lessonId];
    const book = getBookById(lesson.bookId);
    const c = root();
    clear(c);
    const chips = [];
    for (let n = 1; n <= book.chapters; n++) {
      const prog = (lesson.chapterProgress || {})[n] || 0;
      chips.push(
        el(
          "button",
          { class: `chapter-chip ${prog >= 100 ? "complete" : ""}`, onclick: () => openBookChapter(lessonId, n) },
          [el("div", {}, `${n}`), el("div", { class: "chip-progress" }, `${prog}%`)]
        )
      );
    }
    c.appendChild(
      el("div", { class: "screen" }, [
        renderHeader(),
        el("button", { class: "btn btn-ghost back-link", onclick: UI.renderHome }, "‹ My path"),
        el("h2", {}, book.name),
        el("p", { class: "hint" }, "Pick a chapter to practice."),
        el("div", { class: "chapter-grid" }, chips)
      ])
    );
  }

  async function openBookChapter(lessonId, chapterNum) {
    const lesson = Game.getState().lessons[lessonId];
    const book = getBookById(lesson.bookId);
    screenMessage("Loading chapter…");
    try {
      const data = await BibleAPI.fetchChapter(book.name, chapterNum, lesson.translationId);
      const rounds = buildRounds(data.verses, `${book.name} ${chapterNum}`);
      const prefix = `c${chapterNum}:`;
      renderUnits({
        lessonId,
        title: `${book.name} ${chapterNum}`,
        translationId: lesson.translationId,
        rounds,
        prefix,
        back: () => renderBookChapters(lessonId),
        recompute: () => {
          const l = Game.getState().lessons[lessonId];
          const cp = { ...(l.chapterProgress || {}) };
          cp[chapterNum] = Math.max(cp[chapterNum] || 0, averageUnits(lessonId, rounds, prefix));
          const progress = Math.round(Object.values(cp).reduce((a, b) => a + b, 0) / book.chapters);
          Game.upsertLesson(lessonId, { chapterProgress: cp, progress });
        }
      });
    } catch (err) {
      console.error(err);
      screenMessage(`Couldn't load this chapter: ${err.message}`, "Back", () => renderBookChapters(lessonId));
    }
  }

  // ----------------------------------------------------------- units
  // Group verses into small units: consecutive short verses are merged
  // (up to 3 verses / ~45 words); everything else is one verse per unit.
  // `refBase` ("John 3") lets every unit know its address ("John 3:16").
  function buildRounds(verses, refBase = null) {
    const groups = [];
    let cur = [];
    let words = 0;
    verses.forEach((v) => {
      const w = Challenges.tokenize(v.text).length;
      const last = cur[cur.length - 1];
      const canMerge = last && v.verse === last.verse + 1 && words < 12 && cur.length < 3 && words + w <= 45;
      if (cur.length && !canMerge) {
        groups.push(cur);
        cur = [];
        words = 0;
      }
      cur.push(v);
      words += w;
    });
    if (cur.length) groups.push(cur);

    const rounds = groups.map((g) => {
      const a = g[0].verse;
      const b = g[g.length - 1].verse;
      return {
        key: a === b ? `v${a}` : `v${a}-${b}`,
        label: a === b ? `Verse ${a}` : `Verses ${a}–${b}`,
        ref: refBase ? `${refBase}:${a === b ? a : `${a}-${b}`}` : null,
        verses: g,
        text: g.map((v) => v.text).join(" ")
      };
    });
    if (rounds.length >= 2 && rounds.length <= 6) {
      rounds.push({
        key: "review",
        label: "Review all",
        review: true,
        ref: refBase ? `${refBase}:${UI.formatVerseList(verses.map((v) => v.verse))}` : null,
        verses,
        text: verses.map((v) => v.text).join(" ")
      });
    }
    return rounds;
  }

  function averageUnits(lessonId, rounds, prefix) {
    const sum = rounds.reduce((a, r) => a + Game.getUnitProgress(lessonId, prefix + r.key), 0);
    return Math.round(sum / rounds.length);
  }

  function renderUnits(opts) {
    const { lessonId, title, rounds, prefix, back } = opts;
    if (rounds.length === 1) return startRound(opts, rounds[0], back);

    const c = root();
    clear(c);
    const nextIdx = rounds.findIndex((r) => Game.getUnitProgress(lessonId, prefix + r.key) < 80);
    const offsets = [0, 40, 70, 40];

    const nodes = rounds.map((r, i) => {
      const p = Game.getUnitProgress(lessonId, prefix + r.key);
      const current = i === nextIdx;
      const icon = p >= 100 ? "⭐" : r.review ? "🏆" : current ? "▶" : p > 0 ? "📖" : "📘";
      const preview = r.review
        ? "Put it all together"
        : Challenges.tokenize(r.text).slice(0, 7).join(" ") + "…";
      return el("div", { class: `path-node-wrap ${current ? "current" : ""}`, style: `margin-left:${offsets[i % 4]}px` }, [
        el(
          "button",
          {
            class: `path-node ${p >= 100 ? "complete" : ""} ${r.review ? "review" : ""}`,
            "aria-label": `Start ${r.label}`,
            onclick: () => startRound(opts, r, () => renderUnits(opts))
          },
          el("span", { class: "path-node-icon" }, icon)
        ),
        el("div", { class: "path-node-label" }, [
          el("div", { class: "path-node-title" }, r.label),
          el("div", { class: "path-node-meta" }, `${preview} · ${p}%`),
          el("div", { class: "progress-bar" }, [el("div", { class: "progress-bar-fill", style: `width:${p}%` })])
        ])
      ]);
    });

    const startIdx = nextIdx === -1 ? 0 : nextIdx;
    c.appendChild(
      el("div", { class: "screen screen-units" }, [
        renderHeader(),
        el("button", { class: "btn btn-ghost back-link", onclick: back }, "‹ Back"),
        el("h2", {}, title),
        el(
          "p",
          { class: "hint" },
          "Each step is a short lesson. Learn them in order, then review everything together."
        ),
        el("div", { class: "path" }, nodes),
        el(
          "button",
          {
            class: "btn btn-primary btn-block",
            onclick: () => startRound(opts, rounds[startIdx], () => renderUnits(opts))
          },
          nextIdx === -1 ? "Practice again" : `Start: ${rounds[startIdx].label}`
        )
      ])
    );
  }

  function startRound(opts, round, after) {
    const title = opts.rounds.length > 1 ? `${opts.title} · ${round.label}` : opts.title;
    const unitId = `${opts.lessonId}|${opts.prefix}${round.key}`;
    runRound(round, {
      title,
      unitId,
      lessonId: opts.lessonId,
      translationId: opts.translationId,
      note: (Game.getReview(unitId) || {}).note || "",
      thinkIdx: opts.rounds.indexOf(round),
      onQuit: after,
      onFinish: (pct) => {
        Game.setUnitProgress(opts.lessonId, opts.prefix + round.key, pct);
        opts.recompute();
        after();
      }
    });
  }

  // ----------------------------------------------------------- a round
  function runRound(round, rctx) {
    const exercises = round.review
      ? Challenges.buildReviewLadder(round.verses.map((v) => v.text), round.ref)
      : Challenges.buildLadder(round.text, { ref: round.ref, think: rctx.thinkIdx || 0 });
    const session = {
      preferType: !Game.getSettings().speakFirst || !Speech.canListen(),
      autoPlayed: false
    };
    const tally = { xp: 0, max: 0, coins: 0, spent: 0, skipped: 0 };
    const misses = new Set(); // words tripped over in this unit
    const info = { recall: null, note: "" };
    let weakAdded = false;
    let idx = 0;

    function quit() {
      Speech.stop();
      if (confirm("Quit this lesson? Points you've earned so far are kept, but the lesson won't count as finished.")) {
        rctx.onQuit();
      }
    }

    function next() {
      if (idx >= exercises.length) return summary();
      // Adaptive step: drill the exact words missed so far, once, right
      // before the final recall.
      if (exercises[idx].final && misses.size && !weakAdded) {
        weakAdded = true;
        const text = exercises[idx].text;
        exercises.splice(idx, 0, { type: "blanks", text, ratio: 0.2, force: [...misses], bank: false, weak: true, base: 15 });
      }
      const ex = exercises[idx];
      const ctx = { title: rctx.title, idx, total: exercises.length, session, tally, quit, misses, note: rctx.note };
      runExercise(ex, ctx, (res) => {
        if (ex.base) {
          tally.max += ex.base;
          tally.xp += res.xp || 0;
          tally.coins += res.coins || 0;
          if (res.skipped) tally.skipped++;
        }
        if (ex.type === "think" && res.note) {
          info.note = res.note;
          rctx.note = res.note; // available as a hint for the rest of this unit
        }
        if (ex.final && ex.type === "recall" && !res.skipped && res.firstAccuracy !== null) {
          info.recall = { accuracy: res.firstAccuracy, hinted: res.hinted };
        }
        idx++;
        next();
      });
    }

    function summary() {
      Speech.stop();
      Game.bumpStreak();
      const bonus = Challenges.SCORING.roundBonusCoins;
      Game.addCoins(bonus);
      tally.coins += bonus;
      const pct = tally.max ? Math.round((tally.xp / tally.max) * 100) : 100;
      const headline =
        pct >= 90 ? "Excellent! 🎉" : pct >= 60 ? "Well done! 👏" : "Good practice! 💪";
      const sub =
        pct >= 90
          ? "You've got this one."
          : pct >= 60
          ? "Run it once more to lock it in."
          : "Try it again — it gets easier every time.";
      if (info.recall && !round.review) {
        // schedule now (not on "Continue") so the card below shows the real date
        Game.registerUnit(
          rctx.unitId,
          { lessonId: rctx.lessonId, label: round.ref || rctx.title, ref: round.ref, text: round.text, translationId: rctx.translationId, ...(info.note ? { note: info.note } : {}) },
          info.recall.accuracy,
          info.recall.hinted
        );
      }
      const scheduled = info.recall && !round.review ? Game.getReview(rctx.unitId) : null;
      const c = root();
      clear(c);
      c.appendChild(
        el("div", { class: "screen screen-summary" }, [
          renderHeader(),
          el("div", { class: "summary-hero" }, [el("h2", {}, headline), el("p", { class: "hint" }, rctx.title)]),
          el("div", { class: "summary-cards" }, [
            el("div", { class: "summary-card xp" }, [el("small", {}, "Points"), el("strong", {}, `⚡ ${tally.xp}`)]),
            el("div", { class: "summary-card coins" }, [
              el("small", {}, "Coins"),
              el("strong", {}, `🪙 +${tally.coins}${tally.spent ? ` / −${tally.spent}` : ""}`)
            ]),
            el("div", { class: "summary-card score" }, [el("small", {}, "Score"), el("strong", {}, `🎯 ${pct}%`)])
          ]),
          el("p", { class: "hint center" }, sub + (tally.skipped ? ` (${tally.skipped} skipped)` : "")),
          scheduled ? nextReviewCard(scheduled) : null,
          el("button", { class: "btn btn-primary btn-block", onclick: () => rctx.onFinish(pct) }, "Continue")
        ])
      );
    }

    next();
  }

  // -------------------------------------------------------- an exercise
  function runExercise(ex, ctx, done) {
    let attempt = 0;
    let paid = false;
    let firstAcc = null; // accuracy on the FIRST try: the honest memory signal
    let hinted = false;

    function render() {
      Speech.stop();
      const c = root();
      clear(c);
      const mult = paid ? 1 : Challenges.multiplierForAttempt(attempt);

      const topbar = el("div", { class: "lesson-top" }, [
        el("button", { class: "lesson-quit", "aria-label": "Quit lesson", title: "Quit", onclick: ctx.quit }, "✕"),
        el(
          "div",
          { class: "lesson-progress" },
          el("div", { class: "lesson-progress-fill", style: `width:${Math.round((ctx.idx / ctx.total) * 100)}%` })
        ),
        el("span", { class: "stat coins" }, fmtCoins(Game.getState().coins))
      ]);
      const body = el("div", { class: "ex-body" });
      const feedback = el("div", { class: "ex-feedback" });
      const footer = el("div", { class: "ex-footer" });
      c.appendChild(
        el("div", { class: "screen screen-lesson" }, [
          topbar,
          el("div", { class: "lesson-title" }, ctx.title),
          body,
          feedback,
          footer
        ])
      );

      if (ex.base && attempt > 0) {
        body.appendChild(
          el(
            "div",
            { class: `attempt-chip ${paid ? "paid" : ""}` },
            paid ? `Try ${attempt + 1} · full points 🪙` : `Try ${attempt + 1} · ${Math.round(mult * 100)}% points`
          )
        );
      }

      const cleanup = [];
      const stopAll = () => {
        cleanup.forEach((fn) => fn());
        cleanup.length = 0;
      };

      const skipBtn = el(
        "button",
        {
          class: "btn btn-skip",
          title: "Skip this exercise (no points)",
          onclick: () => {
            stopAll();
            Speech.stop();
            done({ xp: 0, coins: 0, skipped: true, firstAccuracy: null, hinted });
          }
        },
        "Skip"
      );
      const primary = el("button", { class: "btn btn-primary" }, "Check");
      primary.disabled = true;
      footer.append(skipBtn, primary);

      let graded = false;
      const api = {
        ex,
        body,
        primary,
        session: ctx.session,
        persist: ex._persist || (ex._persist = {}),
        attempt,
        ctx,
        misses: ctx.misses || new Set(),
        markHinted() {
          hinted = true;
        },
        cleanup,
        stopAll,
        grade(accuracy, detailNode, opts = {}) {
          if (graded) return;
          graded = true;
          showResult(accuracy, detailNode, opts);
        },
        finish(extra = {}) {
          stopAll();
          Speech.stop();
          done({ xp: 0, coins: 0, firstAccuracy: null, hinted, ...extra });
        }
      };

      RENDERERS[ex.type](api);

      function showResult(accuracy, detailNode, { correctText } = {}) {
        stopAll();
        body.classList.add("locked");
        if (attempt === 0 && firstAcc === null) firstAcc = accuracy;
        const xp = Challenges.pointsFor(ex.base, accuracy, mult);
        const perfect = accuracy >= 0.999;
        const tone = perfect ? "good" : accuracy >= 0.7 ? "ok" : "bad";
        const title = perfect
          ? randomOf(["Excellent!", "Perfect!", "Great job!", "Nailed it!", "Well done!"])
          : accuracy >= 0.7
          ? "Almost there!"
          : "Keep practicing";
        clear(feedback);
        if (detailNode) feedback.appendChild(detailNode);

        clear(footer);
        const actions = [];
        if (!perfect) {
          const nextMult = Challenges.multiplierForAttempt(attempt + 1);
          const cost = Challenges.buybackCost(attempt + 1);
          actions.push(
            el(
              "button",
              {
                class: "btn btn-secondary",
                onclick: () => {
                  attempt++;
                  paid = false;
                  render();
                }
              },
              `↻ Try again · ${Math.round(nextMult * 100)}% pts`
            )
          );
          const payBtn = el(
            "button",
            {
              class: "btn btn-coin",
              title: `Pay ${cost} coins to try again for full points`,
              onclick: () => {
                if (Game.spendCoins(cost)) {
                  ctx.tally.spent += cost;
                  attempt++;
                  paid = true;
                  render();
                }
              }
            },
            `↻ Full pts · 🪙 ${cost}`
          );
          if (Game.getState().coins < cost) {
            payBtn.disabled = true;
            payBtn.title = `You need ${cost} coins (you have ${Game.getState().coins})`;
          }
          actions.push(payBtn);
        }
        const cont = el(
          "button",
          {
            class: "btn btn-primary",
            onclick: () => {
              Speech.stop();
              Game.addXp(xp);
              const coins = Challenges.coinsForPoints(xp);
              Game.addCoins(coins);
              done({ xp, coins, accuracy, firstAccuracy: firstAcc, hinted });
            }
          },
          "Continue"
        );
        actions.push(cont);

        const scoreNote =
          perfect && mult === 1
            ? ""
            : ` (${Math.round(accuracy * 100)}%${mult < 1 ? ` × ${Math.round(mult * 100)}%` : ""})`;
        footer.appendChild(
          el("div", { class: `result-panel ${tone}` }, [
            el("div", { class: "result-head" }, [
              el("strong", {}, title),
              el("span", { class: "result-xp" }, `+${xp} ⚡${scoreNote}`),
              correctText ? listenButton(correctText, "🔊 Hear it") : null
            ]),
            el("div", { class: "result-actions" }, actions)
          ])
        );
        cont.focus({ preventScroll: true });
      }
    }

    render();
  }

  // --------------------------------------------------------- renderers
  const RENDERERS = {
    read(api) {
      const { ex, body, primary } = api;
      // Shown in natural phrases (chunking), with its address, and read ALOUD
      // (the production effect: words you say are remembered better).
      body.append(
        instr("Read it out loud — or listen — a few times until it feels familiar."),
        ex.ref ? el("div", { class: "ref-tag" }, `📍 ${ex.ref}`) : null,
        el(
          "blockquote",
          { class: "verse-text chunked" },
          ex.phrases && ex.phrases.length > 1 ? ex.phrases.map((p) => el("span", { class: "chunk" }, p)) : ex.text
        ),
        listenButton(ex.text) || ""
      );
      if (Game.getSettings().autoListen && !api.session.autoPlayed && Speech.canSpeak()) {
        api.session.autoPlayed = true;
        setTimeout(() => Speech.speak(ex.text), 300);
      }
      primary.textContent = "I've got it";
      primary.disabled = false;
      primary.onclick = () => api.finish();
    },

    // Ungraded elaboration step: linking words to meaning/imagery/self.
    think(api) {
      const { ex, body, primary } = api;
      const ta = el("textarea", {
        class: "typed-input",
        rows: "3",
        placeholder: "Optional — jot it in your own words. You'll see it again at review time.",
        spellcheck: "true"
      });
      ta.value = (api.ctx && api.ctx.note) || "";
      body.append(
        instr("Make it meaningful"),
        el("blockquote", { class: "verse-text prompt" }, ex.text),
        el("p", { class: "think-prompt" }, `💭 ${ex.prompt}`),
        ta
      );
      primary.textContent = "Continue";
      primary.disabled = false;
      primary.onclick = () => api.finish({ note: ta.value.trim() });
    },

    tiles(api) {
      const { ex, body, primary } = api;
      const data = Challenges.makeTiles(ex.text);
      const byId = new Map(data.tiles.map((t) => [t.id, t]));
      const answer = el("div", { class: "tile-answer lockable" });
      const bank = el("div", { class: "tile-bank lockable" });
      const chosen = [];
      body.append(instr("Put the words in order."), answer, bank);

      function draw() {
        clear(answer);
        clear(bank);
        if (!chosen.length) answer.appendChild(el("span", { class: "tile-placeholder" }, "Tap the words below"));
        chosen.forEach((id) => {
          answer.appendChild(
            el(
              "button",
              {
                class: "tile",
                onclick: () => {
                  chosen.splice(chosen.indexOf(id), 1);
                  draw();
                }
              },
              byId.get(id).text
            )
          );
        });
        data.shuffled.forEach((t) => {
          const used = chosen.includes(t.id);
          const b = el(
            "button",
            {
              class: `tile ${used ? "used" : ""}`,
              onclick: () => {
                if (!chosen.includes(t.id)) {
                  chosen.push(t.id);
                  draw();
                }
              }
            },
            t.text
          );
          if (used) b.disabled = true;
          bank.appendChild(b);
        });
        primary.disabled = chosen.length !== data.tiles.length;
      }
      draw();

      primary.onclick = () => {
        const r = Challenges.gradeTiles(data, chosen);
        [...answer.children].forEach((b, i) => b.classList.add(r.results[i] ? "correct" : "incorrect"));
        api.grade(r.accuracy, r.accuracy < 1 ? correctAnswer(ex.text) : null, { correctText: ex.text });
      };
    },

    blanks(api) {
      const data =
        api.persist.blanks || (api.persist.blanks = Challenges.makeBlanks(api.ex.text, api.ex.ratio, api.ex.force));
      if (api.ex.bank) blanksWithBank(api, data);
      else blanksTyped(api, data);
    },

    refpick(api) {
      const { options } = Challenges.makeRefOptions(api.ex.ref);
      choiceExercise(
        api,
        [instr("Where is this verse found?"), el("blockquote", { class: "verse-text" }, api.ex.text)],
        options,
        `${api.ex.ref}. ${api.ex.text}`
      );
    },

    pick(api) {
      const { options } = Challenges.makePick(api.ex.text);
      choiceExercise(api, [instr("Which one is exactly right?")], options, api.ex.text);
    },

    next(api) {
      const n = Challenges.makeNext(api.ex.phrases);
      if (!n) return api.finish();
      choiceExercise(
        api,
        [
          instr("What comes next?"),
          el("blockquote", { class: "verse-text prompt" }, `${n.isStart ? "" : "… "}${n.prompt} …`)
        ],
        n.options,
        api.ex.text
      );
    },

    bits: recallExercise,
    letters: recallExercise,
    recall: recallExercise
  };

  // Remember which words were missed so they can be drilled again.
  function noteBlankMisses(api, data, r) {
    data.blanks.forEach((i) => {
      if (!r.results[i]) api.misses.add(Challenges.normalizeWord(data.tokens[i].core));
    });
  }

  // Word-bank blanks (easy): tap words to fill slots.
  function blanksWithBank(api, data) {
    const { ex, body, primary } = api;
    const filled = {}; // blank index -> bank item id
    const bankItems = Challenges.shuffle([
      ...data.blanks.map((i) => ({ id: `b${i}`, text: data.tokens[i].core })),
      ...Challenges.bankDistractors(ex.text, data, 2).map((w, k) => ({ id: `d${k}`, text: w }))
    ]);
    const itemById = new Map(bankItems.map((b) => [b.id, b]));
    const line = el("div", { class: "fillblank-line lockable" });
    const bank = el("div", { class: "tile-bank lockable" });
    body.append(instr("Tap the missing words."), line, bank, listenButton(ex.text) || "");

    function draw() {
      clear(line);
      data.tokens.forEach((t) => {
        if (!t.blank) {
          line.append(t.text + " ");
          return;
        }
        const item = itemById.get(filled[t.index]);
        const slot = el(
          "button",
          {
            class: `slot ${item ? "filled" : ""}`,
            onclick: () => {
              if (filled[t.index]) {
                delete filled[t.index];
                draw();
              }
            }
          },
          item ? item.text : " "
        );
        slot.dataset.index = t.index;
        line.append(t.lead, slot, t.trail + " ");
      });
      clear(bank);
      const used = new Set(Object.values(filled));
      bankItems.forEach((b) => {
        const btn = el(
          "button",
          {
            class: `tile ${used.has(b.id) ? "used" : ""}`,
            onclick: () => {
              const target = data.blanks.find((i) => !filled[i]);
              if (target === undefined || used.has(b.id)) return;
              filled[target] = b.id;
              draw();
            }
          },
          b.text
        );
        if (used.has(b.id)) btn.disabled = true;
        bank.appendChild(btn);
      });
      primary.disabled = Object.keys(filled).length < data.blanks.length;
    }
    draw();

    primary.onclick = () => {
      const answers = {};
      data.blanks.forEach((i) => (answers[i] = (itemById.get(filled[i]) || {}).text || ""));
      const r = Challenges.gradeBlanks(data, answers);
      noteBlankMisses(api, data, r);
      line.querySelectorAll(".slot").forEach((s) => s.classList.add(r.results[s.dataset.index] ? "correct" : "incorrect"));
      api.grade(r.accuracy, r.accuracy < 1 ? correctAnswer(ex.text) : null, { correctText: ex.text });
    };
  }

  // Typed blanks (medium / hard) — or say the whole verse instead.
  function blanksTyped(api, data) {
    const { ex, body, primary } = api;
    const canMic = Speech.canListen();
    const inputs = {};
    const line = el("div", { class: "fillblank-line lockable" });
    data.tokens.forEach((t) => {
      if (!t.blank) {
        line.append(t.text + " ");
        return;
      }
      const input = el("input", {
        class: "blank-input",
        type: "text",
        size: String(Math.max(3, t.core.length + 1)),
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        "aria-label": "Missing word"
      });
      inputs[t.index] = input;
      line.append(t.lead, input, t.trail + " ");
    });
    const order = data.blanks.map((i) => inputs[i]);
    order.forEach((input, k) => {
      input.addEventListener("input", () => (primary.disabled = !order.some((x) => x.value.trim())));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || (e.key === " " && input.value.trim())) {
          e.preventDefault();
          if (order[k + 1]) order[k + 1].focus();
          else if (!primary.disabled) primary.click();
        }
      });
    });

    const speakFirst = canMic && !api.session.preferType;
    body.append(
      instr(
        ex.weak
          ? speakFirst
            ? "Your tricky words — say the whole verse, or type just these."
            : `Your tricky words — type them${canMic ? " or say the whole verse." : "."}`
          : speakFirst
          ? "Say the whole verse out loud — or type the missing words."
          : `Type the missing words${canMic ? " — or say the whole verse." : "."}`
      )
    );
    const mic = canMic
      ? micControl(api, (transcript) => {
          const r = Challenges.gradeBlanksFromSpeech(ex.text, data, transcript);
          data.blanks.forEach((i) => (inputs[i].value = r.heard[i] || "—"));
          mark(r, transcript);
        }, speakFirst ? "Tap the mic and say the whole verse" : "Or tap the mic and say the whole verse")
      : null;
    if (speakFirst) body.append(line, mic);
    else {
      body.append(line);
      if (mic) body.append(mic);
    }

    function mark(r, transcript) {
      noteBlankMisses(api, data, r);
      data.blanks.forEach((i) => {
        const input = inputs[i];
        input.disabled = true;
        input.classList.add(r.results[i] ? "correct" : "incorrect");
        if (!r.results[i]) input.after(el("span", { class: "correction" }, data.tokens[i].core));
      });
      const detail = el("div", {}, [transcript ? el("p", { class: "heard" }, `Heard: “${transcript}”`) : null]);
      api.grade(r.accuracy, detail, { correctText: ex.text });
    }

    primary.textContent = "Check";
    primary.onclick = () => {
      const answers = {};
      data.blanks.forEach((i) => (answers[i] = inputs[i].value));
      mark(Challenges.gradeBlanks(data, answers), "");
    };
    if (!speakFirst && order[0]) setTimeout(() => order[0].focus({ preventScroll: true }), 50);
  }

  function choiceExercise(api, headNodes, options, fullText) {
    const { body, primary } = api;
    const list = el("div", { class: "choices lockable" });
    let sel = null;
    options.forEach((o, i) => {
      list.appendChild(
        el(
          "button",
          {
            class: "choice",
            onclick: () => {
              sel = i;
              [...list.children].forEach((c, k) => c.classList.toggle("selected", k === i));
              primary.disabled = false;
            }
          },
          o.text
        )
      );
    });
    body.append(...headNodes, list);
    primary.onclick = () => {
      if (sel === null) return;
      const ok = options[sel].correct;
      [...list.children].forEach((c, k) => {
        if (options[k].correct) c.classList.add("correct");
        else if (k === sel) c.classList.add("incorrect");
      });
      api.grade(ok ? 1 : 0, null, { correctText: fullText });
    };
  }

  // bits / letters / recall
  function recallExercise(api) {
    const { ex, body } = api;
    const words = Challenges.tokenize(ex.text).length;
    const refTag = ex.ref ? el("div", { class: "ref-tag" }, `📍 ${ex.ref}`) : null;
    if (ex.type === "bits") {
      const meter = el(
        "div",
        { class: "bits-meter", "aria-label": `Part ${ex.part} of ${ex.parts}` },
        Array.from({ length: ex.parts }, (_, i) => el("span", { class: i < ex.part ? "on" : "" }))
      );
      body.append(
        instr(
          ex.part === 1
            ? "Build it up — say the first part from memory."
            : `Build it up — say parts 1–${ex.part} from the beginning.`
        ),
        meter,
        el("p", { class: "word-count" }, `${words} words`)
      );
    } else if (ex.type === "letters") {
      body.append(
        instr("Say it using the first letters as clues."),
        refTag,
        el("div", { class: "letters" }, Challenges.firstLetters(ex.text))
      );
    } else if (ex.cold) {
      // Spaced review: only the address is shown. Pulling the verse out of
      // memory with no cue is what makes the memory last.
      body.append(
        instr(ex.ref ? "Say the reference, then the verse — from memory." : "Say the verse from memory."),
        refTag || el("div", { class: "ref-tag" }, "📖 Review"),
        el("p", { class: "word-count" }, `${words} words`)
      );
    } else {
      body.append(
        instr(ex.ref ? "Now the whole thing from memory — start with the reference!" : "Now the whole thing from memory!"),
        refTag,
        el("p", { class: "word-count" }, `${words} words`)
      );
    }
    body.append(hintControl(api, ex.text));
    recallInput(api, ex.text, (given, mode) => {
      const r = Challenges.gradeRecall(ex.text, given, ex.ref);
      r.diff.forEach((d) => d.correct || api.misses.add(Challenges.normalizeWord(d.text)));
      const note = ex.cold && api.ctx && api.ctx.note;
      api.grade(
        r.accuracy,
        el("div", {}, [
          mode === "speak" ? el("p", { class: "heard" }, `Heard: “${given}”`) : null,
          diffNode(r.diff),
          el("p", { class: "accuracy-line" }, `${r.correct} of ${r.total} words${r.refFound ? " · 📍 reference included" : ""}`),
          note ? el("p", { class: "your-note" }, `📝 Your note: ${note}`) : null
        ]),
        { correctText: ex.text }
      );
    });
  }

  // Two kinds of hint, the learner's choice: the next words of the verse, or
  // their own "word picture" note from the make-it-meaningful step.
  function hintControl(api, text) {
    const words = Challenges.tokenize(text);
    const note = ((api.ctx && api.ctx.note) || "").trim();
    let n = 0;
    const out = el("span", { class: "hint-text" });
    const wordsBtn = el("button", { class: "btn btn-ghost btn-hint", type: "button" }, "💡 Next words");
    wordsBtn.addEventListener("click", () => {
      api.markHinted();
      n += 2;
      const shown = Challenges.hintWords(text, n);
      const more = Challenges.tokenize(shown).length < words.length;
      out.textContent = `“${shown}${more ? " …" : ""}”`;
      if (Challenges.tokenize(shown).length >= words.length - 1) wordsBtn.disabled = true;
      else wordsBtn.textContent = "💡 More words";
    });
    const row = el("div", { class: "hint-row lockable" }, [wordsBtn]);
    const pictureBtn = el(
      "button",
      {
        class: "btn btn-ghost btn-hint",
        type: "button",
        title: note ? "Show what you wrote in your own words" : "Write a note in the “make it meaningful” step to use this hint"
      },
      "🖼️ My word picture"
    );
    if (note) {
      pictureBtn.addEventListener("click", () => {
        api.markHinted();
        out.textContent = `📝 ${note}`;
      });
    } else {
      pictureBtn.disabled = true;
    }
    row.append(pictureBtn, out);
    return row;
  }

  // Say-it (default) or type-it answer area.
  function recallInput(api, text, onAnswer) {
    const canMic = Speech.canListen();
    const wrap = el("div", { class: "recall-input lockable" });
    api.body.appendChild(wrap);

    function draw() {
      clear(wrap);
      const mode = !canMic || api.session.preferType ? "type" : "speak";
      if (canMic) {
        const tab = (label, m) =>
          el(
            "button",
            {
              class: `mode-tab ${mode === m ? "active" : ""}`,
              type: "button",
              onclick: () => {
                if (mode === m) return;
                api.stopAll();
                api.session.preferType = m === "type";
                draw();
              }
            },
            label
          );
        wrap.appendChild(el("div", { class: "mode-tabs" }, [tab("🎙️ Say it", "speak"), tab("⌨️ Type it", "type")]));
      }
      if (mode === "type") {
        const ta = el("textarea", {
          class: "typed-input",
          rows: "4",
          placeholder: "Type it from memory…",
          autocapitalize: "sentences",
          spellcheck: "false"
        });
        wrap.appendChild(ta);
        api.primary.style.display = "";
        api.primary.textContent = "Check";
        api.primary.disabled = true;
        ta.addEventListener("input", () => (api.primary.disabled = !ta.value.trim()));
        api.primary.onclick = () => onAnswer(ta.value, "type");
        setTimeout(() => ta.focus({ preventScroll: true }), 50);
      } else {
        api.primary.style.display = "none";
        wrap.appendChild(micControl(api, (t) => onAnswer(t, "speak"), "Tap the mic and say it out loud"));
      }
    }
    draw();
  }

  function micControl(api, onTranscript, idleText) {
    const btn = el("button", { class: "mic-btn", type: "button", "aria-label": "Start speaking" }, "🎙️");
    const status = el("div", { class: "mic-status" }, idleText);
    const live = el("div", { class: "mic-live" });
    let ctl = null;
    let alive = true;
    api.cleanup.push(() => {
      alive = false;
      if (ctl) ctl.stop();
    });

    btn.addEventListener("click", () => {
      if (ctl) {
        status.textContent = "Checking…";
        ctl.stop();
        return;
      }
      Speech.stop();
      live.textContent = "";
      btn.classList.add("listening");
      btn.setAttribute("aria-label", "Stop and check");
      status.textContent = "Listening… tap again when you're done.";
      ctl = Speech.listen({
        onInterim: (t) => (live.textContent = t),
        onEnd: (t, err) => {
          ctl = null;
          if (!alive) return;
          btn.classList.remove("listening");
          btn.setAttribute("aria-label", "Start speaking");
          if (t) onTranscript(t);
          else status.textContent = Speech.describeError(err || "no-speech");
        }
      });
    });
    return el("div", { class: "mic-box" }, [btn, status, live]);
  }

  // ------------------------------------------------- spaced-review UI
  const REVIEW_BATCH = 8; // a short daily session beats a long, tiring one

  function nextReviewCard(entry) {
    const when = Spacing.describeDue(entry.due, Game.todayStr());
    const first = (entry.reps || 0) === 0;
    return el("div", { class: "review-card" }, [
      el("strong", {}, `🗓️ ${first ? "First review" : "Next review"}: ${when}`),
      el(
        "small",
        {},
        first
          ? "Sleep locks new verses in. Come back for a quick recall — if you get it, the gaps stretch to days, then weeks."
          : "Each time you remember it, the wait gets longer."
      )
    ]);
  }

  // Quiz whatever is due. Verses from every passage are mixed together
  // (interleaving), and each one starts with a cold recall from just the
  // address. A clean first-try pass pushes the next review further out; a
  // miss gives a short scaffolded path back and brings it back tomorrow.
  function startDailyReview(onExit = UI.renderHome) {
    const dueAll = Game.dueReviews();
    if (!dueAll.length) return onExit();
    const items = Challenges.shuffle(dueAll.slice(0, REVIEW_BATCH));
    const session = { preferType: !Game.getSettings().speakFirst || !Speech.canListen(), autoPlayed: false };
    const tally = { xp: 0, max: 0, coins: 0, spent: 0, skipped: 0 };
    const results = [];
    let i = 0;

    function quit() {
      Speech.stop();
      if (confirm("Stop this review? Verses you've already finished are rescheduled; the rest stay due.")) onExit();
    }

    function nextItem() {
      if (i >= items.length) return summary();
      const item = items[i];
      const queue = Challenges.buildSpacedReview(item.text, item.ref);
      const misses = new Set();
      let k = 0;
      let cold = null;

      const finishItem = () => {
        if (cold && !cold.skipped && cold.firstAccuracy !== null) {
          const entry = Game.recordReview(item.id, cold.firstAccuracy, cold.hinted);
          results.push({ item, entry, accuracy: cold.firstAccuracy, hinted: cold.hinted });
        } else {
          results.push({ item, entry: null, skipped: true });
        }
        i++;
        nextItem();
      };

      const step = () => {
        if (k >= queue.length) return finishItem();
        const ex = queue[k];
        const ctx = { title: `Review ${i + 1} of ${items.length}`, idx: i, total: items.length, session, tally, quit, misses, note: item.note };
        runExercise(ex, ctx, (res) => {
          if (ex.base) {
            tally.max += ex.base;
            tally.xp += res.xp || 0;
            tally.coins += res.coins || 0;
            if (res.skipped) tally.skipped++;
          }
          if (ex.cold) {
            cold = res;
            const clean = !res.skipped && res.firstAccuracy >= Spacing.GOOD && !res.hinted;
            if (res.skipped || clean) queue.length = k + 1;
            else queue.push(...Challenges.buildRemedial(item.text, item.ref));
          }
          k++;
          step();
        });
      };
      step();
    }

    function summary() {
      Speech.stop();
      Game.bumpStreak();
      const bonus = Challenges.SCORING.roundBonusCoins;
      Game.addCoins(bonus);
      tally.coins += bonus;
      const done = results.filter((r) => !r.skipped);
      const solid = done.filter((r) => r.accuracy >= Spacing.GOOD && !r.hinted).length;
      const remaining = Game.dueReviews().length;
      const rows = results.map((r) => {
        const icon = r.skipped ? "⏭️" : r.accuracy >= Spacing.GOOD && !r.hinted ? "✅" : r.accuracy >= Spacing.OK ? "🟡" : "🔁";
        const when = r.skipped ? "still due" : `next ${Spacing.describeDue(r.entry.due, Game.todayStr())}`;
        return el("li", { class: "review-row" }, [
          el("span", { class: "review-icon" }, icon),
          el("span", { class: "review-ref" }, r.item.label),
          el("span", { class: "review-when" }, when)
        ]);
      });
      const c = root();
      clear(c);
      c.appendChild(
        el("div", { class: "screen screen-summary" }, [
          renderHeader(),
          el("div", { class: "summary-hero" }, [
            el("h2", {}, solid === done.length && done.length ? "Locked in! 🧠" : "Review done 💪"),
            el("p", { class: "hint" }, `${solid} of ${done.length} recalled cleanly`)
          ]),
          el("div", { class: "summary-cards" }, [
            el("div", { class: "summary-card xp" }, [el("small", {}, "Points"), el("strong", {}, `⚡ ${tally.xp}`)]),
            el("div", { class: "summary-card coins" }, [
              el("small", {}, "Coins"),
              el("strong", {}, `🪙 +${tally.coins}${tally.spent ? ` / −${tally.spent}` : ""}`)
            ]),
            el("div", { class: "summary-card score" }, [el("small", {}, "Recalled"), el("strong", {}, `🎯 ${solid}/${done.length}`)])
          ]),
          el("ul", { class: "review-list" }, rows),
          el(
            "p",
            { class: "hint center" },
            done.length - solid > 0
              ? "Struggling to remember is not failing — that effort is exactly what strengthens memory. Missed verses come back tomorrow."
              : "Each clean recall pushes the next review further away. That is how a verse becomes permanent."
          ),
          remaining ? el("p", { class: "hint center" }, `${remaining} more ${remaining === 1 ? "verse is" : "verses are"} due — do them in a short session later today.`) : null,
          el("button", { class: "btn btn-primary btn-block", onclick: () => onExit() }, "Done")
        ])
      );
    }

    nextItem();
  }

  return { open, buildRounds, startDailyReview };
})();

window.Lesson = Lesson;
