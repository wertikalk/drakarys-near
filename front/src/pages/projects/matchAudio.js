// Synthesised match sound effects (Web Audio API - no audio assets required).
// Browsers keep the context suspended until a user gesture, so call unlockAudio()
// from an interaction handler before expecting anything audible.

let audioCtx = null;
let muted = false;
let speechMuted = false;

function ctx() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
  }
  return audioCtx;
}

export function unlockAudio() {
  const ac = ctx();
  if (ac && ac.state === "suspended") ac.resume();
}

export function setMuted(value) {
  muted = value;
}

export function setSpeechMuted(value) {
  speechMuted = value;
  if (speechMuted) stopSpeaking();
}

// Deep male voices first - closest to a broadcast commentator
const PREFERRED_VOICES = [
  /Google UK English Male/i,
  /Microsoft (David|George|Guy|Ryan)/i,
  /Daniel/i,
  /^Alex$/i,
  /Rishi|Arthur|Oliver/i,
  /english[-_ ]?(us|gb)?[-_ ]?male|\bmale\b/i,
];

// Used to steer the fallback away from the higher-pitched defaults
const HIGHER_VOICES =
  /female|Zira|Aria|Jenny|Samantha|Victoria|Karen|Moira|Tessa|Fiona|Serena|Martha|Amelie/i;

let cachedVoice = null;

function pickVoice(synth) {
  if (cachedVoice) return cachedVoice;
  const voices = synth.getVoices();
  // Chrome populates the list asynchronously - retry on the next line
  if (!voices.length) return null;

  for (const pattern of PREFERRED_VOICES) {
    const match = voices.find((voice) => pattern.test(voice.name));
    if (match) {
      cachedVoice = match;
      return match;
    }
  }

  const english = voices.filter((voice) => voice.lang?.startsWith("en"));
  cachedVoice =
    english.find(
      (voice) =>
        voice.lang.startsWith("en-GB") && !HIGHER_VOICES.test(voice.name),
    ) ??
    english.find((voice) => !HIGHER_VOICES.test(voice.name)) ??
    english[0] ??
    voices[0];
  return cachedVoice;
}

// Spoken commentary via the browser's speech synthesis
export function speak(text) {
  if (speechMuted || typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth || !text) return;

  // Never let lines queue up behind each other - the latest one wins
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(synth);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  // Dropped pitch for a deeper delivery, with slight variation so every line
  // doesn't land on the same cadence
  utterance.rate = 0.96 + Math.random() * 0.06;
  utterance.pitch = 0.7 + Math.random() * 0.06;
  utterance.volume = 0.95;
  synth.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
}

function tone({
  freq,
  endFreq,
  duration = 0.2,
  type = "sine",
  gain = 0.2,
  delay = 0,
}) {
  const ac = ctx();
  if (!ac || muted) return;
  const start = ac.currentTime + delay;

  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq)
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);

  const envelope = ac.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(envelope).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function noise({
  duration = 0.2,
  frequency = 900,
  q = 1,
  type = "bandpass",
  gain = 0.2,
  delay = 0,
}) {
  const ac = ctx();
  if (!ac || muted) return;
  const start = ac.currentTime + delay;

  const buffer = ac.createBuffer(
    1,
    Math.ceil(ac.sampleRate * duration),
    ac.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;

  const envelope = ac.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(gain, start + 0.015);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(envelope).connect(ac.destination);
  source.start(start);
  source.stop(start + duration);
}

// Short, dry thump of boot on ball
export function playPass() {
  tone({ freq: 170, endFreq: 70, duration: 0.12, gain: 0.18 });
  noise({ duration: 0.07, frequency: 1300, gain: 0.1 });
}

// Harder strike than a pass
export function playShot() {
  tone({ freq: 230, endFreq: 60, duration: 0.22, gain: 0.28 });
  noise({ duration: 0.13, frequency: 1900, q: 0.7, gain: 0.18 });
}

// Muffled catch/block
export function playSave() {
  tone({ freq: 130, endFreq: 80, duration: 0.1, gain: 0.2 });
  noise({ duration: 0.07, frequency: 600, gain: 0.1 });
}

// Crowd swell plus a rising triad
export function playGoal() {
  noise({ duration: 1.4, frequency: 750, q: 0.6, gain: 0.16 });
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    tone({
      freq,
      duration: 0.5,
      gain: 0.14,
      type: "triangle",
      delay: i * 0.09,
    });
  });
}

// Referee whistle: warbling high tone plus a little air
function whistleBlast(delay, duration) {
  const ac = ctx();
  if (!ac || muted) return;
  const start = ac.currentTime + delay;

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(2550, start);

  // Warble that gives the whistle its trill
  const lfo = ac.createOscillator();
  lfo.frequency.value = 28;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = 90;
  lfo.connect(lfoDepth).connect(osc.frequency);

  const envelope = ac.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
  envelope.gain.setValueAtTime(0.14, start + duration - 0.04);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(envelope).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  lfo.start(start);
  lfo.stop(start + duration + 0.02);

  noise({ duration: 0.06, frequency: 2600, q: 0.8, gain: 0.05, delay });
}

export function playWhistle(blasts = 1) {
  for (let i = 0; i < blasts; i++) {
    // Final blast is drawn out, the way a referee ends a match
    const isLast = i === blasts - 1;
    whistleBlast(i * 0.3, isLast && blasts > 1 ? 0.55 : 0.28);
  }
}
