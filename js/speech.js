/* Speech in both directions, using only free, built-in browser APIs:
   - Speech.speak(): text-to-speech with the most natural voice available
     (Edge "Natural" neural voices, Chrome "Google" voices, Apple
     "Enhanced"/"Premium"/Siri voices are preferred; robotic ones avoided).
   - Speech.listen(): continuous speech recognition with a live transcript. */

const Speech = (() => {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const Recognition =
    typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  let voices = [];
  const voiceListeners = new Set();

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    voiceListeners.forEach((fn) => fn());
  }
  if (synth) {
    loadVoices();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }

  function onVoicesChanged(fn) {
    voiceListeners.add(fn);
    return () => voiceListeners.delete(fn);
  }

  // Higher = more natural sounding.
  function scoreVoice(v) {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural/.test(n)) s += 100; // Microsoft Edge neural voices
    if (/premium/.test(n)) s += 70; // Apple premium
    if (/enhanced/.test(n)) s += 60; // Apple enhanced
    if (/siri/.test(n)) s += 55;
    if (/^google/.test(n)) s += 50; // Chrome's cloud voices
    if (/online/.test(n)) s += 30;
    if (/samantha|ava|allison|serena|daniel|karen|moira|tessa|aria|jenny|guy|libby|sonia|ryan/.test(n)) s += 15;
    if (/en[-_]us/i.test(v.lang)) s += 6;
    else if (/en[-_](gb|au|ca|ie|nz)/i.test(v.lang)) s += 4;
    if (/compact|espeak|novelty|zarvox|trinoids|whisper|bad news|good news|bells|bubbles|cellos|albert|jester|organ|superstar|wobble|boing|bahh|deranged|hysterical|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|flo|eddy|reed|sandy/.test(n))
      s -= 80;
    return s;
  }

  function listVoices() {
    return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a) || a.name.localeCompare(b.name));
  }

  function settings() {
    return typeof Game !== "undefined" && Game.getSettings ? Game.getSettings() : {};
  }

  function currentVoice() {
    const wanted = settings().voiceName;
    return (wanted && voices.find((v) => v.name === wanted)) || listVoices()[0] || null;
  }

  function canSpeak() {
    return !!synth;
  }

  let token = 0;

  // Speaks sentence by sentence (Chrome cuts off long utterances).
  function speak(text, { onend, rate } = {}) {
    if (!synth) {
      if (onend) onend();
      return;
    }
    stop();
    const my = ++token;
    const chunks = (String(text).match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/g) || [text])
      .map((c) => c.trim())
      .filter(Boolean);
    const voice = currentVoice();
    const r = rate || settings().voiceRate || 0.95;
    let i = 0;
    const next = () => {
      if (my !== token) return;
      if (i >= chunks.length) {
        if (onend) onend();
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-US";
      }
      u.rate = r;
      u.pitch = 1;
      u.onend = next;
      u.onerror = () => {
        if (my === token && onend) onend();
      };
      synth.speak(u);
    };
    next();
  }

  function stop() {
    token++;
    if (synth) synth.cancel();
  }

  // ------------------------------------------------------ recognition
  function canListen() {
    return !!Recognition;
  }

  // Returns a controller { stop() }. Callbacks:
  //   onInterim(textSoFar), onEnd(finalText, errorCode|null)
  function listen({ onInterim, onEnd } = {}) {
    const rec = new Recognition();
    rec.lang = "en-US";
    // Android Chrome duplicates words in continuous mode, so use single-shot there.
    rec.continuous = !/Android/i.test(navigator.userAgent);
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = "";
    let lastInterim = "";
    let error = null;
    let ended = false;

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      lastInterim = interim;
      if (onInterim) onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      error = e.error;
    };
    rec.onend = () => {
      if (ended) return;
      ended = true;
      const text = (finalText + (lastInterim || "")).trim();
      if (onEnd) onEnd(text, error === "no-speech" && text ? null : error);
    };
    try {
      rec.start();
    } catch (e) {
      ended = true;
      if (onEnd) onEnd("", "start-failed");
    }
    return {
      stop: () => {
        try {
          rec.stop();
        } catch (e) {
          /* already stopped */
        }
      }
    };
  }

  function describeError(code) {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "Microphone access is blocked. Allow the mic for this site, or type instead.";
      case "no-speech":
        return "I didn't hear anything. Tap the mic and try again.";
      case "audio-capture":
        return "No microphone was found. You can type instead.";
      case "network":
        return "Speech recognition needs an internet connection. You can type instead.";
      default:
        return "Speech recognition didn't work this time. Try again, or type instead.";
    }
  }

  return {
    canSpeak,
    speak,
    stop,
    listVoices,
    currentVoice,
    scoreVoice,
    onVoicesChanged,
    canListen,
    listen,
    describeError
  };
})();

window.Speech = Speech;
