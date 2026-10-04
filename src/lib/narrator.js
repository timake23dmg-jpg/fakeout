// The game-show narrator: browser text-to-speech on the host (TV) screen.
// Music ducks while it talks. Works around the usual Web Speech quirks:
// voices load late, Chrome can drop an utterance spoken right after cancel(),
// utterances can be garbage-collected mid-sentence, and Chrome's online voices
// stop after ~15 s unless nudged.

import { getVolumes, isMasterMuted, setDucked } from './audio.js'

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
const live = new Set() // utterances in flight (strong refs, see above)
let pending = [] // lines waiting for an interrupt's settle delay
let pendingTimer = null
let keepAlive = null
let voice = null

// Best-sounding English voices first; anything English as a fallback.
const PREFERRED = [
  /natural/i, // Edge "Microsoft … Online (Natural)"
  /google uk english male/i,
  /google us english/i,
  /google uk english female/i,
  /^(daniel|samantha|karen|serena|moira)\b/i, // macOS / iOS
]

function pickVoice() {
  const voices = synth?.getVoices() ?? []
  const english = voices.filter((v) => /^en[-_]/i.test(v.lang) || v.lang === 'en')
  for (const re of PREFERRED) {
    const v = english.find((x) => re.test(x.name))
    if (v) return v
  }
  return english.find((v) => /en[-_](GB|US)/i.test(v.lang)) || english[0] || null
}

if (synth) {
  voice = pickVoice()
  synth.addEventListener?.('voiceschanged', () => {
    voice = pickVoice()
  })
}

const spoken = (text) =>
  text
    .replace(/_{2,}/g, ' blank ')
    .replace(/\s+/g, ' ')
    .trim()

function updateDuck() {
  const busy = live.size > 0 || pending.length > 0
  setDucked(busy)
  if (busy && !keepAlive && voice && !voice.localService) {
    keepAlive = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause()
        synth.resume()
      }
    }, 10000)
  } else if (!busy) {
    clearInterval(keepAlive)
    keepAlive = null
  }
}

function speakNow(text) {
  if (isMasterMuted() || !getVolumes().voice) return
  const u = new SpeechSynthesisUtterance(spoken(text))
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  }
  u.rate = 1.05
  u.pitch = 1.05
  u.volume = Math.min(1, getVolumes().voice)
  const done = () => {
    live.delete(u)
    updateDuck()
  }
  u.onend = done
  u.onerror = done
  live.add(u)
  synth.speak(u)
  updateDuck()
}

// Say a line. By default it interrupts whatever is being said; with
// { queue: true } it waits for the current line to finish.
export function narrate(text, { queue = false } = {}) {
  if (!synth || !text) return
  try {
    if (!queue) {
      stopNarration()
      pending = [text]
      updateDuck()
      // Give cancel() a moment to settle, or Chrome may swallow the new line.
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        const lines = pending
        pending = []
        lines.forEach(speakNow)
        updateDuck()
      }, 120)
    } else if (pendingTimer) {
      pending.push(text)
    } else {
      speakNow(text)
    }
  } catch {
    // TTS unavailable: everything is on screen anyway
  }
}

export function stopNarration() {
  clearTimeout(pendingTimer)
  pendingTimer = null
  pending = []
  live.clear()
  try {
    synth?.cancel()
  } catch {
    // no TTS
  }
  updateDuck()
}
