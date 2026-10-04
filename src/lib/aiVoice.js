// Main-thread side of the AI narrator voices. Two engines, each in a worker:
//   - Piper  (piper.worker.js): light, faster than real time on basic laptops.
//   - Kokoro (tts.worker.js):   more expressive, but needs a strong graphics
//     card to keep up with the game.
// "Auto" uses Kokoro when this computer has a dedicated graphics card and
// passes a speed check, otherwise Piper. Generated lines are cached, so lines
// can be prepared before they're needed. If nothing is ready, the narrator
// uses the browser's built-in voice.

export const AUTO = 'auto'
export const BROWSER_VOICE = 'browser'
export const VOICE_GROUPS = [
  {
    label: 'Fast AI voices (any computer)',
    engine: 'piper',
    voices: [
      { id: 'en_US-lessac-medium', label: 'Lessac (US, female)' },
      { id: 'en_US-amy-medium', label: 'Amy (US, female)' },
      { id: 'en_US-ryan-medium', label: 'Ryan (US, male)' },
      { id: 'en_US-hfc_male-medium', label: 'Hal (US, male)' },
      { id: 'en_GB-jenny_dioco-medium', label: 'Jenny (UK, female)' },
      { id: 'en_GB-alan-medium', label: 'Alan (UK, male)' },
    ],
  },
  {
    label: 'Premium AI voices (needs a strong graphics card)',
    engine: 'kokoro',
    voices: [
      { id: 'af_heart', label: 'Heart (US, female)' },
      { id: 'af_bella', label: 'Bella (US, female)' },
      { id: 'am_fenrir', label: 'Fenrir (US, male)' },
      { id: 'am_michael', label: 'Michael (US, male)' },
      { id: 'bf_emma', label: 'Emma (UK, female)' },
      { id: 'bm_george', label: 'George (UK, male)' },
    ],
  },
]
const DEFAULT_VOICE = { piper: 'en_US-lessac-medium', kokoro: 'af_heart' }
const VOICE_KEY = 'fakeout.voice2'
const CACHE_MAX = 80
// Generation slower than this many times the audio's own length is too slow.
const MAX_SLOWNESS = 2

const engineOf = (choice) => (choice.includes(':') ? choice.split(':')[0] : null)
const voiceOf = (choice) => choice.split(':')[1]

let choice = (() => {
  try {
    return localStorage.getItem(VOICE_KEY) || AUTO
  } catch {
    return AUTO
  }
})()

// ------------------------------------------------------------------ engines

const listeners = new Set()
function emit() {
  for (const fn of listeners) fn(getAiVoiceState())
}

class Engine {
  constructor(name, makeWorker) {
    this.name = name
    this.makeWorker = makeWorker
    this.worker = null
    this.status = 'idle' // idle | loading | warming | ready | slow | error
    this.pct = 0
    this.device = null
    this.voice = null // voice loaded (Piper holds one voice at a time)
    this.jobs = new Map()
    this.nextId = 1
  }

  set(patch) {
    Object.assign(this, patch)
    emit()
  }

  // Start (or switch to) a voice. Kokoro loads once and speaks any voice.
  load(voice) {
    if (this.name === 'kokoro' && this.worker) return
    if (this.name === 'piper' && this.worker && this.voice === voice) return
    if (!this.worker) {
      try {
        this.worker = this.makeWorker()
      } catch (err) {
        this.set({ status: 'error', message: String(err?.message || err) })
        return
      }
      this.worker.onmessage = ({ data }) => this.onMessage(data)
      this.worker.onerror = (e) => this.set({ status: 'error', message: e.message || 'worker failed' })
    }
    this.voice = voice
    this.set({ status: 'loading', pct: 0 })
    this.worker.postMessage({ type: 'load', voice })
  }

  onMessage(data) {
    if (data.type === 'progress') this.set({ pct: data.pct })
    else if (data.type === 'ready') this.speedCheck(data.device)
    else if (data.id != null) {
      const job = this.jobs.get(data.id)
      this.jobs.delete(data.id)
      if (!job) return
      if (data.type === 'audio') job.resolve({ audio: data.audio, sampleRate: data.sampleRate, ms: data.ms })
      else job.reject(new Error(data.message))
    } else if (data.type === 'error') {
      console.warn(`[fakeout] ${this.name} voice unavailable:`, data.message)
      this.set({ status: 'error', message: data.message })
    }
  }

  async speedCheck(device) {
    this.set({ status: 'warming', device, pct: 100 })
    const voice = this.voice || DEFAULT_VOICE[this.name]
    try {
      await this.generate('Welcome to Fakeout!', voice, true) // first run compiles; not representative
      const r = await this.generate('Round two! Everything is worth double points.', voice, true)
      const slow = r.ms / 1000 > (r.audio.length / r.sampleRate) * MAX_SLOWNESS
      this.set({ status: slow ? 'slow' : 'ready' })
    } catch (err) {
      this.set({ status: 'error', message: String(err?.message || err) })
    }
  }

  generate(text, voice, urgent) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject })
      this.worker.postMessage({ type: 'generate', id, text, voice, speed: 1.1, urgent })
    })
  }
}

const engines = {
  piper: new Engine('piper', () => new Worker(new URL('./piper.worker.js', import.meta.url), { type: 'module' })),
  kokoro: new Engine('kokoro', () => new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' })),
}

// Kokoro only keeps up on a dedicated graphics card; integrated Intel
// graphics and software rendering are too slow, so Auto skips the download.
let strongGpu = null // null = not checked yet
async function checkGpu() {
  try {
    const a = await navigator.gpu?.requestAdapter()
    const info = a?.info || (await a?.requestAdapterInfo?.()) || {}
    strongGpu = !!a && !a.isFallbackAdapter && !info.isFallbackAdapter && !/intel|swiftshader|microsoft/i.test(info.vendor || '')
  } catch {
    strongGpu = false
  }
  emit()
}

// --------------------------------------------------------------- selection

// Which engine + voice the narrator should use right now, or null for the
// browser voice.
function current() {
  const p = engines.piper
  const k = engines.kokoro
  const piper = p.status === 'ready' ? { engine: 'piper', voice: p.voice } : null
  if (choice === BROWSER_VOICE) return null
  if (choice === AUTO) return k.status === 'ready' ? { engine: 'kokoro', voice: DEFAULT_VOICE.kokoro } : piper
  if (engineOf(choice) === 'kokoro') return k.status === 'ready' ? { engine: 'kokoro', voice: voiceOf(choice) } : piper
  return piper
}

// Load whatever the current choice needs (Piper is always the fallback).
function ensureLoaded() {
  if (typeof Worker === 'undefined') return
  const wantPiper = engineOf(choice) === 'piper' ? voiceOf(choice) : DEFAULT_VOICE.piper
  if (choice !== BROWSER_VOICE) engines.piper.load(wantPiper)
  if (engineOf(choice) === 'kokoro' || (choice === AUTO && strongGpu)) engines.kokoro.load()
}

export function loadAiVoice() {
  ensureLoaded()
  if (strongGpu == null) checkGpu().then(ensureLoaded)
}

export const getVoiceChoice = () => choice
export function setVoiceChoice(id) {
  choice = id
  try {
    localStorage.setItem(VOICE_KEY, id)
  } catch {
    // choice just won't persist
  }
  ensureLoaded()
  emit()
}

export const aiVoiceActive = () => current() != null

const pctText = (e) => (e.status === 'warming' ? 'warming up…' : `downloading ${e.pct}% (first time only)…`)
const busy = (e) => e.status === 'loading' || e.status === 'warming'

// One line for the lobby: what the narrator is using and why.
export function getAiVoiceState() {
  const p = engines.piper
  const k = engines.kokoro
  const cur = current()
  let text = ''
  let tone = 'info'
  if (choice === BROWSER_VOICE) text = 'Using the browser voice'
  else if (engineOf(choice) === 'kokoro' && busy(k)) text = `Premium voice ${pctText(k)}${cur ? ' Using the fast voice meanwhile.' : ''}`
  else if (engineOf(choice) === 'kokoro' && (k.status === 'slow' || k.status === 'error')) {
    text = `Premium voice is too slow on this computer. ${cur ? 'Using the fast AI voice.' : 'Using the browser voice.'}`
  } else if (cur) {
    tone = 'ready'
    text = cur.engine === 'kokoro' ? 'Premium AI voice ready (graphics card)' : 'AI voice ready'
    if (choice === AUTO && busy(k)) text += ` · premium voice ${pctText(k)}`
  } else if (busy(p)) text = `AI voice ${pctText(p)} Browser voice until then.`
  else if (p.status === 'slow') text = 'This computer is too slow for the AI voice: using the browser voice'
  else if (p.status === 'error') text = 'AI voice unavailable here: using the browser voice'
  return { text, tone, choice }
}

export function subscribeAiVoice(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ------------------------------------------------------------ synthesizing

const cache = new Map() // `${engine}:${voice}|${text}` -> Promise<{ audio, sampleRate }>

// Audio for a line in the current voice, generated once and cached.
// `urgent` jumps the queue (a line needed now, not a warm-up).
export function synthesize(text, { urgent = false } = {}) {
  const cur = current()
  if (!cur) return Promise.reject(new Error('no AI voice ready'))
  const key = `${cur.engine}:${cur.voice}|${text}`
  let p = cache.get(key)
  if (p) {
    cache.delete(key) // refresh LRU position
  } else {
    p = engines[cur.engine].generate(text, cur.voice, urgent)
    p.catch(() => cache.delete(key))
  }
  cache.set(key, p)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return p
}
