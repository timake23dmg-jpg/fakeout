// Procedural sound for the host screen (Web Audio, no asset files).
// SFX, music and the narrator voice have separate volumes, plus a master mute
// (the mute button). Music ducks while the narrator speaks (narrator.js).
// The lobby song itself is a real audio file: see lobbyMusic.js.

let ctx = null
let sfxGain = null
let musicGain = null
let voiceGain = null
let volumes = { music: 0.35, sfx: 0.8, voice: 1 }
let masterMuted = false
let ducked = false
let musicTimer = null
let currentLoop = null
let loopGain = null
const volumeListeners = new Set()
const DUCK_LEVEL = 0.3

// Effective music level (after ducking), also used by the lobby song.
export const musicLevel = () => volumes.music * (ducked ? DUCK_LEVEL : 1)

function applyGains() {
  if (sfxGain) sfxGain.gain.value = masterMuted ? 0 : volumes.sfx
  if (musicGain) musicGain.gain.setTargetAtTime(masterMuted ? 0 : musicLevel(), ctx.currentTime, 0.08)
  if (voiceGain) voiceGain.gain.value = masterMuted ? 0 : volumes.voice
}

function emitVolumes() {
  for (const fn of volumeListeners) fn(volumes)
}

export function setDucked(value) {
  if (ducked === value) return
  ducked = value
  applyGains()
  emitVolumes()
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    sfxGain = ctx.createGain()
    musicGain = ctx.createGain()
    voiceGain = ctx.createGain()
    applyGains()
    sfxGain.connect(ctx.destination)
    musicGain.connect(ctx.destination)
    voiceGain.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
}

export function setVolumes(v) {
  volumes = { ...volumes, ...v }
  applyGains()
  emitVolumes()
}

export const getVolumes = () => volumes
export const audioReady = () => !!ctx && ctx.state === 'running'

// Play generated speech (the AI narrator) on the voice channel. Returns a
// handle whose `ended` promise settles when it finishes or is stopped.
export function playVoice(samples, sampleRate) {
  if (!ctx) return null
  const buf = ctx.createBuffer(1, samples.length, sampleRate)
  buf.copyToChannel(samples, 0)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(voiceGain)
  const ended = new Promise((resolve) => {
    src.onended = resolve
  })
  src.start()
  return {
    ended,
    stop: () => {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    },
  }
}
export const isMasterMuted = () => masterMuted

export function onVolumesChange(fn) {
  volumeListeners.add(fn)
  return () => volumeListeners.delete(fn)
}

export function setMasterMuted(value) {
  masterMuted = value
  applyGains()
  if (value) {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // no TTS
    }
  }
}

function tone({ freq, to, type = 'sine', dur = 0.15, vol = 0.3, at = 0, out = sfxGain, attack = 0.005 }) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

function noise({ dur = 0.3, vol = 0.2, at = 0, from = 800, to = 4000, q = 1 }) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(g).connect(sfxGain)
  src.start(t)
}

const SOUNDS = {
  whoosh: () => noise({ dur: 0.4, vol: 0.25, from: 400, to: 3000 }),
  drum: () => {
    tone({ freq: 120, to: 40, dur: 0.35, vol: 0.8 })
    noise({ dur: 0.15, vol: 0.3, from: 2000, to: 800 })
    tone({ freq: 90, to: 30, dur: 0.3, vol: 0.6, at: 0.25 })
  },
  flick: () => noise({ dur: 0.08, vol: 0.3, from: 3000, to: 5000, q: 3 }),
  ding: () => {
    tone({ freq: 1320, dur: 0.6, vol: 0.25 })
    tone({ freq: 1980, dur: 0.4, vol: 0.1 })
  },
  typeTick: () => tone({ freq: 2400, type: 'square', dur: 0.02, vol: 0.05 }),
  pop: () => tone({ freq: 500, to: 1200, dur: 0.09, vol: 0.3 }),
  tick: () => tone({ freq: 1000, type: 'square', dur: 0.04, vol: 0.12 }),
  bubble: () => tone({ freq: 300 + Math.random() * 400, to: 900, dur: 0.1, vol: 0.2 }),
  riser: () => noise({ dur: 1.6, vol: 0.18, from: 300, to: 6000, q: 4 }),
  buzzer: () => {
    tone({ freq: 110, type: 'sawtooth', dur: 0.45, vol: 0.3 })
    tone({ freq: 116, type: 'sawtooth', dur: 0.45, vol: 0.3 })
  },
  chaChing: () => {
    tone({ freq: 1568, type: 'triangle', dur: 0.15, vol: 0.3 })
    tone({ freq: 2093, type: 'triangle', dur: 0.4, vol: 0.3, at: 0.1 })
    noise({ dur: 0.3, vol: 0.12, from: 5000, to: 8000, at: 0.1, q: 2 })
  },
  drumroll: () => {
    for (let i = 0; i < 20; i++) noise({ dur: 0.06, vol: 0.12 + i * 0.01, from: 1500, to: 900, at: i * 0.05 })
  },
  fanfare: () => {
    ;[523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: i === 3 ? 0.8 : 0.18, vol: 0.28, at: i * 0.14 }))
  },
  sadTrombone: () => {
    ;[392, 370, 349].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.4, vol: 0.12, at: i * 0.42 }))
    tone({ freq: 330, to: 300, type: 'sawtooth', dur: 1.1, vol: 0.12, at: 1.26 })
  },
  blip: () => tone({ freq: 700 + Math.random() * 500, dur: 0.07, vol: 0.15 }),
  cheer: () => {
    noise({ dur: 2.2, vol: 0.2, from: 800, to: 1800, q: 0.5 })
    SOUNDS.fanfare()
  },
  chime: () => {
    tone({ freq: 880, dur: 0.5, vol: 0.2 })
    tone({ freq: 1320, dur: 0.7, vol: 0.15, at: 0.12 })
  },
}

export function sfx(name) {
  if (!ctx || !volumes.sfx || masterMuted) return
  SOUNDS[name]?.()
}

// ------------------------------------------------------------------ music

const LOOPS = {
  // relaxed lobby-style loop (lobby, LIE_ENTRY)
  chill: { bpm: 104, bass: [130.8, 130.8, 174.6, 196], arp: [523, 659, 784, 659], type: 'triangle' },
  // tenser loop (PICK_TRUTH)
  tense: { bpm: 132, bass: [110, 110, 116.5, 110], arp: [440, 523, 466, 523], type: 'square' },
}

// Notes are scheduled a little ahead on the audio clock (not by setInterval
// timing), so the loop stays in time even when timers jitter. Each loop has
// its own gain node so stopping it silences notes already scheduled.
const LOOKAHEAD = 0.6 // seconds

export function playMusic(name) {
  if (currentLoop === name) return
  stopMusic()
  if (!ctx || !LOOPS[name]) return
  currentLoop = name
  const loop = LOOPS[name]
  const half = 60 / loop.bpm / 2
  const out = ctx.createGain()
  out.connect(musicGain)
  loopGain = out
  let step = 0
  let next = ctx.currentTime + 0.05
  const fill = () => {
    // After a long timer stall (hidden tab), skip ahead instead of bunching notes.
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05
    while (next < ctx.currentTime + LOOKAHEAD) {
      const at = next - ctx.currentTime
      tone({ freq: loop.arp[step % loop.arp.length], type: loop.type, dur: half * 0.8, vol: 0.05, at, out })
      if (step % 2 === 0) {
        tone({ freq: loop.bass[Math.floor(step / 2) % loop.bass.length], type: 'sine', dur: half * 1.8, vol: 0.18, at, out })
      }
      step++
      next += half
    }
  }
  fill()
  musicTimer = setInterval(fill, 150)
}

export function stopMusic() {
  clearInterval(musicTimer)
  musicTimer = null
  currentLoop = null
  if (loopGain && ctx) {
    const g = loopGain
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.05)
    setTimeout(() => g.disconnect(), 400)
  }
  loopGain = null
}
