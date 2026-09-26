// Lobby song ("Loading Screen Music"): loops on the TV lobby and on phones'
// waiting screens, and fades out the moment the game starts. The mute choice
// is per device, remembered, and on the TV also silences all game audio.

import { setMasterMuted, getVolumes, onVolumesChange } from './audio.js'

const SRC = `${import.meta.env.BASE_URL}lobby-music.m4a`
const MUTE_KEY = 'fakeout.muted'
const FADE_STEPS = 10

let audio = null
let wanted = false // should the song be playing right now (i.e. we're in the lobby)?
let blocked = false // the browser refused to autoplay; needs a tap
let fadeTimer = null
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()
const listeners = new Set()

setMasterMuted(muted)

const songVolume = () => Math.min(1, getVolumes().music * 2)
onVolumesChange(() => {
  if (audio && !fadeTimer) audio.volume = songVolume()
})

function element() {
  if (!audio) {
    audio = new Audio(SRC)
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = songVolume()
    audio.addEventListener('playing', emit)
    audio.addEventListener('pause', emit)
  }
  return audio
}

function emit() {
  const state = getMusicState()
  for (const fn of listeners) fn(state)
}

export function getMusicState() {
  return {
    muted,
    blocked: blocked && wanted && !muted,
    playing: !!audio && !audio.paused && !audio.muted,
  }
}

export function subscribeMusic(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function stopWithFade({ rewind, instant = false }) {
  const a = audio
  if (!a || a.paused) {
    if (a && rewind) a.currentTime = 0
    return
  }
  clearInterval(fadeTimer)
  fadeTimer = null
  // Mute is immediate; hidden tabs throttle timers, so don't fade there either.
  if (instant || document.visibilityState === 'hidden') {
    a.pause()
    if (rewind) a.currentTime = 0
    a.volume = songVolume()
    return
  }
  const start = a.volume
  let step = 0
  // Step count is bounded: iOS ignores volume changes, so never wait on it.
  fadeTimer = setInterval(() => {
    step++
    a.volume = Math.max(0, start * (1 - step / FADE_STEPS))
    if (step >= FADE_STEPS) {
      clearInterval(fadeTimer)
      fadeTimer = null
      a.pause()
      if (rewind) a.currentTime = 0
      a.volume = songVolume()
    }
  }, 40)
}

function sync({ rewind = false, instant = false } = {}) {
  if (wanted && !muted) {
    const a = element()
    clearInterval(fadeTimer)
    fadeTimer = null
    a.volume = songVolume()
    a.play()
      .then(() => {
        blocked = false
        emit()
      })
      .catch((err) => {
        // NotAllowedError = autoplay refused (needs a tap). An AbortError just
        // means we paused before loading finished, e.g. the game started.
        if (err?.name === 'NotAllowedError') blocked = true
        emit()
      })
  } else {
    stopWithFade({ rewind, instant })
  }
  emit()
}

// In the lobby → play (loop); leaving the lobby (game started) → fade out and rewind.
export function setLobbyMusic(on) {
  if (wanted === on) return
  wanted = on
  sync({ rewind: !on })
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // preference just won't persist
  }
  setMasterMuted(value)
  sync({ instant: true })
}

// Call from a real tap (e.g. the Join button) so mobile browsers allow the
// song to start later without another tap (the iOS Safari priming trick).
export function primeLobbyMusic() {
  const a = element()
  if (!a.paused) return
  a.muted = true
  a.play()
    .then(() => {
      if (!(wanted && !muted)) a.pause()
      a.muted = false
      emit()
    })
    .catch(() => {
      a.muted = false
    })
}

// Dev-only console handle for checking playback: window.__fakeoutMusic.getMusicState()
if (import.meta.env.DEV && typeof window !== 'undefined') window.__fakeoutMusic = {
  getMusicState,
  debug: () => ({ wanted, muted, blocked, hasEl: !!audio, paused: audio?.paused, elMuted: audio?.muted, ready: audio?.readyState, net: audio?.networkState, err: audio?.error?.message, t: audio?.currentTime }),
}

// Any tap or key press retries a blocked autoplay. Browsers only count some
// events as a gesture that unlocks audio: for touch screens that's the END of
// the touch (touchend / pointerup / click), not pointerdown; for mice,
// mousedown/pointerdown. Listen for all of them (capture phase, so a
// component stopping propagation can't swallow it).
if (typeof document !== 'undefined') {
  const retry = () => {
    if (blocked && wanted && !muted) sync()
  }
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
    document.addEventListener(type, retry, { capture: true, passive: true })
  }
}
