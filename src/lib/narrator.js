// The game-show narrator on the host (TV) screen. Uses the Kokoro AI voice
// (aiVoice.js) once it has loaded and passed its speed check, and the
// browser's built-in text-to-speech before that or as a fallback. Music ducks
// while it talks.
//
// Browser-voice quirks handled here: voices load late, Chrome can drop an
// utterance spoken right after cancel(), utterances can be garbage-collected
// mid-sentence, and Chrome's online voices stop after ~15 s unless nudged.

import { audioReady, getVolumes, isMasterMuted, playVoice, setDucked } from './audio.js'
import { aiVoiceActive, synthesize } from './aiVoice.js'

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
const live = new Set() // browser utterances in flight (strong refs, see above)
let pending = [] // browser lines waiting for an interrupt's settle delay
let pendingTimer = null
let keepAlive = null
let voice = null

// AI voice playback: a queue of lines whose audio may still be generating.
const STALE_MS = 8000 // a line this late is no longer about what's on screen
let gen = 0 // bumped on every interrupt; loops from older generations exit
let runningGen = -1
let aiQueue = [] // { text, audio: Promise, at }
let aiPlaying = null

// Best-sounding English browser voices first; anything English as a fallback.
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
  const browserBusy = live.size > 0 || pending.length > 0
  setDucked(browserBusy || aiQueue.length > 0 || !!aiPlaying)
  if (browserBusy && !keepAlive && voice && !voice.localService) {
    keepAlive = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause()
        synth.resume()
      }
    }, 10000)
  } else if (!browserBusy) {
    clearInterval(keepAlive)
    keepAlive = null
  }
}

// ------------------------------------------------------------ browser voice

function speakNow(text) {
  if (!synth || isMasterMuted() || !getVolumes().voice) return
  if (import.meta.env.DEV) console.debug('[narrator] browser:', text)
  const u = new SpeechSynthesisUtterance(text)
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

function narrateBrowser(text, queue) {
  if (!synth) return
  if (!queue) {
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
}

// ----------------------------------------------------------------- AI voice

async function runAi() {
  if (runningGen === gen) return
  const myGen = (runningGen = gen)
  while (aiQueue.length && gen === myGen) {
    const item = aiQueue[0]
    let r = null
    try {
      r = await item.audio
    } catch {
      // generation failed: fall back to the browser voice for this line
    }
    if (gen !== myGen) return
    aiQueue.shift()
    if (Date.now() - item.at > STALE_MS || isMasterMuted()) continue
    if (!r) {
      narrateBrowser(item.text, true)
      continue
    }
    if (import.meta.env.DEV) console.debug('[narrator] ai:', item.text)
    const handle = playVoice(r.audio, r.sampleRate)
    aiPlaying = handle
    updateDuck()
    await handle?.ended
    if (gen !== myGen) return
    aiPlaying = null
  }
  if (gen === myGen) runningGen = -1
  updateDuck()
}

// ------------------------------------------------------------------- public

// Say a line. By default it interrupts whatever is being said; with
// { queue: true } it waits for the current line to finish.
export function narrate(text, { queue = false } = {}) {
  if (!text) return
  try {
    if (!queue) stopNarration()
    const line = spoken(text)
    if (aiVoiceActive() && audioReady()) {
      aiQueue.push({ text: line, audio: synthesize(line, { urgent: true }), at: Date.now() })
      updateDuck()
      runAi()
    } else {
      narrateBrowser(line, queue)
    }
  } catch {
    // no speech available: everything is on screen anyway
  }
}

// Generate lines ahead of time (AI voice only) so they play without delay.
export function prepareLines(lines) {
  if (!aiVoiceActive()) return
  for (const text of lines) if (text) synthesize(spoken(text)).catch(() => {})
}

export function stopNarration() {
  gen++
  aiQueue = []
  aiPlaying?.stop()
  aiPlaying = null
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
