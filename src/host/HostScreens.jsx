import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import confetti from 'canvas-confetti'
import QRCode from 'qrcode'
import { Avatar, Prompt, TimerRing, colorFor, fmt, signed, useNow } from '../components/shared.jsx'
import { sfx, setVolumes, getVolumes } from '../lib/audio.js'
import { narrate } from '../lib/narrator.js'
import { AUTO, BROWSER_VOICE, VOICE_GROUPS, getAiVoiceState, setVoiceChoice, subscribeAiVoice } from '../lib/aiVoice.js'
import { revealLines, winnerLines, awardLine, THANKS_LINE } from './narration.js'
import { revealContext } from './revealContext.js'
import { TIMERS, MIN_PLAYERS, SHORT_GAME_MIN_PLAYERS } from '../engine/constants.js'

const spring = { type: 'spring', stiffness: 420, damping: 22 }
// Sticker tilts (degrees) for the cartoon theme. Animated cards get them via
// Framer Motion, since its inline transform would override a CSS rotate.
const TILTS = [-2, 1.5, -1, 2, 1, -1.5, 2, -1]

function useConfetti(rm) {
  return (opts = {}) => {
    if (rm) return
    confetti({ particleCount: 160, spread: 90, startVelocity: 55, origin: { y: 0.6 }, zIndex: 50, ...opts })
  }
}

const byId = (players) => Object.fromEntries(players.map((p) => [p.id, p]))
const gamePlayers = (pub) => pub.players.filter((p) => !p.isAudience)

// -------------------------------------------------------------- chrome

function TopBar({ pub, serverNow, label }) {
  return (
    <div className="host-topbar">
      <div className="category-label">{label ?? pub.question?.category}</div>
      <div className="topbar-right">
        {pub.multiplier > 1 && <div className="mult-badge small">×{pub.multiplier}</div>}
        <TimerRing deadline={pub.deadline} startedAt={pub.startedAt} serverNow={serverNow} onTick={() => sfx('tick')} />
      </div>
    </div>
  )
}

function AvatarRow({ pub, doneIds = [], detectorIds = [] }) {
  const done = new Set(doneIds)
  return (
    <div className="avatar-row">
      {gamePlayers(pub).map((p) => (
        <div key={p.id} className={`avatar-chip ${p.connected ? '' : 'offline'}`}>
          <Avatar player={p} size={84} done={done.has(p.id)} />
          <span className="chip-name">
            {p.name}
            {detectorIds.includes(p.id) && <span className="detector-badge" title="Used the Truth Detector">🔍</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// --------------------------------------------------------------- LOBBY

export function LobbyScreen({ pub, code, engine, joinUrl, backend }) {
  const [qr, setQr] = useState(null)
  const [vol, setVol] = useState(getVolumes())
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 360, color: { dark: '#231A45', light: '#FFFFFF' } }).then(setQr)
  }, [joinUrl])
  const players = gamePlayers(pub)
  const audience = pub.players.filter((p) => p.isAudience)
  const s = pub.settings || {}
  const toggle = (key) => engine.updateSettings({ [key]: key === 'tts' ? s.tts === false : !s[key] })
  const changeVol = (key, v) => {
    const next = { ...vol, [key]: v }
    setVol(next)
    setVolumes(next)
    try {
      localStorage.setItem('fakeout.volumes', JSON.stringify(next))
    } catch {
      // volumes just won't persist
    }
  }
  const canStart = players.length >= MIN_PLAYERS

  return (
    <div className="screen lobby">
      <div className="lobby-left">
        <h1 className="logo small">FAKE<span>OUT</span></h1>
        <div className="join-box">
          {qr && <img className="qr" src={qr} alt={`QR code to join room ${code}`} />}
          <div>
            <div className="join-label">Join on your phone at</div>
            <div className="join-url">{joinUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}</div>
            <div className="join-label">Room code</div>
            <div className="room-code">{code}</div>
          </div>
        </div>
        {backend === 'local' && <p className="demo-note">Local demo: open players as new tabs in this browser.</p>}
      </div>

      <div className="lobby-right">
        <div className="lobby-players">
          {Array.from({ length: 8 }, (_, i) => players[i]).map((p, i) =>
            p ? (
              <motion.div key={p.id} className={`lobby-slot ${p.connected ? '' : 'offline'}`} initial={{ scale: 0, rotate: 0 }} animate={{ scale: 1, rotate: TILTS[i % TILTS.length] }} transition={spring}>
                <Avatar player={p} size={96} />
                <span className="lobby-name">{p.name}</span>
                {p.id === pub.vipId && <span className="vip-tag">VIP</span>}
              </motion.div>
            ) : (
              <div key={`empty-${i}`} className="lobby-slot empty">
                <span className="lobby-name">Join!</span>
              </div>
            ),
          )}
        </div>
        <div className="audience-count">{audience.length > 0 && `👀 Audience: ${audience.length}`}</div>

        <div className="settings">
          <label className={players.length < SHORT_GAME_MIN_PLAYERS ? 'disabled' : ''}>
            <input type="checkbox" checked={!!s.shortGame} disabled={players.length < SHORT_GAME_MIN_PLAYERS} onChange={() => toggle('shortGame')} />
            Short game (2 + 2 + 1, needs 5+ players)
          </label>
          <label><input type="checkbox" checked={s.profanityFilter !== false} onChange={() => toggle('profanityFilter')} /> Profanity filter</label>
          <label><input type="checkbox" checked={s.tts !== false} onChange={() => toggle('tts')} /> Narrator (reads each round aloud)</label>
          <label><input type="checkbox" checked={!!s.reducedMotion} onChange={() => toggle('reducedMotion')} /> Reduced motion</label>
          <label className="slider">Music <input type="range" min="0" max="1" step="0.05" value={vol.music} onChange={(e) => changeVol('music', +e.target.value)} /></label>
          <label className="slider">SFX <input type="range" min="0" max="1" step="0.05" value={vol.sfx} onChange={(e) => changeVol('sfx', +e.target.value)} /></label>
          <VoicePicker />
          <label className="slider">Voice <input type="range" min="0" max="1" step="0.05" value={vol.voice ?? 1} onChange={(e) => changeVol('voice', +e.target.value)} /></label>
        </div>

        <div className="lobby-start">
          <button className="btn btn-pink btn-xl" disabled={!canStart} onClick={() => engine.startGame()}>
            Everybody's in — start!
          </button>
          <span className="hint">
            {canStart ? 'Or the VIP can start from their phone.' : `Need at least ${MIN_PLAYERS} players (3+ recommended).`}
          </span>
          <p className="music-credit">Music: Kevin MacLeod (incompetech.com), CC BY 4.0</p>
        </div>
      </div>
    </div>
  )
}

function VoicePicker() {
  const [ai, setAi] = useState(getAiVoiceState)
  useEffect(() => subscribeAiVoice(setAi), [])
  return (
    <div className="voice-picker">
      <label className="slider">
        Narrator voice
        <select value={ai.choice} onChange={(e) => setVoiceChoice(e.target.value)}>
          <option value={AUTO}>Auto (Heart, natural voice)</option>
          {VOICE_GROUPS.map((g) => (
            <optgroup key={g.engine} label={g.label}>
              {g.voices.map((v) => <option key={v.id} value={`${g.engine}:${v.id}`}>{v.label}</option>)}
            </optgroup>
          ))}
          <option value={BROWSER_VOICE}>Browser voice (robotic)</option>
        </select>
        <button type="button" className="btn btn-ghost voice-test" onClick={() => narrate("Hi! I'm your Fakeout host. Let's play!", { maxWait: 20000 })}>▶ Test</button>
      </label>
      {ai.text && <span className={`voice-status ${ai.tone}`}>{ai.text}</span>}
    </div>
  )
}

// --------------------------------------------------------- INTRO / TITLES

export function IntroScreen({ engine }) {
  const rules = [
    ['✍️', 'Write a believable lie'],
    ['🔍', 'Spot the real answer'],
    ['🏆', 'Fool friends for points'],
  ]
  return (
    <div className="screen intro">
      <motion.h1 className="logo" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}>
        FAKE<span>OUT</span>
      </motion.h1>
      <p className="tagline big">Lie. Spot. Win.</p>
      <div className="rules">
        {rules.map(([icon, text], i) => (
          <motion.div key={text} className="rule" initial={{ y: 60, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: TILTS[i] }} transition={{ ...spring, delay: 0.4 + i * 0.15 }}>
            <div className="rule-icon">{icon}</div>
            <div>{text}</div>
          </motion.div>
        ))}
      </div>
      <button className="btn btn-ghost skip" onClick={() => engine.skip()}>Skip ▶</button>
    </div>
  )
}

export function RoundTitleScreen({ pub, final = false }) {
  useEffect(() => sfx('drum'), [])
  const title = final ? 'FINAL FAKEOUT' : `ROUND ${pub.round}`
  const sub = final ? 'Triple points!' : pub.round === 2 ? 'Double points!' : 'Lie. Spot. Win.'
  return (
    <div className="screen round-title">
      <motion.h1 className="huge" initial={{ scale: 0, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={spring}>
        {title}
      </motion.h1>
      {pub.multiplier > 1 && (
        <motion.div className="mult-badge" initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: [0, -10, 10, -6, 6, 0] }} transition={{ delay: 0.5, duration: 0.6 }}>
          ×{pub.multiplier}
        </motion.div>
      )}
      <p className="tagline">{sub}</p>
    </div>
  )
}

// ---------------------------------------------------------- CATEGORY_PICK

export function CategoryPickScreen({ pub, serverNow }) {
  const players = byId(pub.players)
  const picker = players[pub.pickerId]
  useEffect(() => {
    sfx('flick')
    const t = setTimeout(() => sfx('ding'), 600)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="screen category-pick">
      <TopBar pub={pub} serverNow={serverNow} label={`Question ${pub.questionIndex + 1} of ${pub.questionsInRound}`} />
      <div className="picker">
        {picker ? (
          <>
            <Avatar player={picker} size={120} />
            <div className="picker-text"><strong>{picker.name}</strong> is picking a category…</div>
          </>
        ) : (
          <div className="picker-text">Picking a random category…</div>
        )}
      </div>
      <div className="category-cards">
        {(pub.categoryOptions || []).map((c, i) => (
          <motion.div key={c} className="category-card" initial={{ y: 400, opacity: 0, rotate: 0 }} animate={{ y: 0, opacity: 1, rotate: TILTS[i] * 1.5 }} transition={{ ...spring, delay: i * 0.1 }}>
            {c}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// --------------------------------------------------------------- QUESTION

export function QuestionScreen({ pub, serverNow, rm }) {
  const words = pub.question.prompt.split(' ')
  useEffect(() => {
    if (rm) return
    const id = setInterval(() => sfx('typeTick'), 70)
    const stop = setTimeout(() => clearInterval(id), Math.min(1500, words.length * 70))
    return () => {
      clearInterval(id)
      clearTimeout(stop)
    }
  }, [])
  const per = rm ? 0 : Math.min(0.09, 1.3 / words.length)
  return (
    <div className="screen question">
      <TopBar pub={pub} serverNow={serverNow} />
      <div className="question-body">
        <p className="question-text big">
          {words.map((w, i) => {
            const parts = w.split(/(_{2,})/)
            return (
              <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * per, duration: 0.05 }}>
                {parts.map((p, j) =>
                  /_{2,}/.test(p) ? (
                    <motion.span key={j} className="blank blank-draw" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: words.length * per + 0.1, duration: 0.4 }}>
                      {' '.repeat(12)}
                    </motion.span>
                  ) : (
                    p
                  ),
                )}{' '}
              </motion.span>
            )
          })}
        </p>
      </div>
    </div>
  )
}

// -------------------------------------------------------------- LIE_ENTRY

export function LieEntryScreen({ pub, serverNow }) {
  const count = pub.submitted?.length ?? 0
  const prev = useRef(count)
  useEffect(() => {
    if (count > prev.current) sfx('pop')
    prev.current = count
  }, [count])
  return (
    <div className="screen lie-entry">
      <TopBar pub={pub} serverNow={serverNow} />
      <div className="question-body">
        <p className="question-text"><Prompt text={pub.question.prompt} /></p>
        <p className="instruction">Type a believable lie on your phone!</p>
      </div>
      <AvatarRow pub={pub} doneIds={pub.submitted} />
    </div>
  )
}

// ------------------------------------------------------------- PICK_TRUTH

export function PickTruthScreen({ pub, serverNow, rm }) {
  const count = pub.picked?.length ?? 0
  const prev = useRef(count)
  useEffect(() => {
    if (count > prev.current) sfx('pop')
    prev.current = count
  }, [count])
  const order = useMemo(() => pub.options.map((_, i) => i).sort(() => Math.random() - 0.5), [pub.options.length])
  useEffect(() => {
    const ids = pub.options.map((_, i) => setTimeout(() => sfx('bubble'), 80 * i))
    return () => ids.forEach(clearTimeout)
  }, [])
  return (
    <div className="screen pick-truth">
      <TopBar pub={pub} serverNow={serverNow} />
      <p className="question-text small"><Prompt text={pub.question.prompt} /></p>
      <div className={`options-grid ${pub.options.length > 6 ? 'dense' : ''}`}>
        {pub.options.map((o, i) => (
          <motion.div
            key={o.id}
            className="option-card"
            initial={rm ? { opacity: 0, rotate: i % 2 ? 1 : -1 } : { scale: 0.6, opacity: 0, rotate: 0 }}
            animate={{ scale: 1, opacity: 1, rotate: i % 2 ? 1 : -1 }}
            transition={rm ? { duration: 0.2 } : { ...spring, delay: order.indexOf(i) * 0.08 }}
          >
            {o.text}
          </motion.div>
        ))}
      </div>
      <AvatarRow pub={pub} doneIds={pub.picked} detectorIds={pub.lifelines} />
    </div>
  )
}

// ----------------------------------------------------------------- REVEAL

export function RevealScreen({ pub, serverNow, rm }) {
  const now = useNow(serverNow, 50)
  const elapsed = now - pub.startedAt
  const steps = pub.reveal.steps
  let index = -1
  steps.forEach((s, i) => {
    if (elapsed >= s.at) index = i
  })
  const step = steps[index]
  return (
    <div className="screen reveal">
      <p className="question-text small"><Prompt text={pub.question.prompt} /></p>
      <AnimatePresence mode="wait">
        {step && (
          <RevealStep
            key={step.optionId}
            step={step}
            elapsed={elapsed - step.at}
            players={byId(pub.players)}
            nobodyFound={pub.reveal.nobodyFound}
            context={revealContext(pub)}
            rm={rm}
            narrating={pub.settings?.tts !== false}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function RevealStep({ step, elapsed, players, nobodyFound, context, rm, narrating }) {
  const fire = useConfetti(rm)
  const isTruth = step.kind === 'truth'
  const verdictAt = isTruth ? 1000 : 1500
  const showVerdict = elapsed >= verdictAt
  const showAuthor = elapsed >= verdictAt + 400
  const played = useRef({})
  const once = (key, fn) => {
    if (!played.current[key]) {
      played.current[key] = true
      fn()
    }
  }

  const lines = useMemo(() => (narrating ? revealLines(step, players, nobodyFound, context) : {}), [step.optionId])
  useEffect(() => {
    once('start', () => {
      if (isTruth) nobodyFound || sfx('drumroll')
      else sfx('riser')
      if (lines.start) narrate(lines.start)
    })
    if (showVerdict) {
      once('verdict', () => {
        if (lines.verdict) narrate(lines.verdict, { queue: isTruth && !nobodyFound })
        if (isTruth && nobodyFound) {
          sfx('sadTrombone')
          fire({ colors: ['#777', '#999', '#555'], particleCount: 60, gravity: 1.6 })
        } else if (isTruth) {
          sfx('fanfare')
          fire({ colors: ['#3DDC97', '#FFFFFF', '#FFC940'] })
        } else {
          sfx('buzzer')
        }
      })
    }
    if (showAuthor && !isTruth && step.kind === 'lie') once('author', () => sfx('chaChing'))
  }, [showVerdict, showAuthor])

  const pickers = step.pickers.map((id) => players[id]).filter(Boolean)
  const authors = step.authors.map((id) => players[id]).filter(Boolean)
  const cardClass = isTruth ? (showVerdict ? (nobodyFound ? 'truth-card grey' : 'truth-card glow') : 'dimmed-card') : 'lie-card'

  return (
    <motion.div
      className={`reveal-stage ${isTruth && !showVerdict ? 'dim' : ''}`}
      initial={rm ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={rm ? { opacity: 0 } : { x: -300, opacity: 0 }}
      transition={rm ? { duration: 0.2 } : spring}
    >
      {isTruth && showVerdict && (
        <motion.div className={`truth-banner ${nobodyFound ? 'grey' : ''}`} initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          {nobodyFound ? 'Nobody found the truth!' : '✓ THE TRUTH'}
        </motion.div>
      )}
      <div className={`reveal-card ${cardClass}`}>
        {step.text}
        {!isTruth && showVerdict && (
          <motion.div className={`stamp ${step.kind === 'decoy' ? 'decoy' : ''}`} initial={rm ? { opacity: 0, rotate: 10 } : { scale: 3, opacity: 0, rotate: 10 }} animate={{ scale: 1, opacity: 1, rotate: 10 }} transition={{ duration: 0.25 }}>
            {step.kind === 'decoy' ? 'HOUSE LIE!' : 'BUSTED!'}
            <small>{step.kind === 'decoy' ? 'nobody wrote it' : "it's a lie"}</small>
          </motion.div>
        )}
      </div>

      <div className="reveal-pickers">
        {pickers.length > 0 && <span className="picked-by">{isTruth ? 'found by' : 'picked by'}</span>}
        {pickers.map((p, i) => (
          <motion.div
            key={p.id}
            className="picker-drop"
            initial={rm ? { opacity: 0 } : { y: -200, opacity: 0 }}
            animate={isTruth && showVerdict && !rm ? { y: [0, -30, 0], opacity: 1 } : { y: 0, opacity: 1 }}
            transition={{ delay: isTruth && showVerdict ? i * 0.1 : 0.3 + i * 0.12, ...(isTruth && showVerdict ? { duration: 0.5 } : spring) }}
          >
            {!isTruth && showVerdict && (
              <motion.span className="fooled-bubble" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring}>
                {step.kind === 'decoy' ? 'oops!' : 'fooled!'}
              </motion.span>
            )}
            <Avatar player={p} size={96} />
            <span className="chip-name">{p.name}</span>
            {showVerdict && step.deltas[p.id] != null && (
              <motion.span className={`points ${step.deltas[p.id] < 0 ? 'neg' : ''}`} initial={{ y: 0, opacity: 0 }} animate={{ y: -20, opacity: 1 }}>
                {signed(step.deltas[p.id])}
              </motion.span>
            )}
          </motion.div>
        ))}
        {step.audienceCount > 0 && <span className="audience-pickers">👀 +{step.audienceCount} audience</span>}
      </div>

      {!isTruth && showAuthor && (
        <motion.div className="author-line" initial={rm ? { opacity: 0, rotate: 1.5 } : { x: 300, opacity: 0, rotate: 1.5 }} animate={{ x: 0, opacity: 1, rotate: 1.5 }} transition={spring}>
          {step.kind === 'decoy' ? (
            <span>A house lie: nobody wrote it.</span>
          ) : (
            <>
              {authors.map((a, i) => (
                <span key={a.id} className="author">
                  {i > 0 && <span>&amp;</span>}
                  <Avatar player={a} size={72} /> {a.name}
                </span>
              ))}
              <span>{step.bought?.length ? 'bought this lie!' : 'wrote this!'}</span>
              {step.bought?.length > 0 && <span className="bought-tag">💸 Lie for me</span>}
              <motion.span className="points gold" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
                {signed(step.deltas[authors[0]?.id] ?? 0)}{authors.length > 1 ? ' each' : ''}
              </motion.span>
            </>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

// ------------------------------------------------------------- SCOREBOARD

export function ScoreboardScreen({ pub, rm }) {
  const [settled, setSettled] = useState(rm)
  const players = gamePlayers(pub)
  const prev = pub.scoreboard?.prev || {}
  const deltas = pub.scoreboard?.deltas || {}
  const charges = pub.scoreboard?.charges || {}
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 900)
    players.forEach((_, i) => setTimeout(() => sfx('blip'), 150 * i))
    return () => clearTimeout(t)
  }, [])
  const scoreOf = (p) => (settled ? p.score : prev[p.id] ?? 0)
  const sorted = [...players].sort((a, b) => scoreOf(b) - scoreOf(a) || a.slot - b.slot)
  const max = Math.max(1, ...players.map((p) => Math.max(p.score, prev[p.id] ?? 0)))
  return (
    <div className="screen scoreboard">
      <h2 className="screen-title">Scores</h2>
      {pub.truth && <p className="truth-recap">The truth: <strong>{pub.truth}</strong> ✓</p>}
      <LayoutGroup>
        <div className="score-rows">
          {sorted.map((p) => (
            <motion.div layout={!rm} key={p.id} className="score-row" transition={spring}>
              <Avatar player={p} size={72} />
              <span className="score-name">{p.name}</span>
              <div className="score-bar-track">
                <motion.div
                  className="score-bar"
                  style={{ background: colorFor(p.slot) }}
                  initial={{ width: `${(Math.max(0, prev[p.id] ?? 0) / max) * 100}%` }}
                  animate={{ width: `${(Math.max(0, scoreOf(p)) / max) * 100}%` }}
                  transition={{ duration: rm ? 0 : 0.8 }}
                />
              </div>
              <span className="score-num">{fmt(scoreOf(p))}</span>
              <span className={`score-delta ${(deltas[p.id] ?? 0) < 0 ? 'neg' : ''}`}>
                {deltas[p.id] ? signed(deltas[p.id]) : ''}
                {charges[p.id] > 0 && <small className="lie-charge">💸 −{fmt(charges[p.id])} for lies</small>}
              </span>
            </motion.div>
          ))}
        </div>
      </LayoutGroup>
    </div>
  )
}

// ----------------------------------------------------------------- WINNER

export function WinnerScreen({ pub, rm }) {
  const fire = useConfetti(rm)
  const players = byId(pub.players)
  const winners = (pub.winners || []).map((id) => players[id]).filter(Boolean)
  useEffect(() => {
    const lines = pub.settings?.tts !== false && winners.length ? winnerLines(winners) : null
    if (lines) narrate(lines.start)
    const t = setTimeout(() => {
      if (lines) narrate(lines.verdict, { queue: true })
      sfx('cheer')
      fire({ particleCount: 300, spread: 160, origin: { y: 0.4 } })
    }, rm ? 0 : 1400)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="screen winner">
      {!rm && <motion.div className="spotlight" initial={{ x: '-60%' }} animate={{ x: ['-60%', '60%', '0%'] }} transition={{ duration: 1.4 }} />}
      <h2 className="screen-title">{winners.length > 1 ? "It's a tie!" : 'The winner is…'}</h2>
      <div className="winners">
        {winners.map((w, i) => (
          <motion.div key={w.id} className="winner" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: rm ? 0 : 1.2 + i * 0.2 }}>
            <motion.div className="crown" initial={{ y: -300 }} animate={{ y: 0 }} transition={{ ...spring, delay: rm ? 0 : 1.6 + i * 0.2 }}>👑</motion.div>
            <Avatar player={w} size={220} />
            <div className="winner-name">{w.name}</div>
            <div className="winner-score">{fmt(w.score)} pts</div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- AWARDS

function CountUp({ value, rm }) {
  const [n, setN] = useState(rm ? value : 0)
  useEffect(() => {
    if (rm) return
    let i = 0
    const id = setInterval(() => {
      i++
      setN(Math.round((value * i) / 15))
      if (i >= 15) clearInterval(id)
    }, 40)
    return () => clearInterval(id)
  }, [value])
  return <span className="count">{n}</span>
}

export function AwardsScreen({ pub, serverNow, engine, rm }) {
  const now = useNow(serverNow, 200)
  const players = byId(pub.players)
  const awards = pub.awards || []
  const idx = Math.floor((now - pub.startedAt) / TIMERS.AWARD_CARD)
  const done = idx >= awards.length
  const award = awards[Math.min(idx, awards.length - 1)]
  const narrating = pub.settings?.tts !== false
  useEffect(() => {
    if (!done && award) {
      sfx('chime')
      if (narrating) narrate(awardLine(award, players))
    } else if (narrating) narrate(THANKS_LINE)
  }, [idx >= awards.length ? -1 : idx])

  if (done || !award) {
    const ranked = [...gamePlayers(pub)].sort((a, b) => b.score - a.score)
    return (
      <div className="screen awards-done">
        <h2 className="screen-title">Thanks for playing!</h2>
        <div className="final-list">
          {ranked.map((p) => (
            <div key={p.id} className="final-row">
              <Avatar player={p} size={60} /> <span>{p.name}</span> <strong>{fmt(p.score)}</strong>
            </div>
          ))}
        </div>
        <div className="end-buttons">
          <button className="btn btn-pink btn-xl" onClick={() => engine.playAgain()}>Play again</button>
          <button className="btn btn-ghost btn-xl" onClick={() => engine.backToLobby()}>Back to lobby</button>
        </div>
        <p className="hint">…or the VIP can choose on their phone.</p>
      </div>
    )
  }

  const value = Number(award.stat.match(/\d+/)?.[0] ?? 0)
  return (
    <div className="screen awards">
      <AnimatePresence mode="wait">
        <motion.div
          key={award.key}
          className="award-card"
          initial={rm ? { opacity: 0 } : { rotateY: 90, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          exit={rm ? { opacity: 0 } : { rotateY: -90, opacity: 0 }}
          transition={{ duration: rm ? 0.2 : 0.5 }}
        >
          <div className="award-title">{award.title}</div>
          <div className="award-players">
            {award.playerIds.map((id) => players[id] && (
              <div key={id} className="award-player">
                <Avatar player={players[id]} size={150} />
                <span>{players[id].name}</span>
              </div>
            ))}
          </div>
          <div className="award-stat">
            {award.stat.split(/\d+/)[0]}<CountUp value={value} rm={rm} />{award.stat.split(/\d+/).slice(1).join('')}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
