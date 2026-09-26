import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { createHostTransport, BACKEND } from '../lib/transport/index.js'
import { HostEngine } from '../engine/hostEngine.js'
import { unlockAudio, sfx, playMusic, stopMusic, setVolumes, speak } from '../lib/audio.js'
import { prefersReducedMotion, MuteButton } from '../components/shared.jsx'
import { setLobbyMusic, primeLobbyMusic } from '../lib/lobbyMusic.js'
import {
  LobbyScreen, IntroScreen, RoundTitleScreen, CategoryPickScreen, QuestionScreen, LieEntryScreen,
  PickTruthScreen, RevealScreen, ScoreboardScreen, WinnerScreen, AwardsScreen,
} from './HostScreens.jsx'

const HOST_CODE_KEY = 'fakeout.hostCode'

function loadVolumes() {
  try {
    const v = JSON.parse(localStorage.getItem('fakeout.volumes') || 'null')
    if (v) setVolumes(v)
  } catch {
    // defaults
  }
}

// Fixed 1920x1080 stage scaled to fit any TV/monitor.
function Stage({ children }) {
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <div className="stage-wrap">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div>
    </div>
  )
}

export default function HostApp() {
  const [transport, setTransport] = useState(null)
  const [pub, setPub] = useState(null)
  const [code, setCode] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [needsSoundClick, setNeedsSoundClick] = useState(false)
  const engineRef = useRef(null)
  // Hidden tabs get no animation frames, so exit transitions stall and
  // screens pile up. Remount the transition layer when we become visible.
  const [visKey, setVisKey] = useState(0)
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const onVis = () => {
      setHidden(document.visibilityState === 'hidden')
      if (document.visibilityState === 'visible') setVisKey((k) => k + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const startEngine = useCallback(async (t, roomCode, saved) => {
    engineRef.current?.stop()
    const engine = new HostEngine({ transport: t, code: roomCode, saved, onPublic: setPub })
    engineRef.current = engine
    setCode(roomCode)
    await engine.start()
  }, [])

  useEffect(() => {
    loadVolumes()
    let cancelled = false
    let created = null
    ;(async () => {
      try {
        const t = await createHostTransport()
        created = t
        if (cancelled) return t.close?.()
        setTransport(t)
        const stored = localStorage.getItem(HOST_CODE_KEY)
        if (stored) {
          const saved = await t.loadHostedGame(stored)
          if (saved && !cancelled) {
            setNeedsSoundClick(true)
            await startEngine(t, stored, saved.data)
          }
        }
      } catch (err) {
        setError(err.message)
      }
    })()
    return () => {
      cancelled = true
      engineRef.current?.stop()
      created?.close?.()
      stopMusic()
    }
  }, [startEngine])

  const createRoom = async () => {
    unlockAudio()
    primeLobbyMusic()
    setBusy(true)
    setError(null)
    try {
      const roomCode = await transport.createGame({ profanityFilter: true })
      localStorage.setItem(HOST_CODE_KEY, roomCode)
      await startEngine(transport, roomCode, null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const phase = pub?.phase
  const rm = !!pub?.settings?.reducedMotion || prefersReducedMotion()

  // The lobby song plays from the moment the TV opens (start screen and
  // lobby) and ends the moment the game starts.
  const preGame = !pub || pub.phase === 'LOBBY'
  useEffect(() => {
    setLobbyMusic(preGame)
  }, [preGame])

  // Phase-level sound and music.
  const phaseKey = pub ? `${pub.phase}:${pub.questionNo}:${pub.round}` : null
  useEffect(() => {
    if (!pub) return
    if (pub.phase !== 'LOBBY') sfx('whoosh')
    if (pub.phase === 'LIE_ENTRY') playMusic('chill')
    else if (pub.phase === 'PICK_TRUTH') playMusic('tense')
    else stopMusic()
    if (pub.phase === 'QUESTION' && pub.settings?.tts) speak(pub.question.prompt)
  }, [phaseKey])

  if (error && !pub) {
    return (
      <div className="center-fill host-start">
        <h1 className="logo">FAKE<span>OUT</span></h1>
        <p className="error">{error}</p>
        <button className="btn btn-pink btn-xl" onClick={() => window.location.reload()}>Try again</button>
      </div>
    )
  }

  if (!pub) {
    return (
      <div className="center-fill host-start">
        <h1 className="logo">FAKE<span>OUT</span></h1>
        <p className="tagline">Lie. Spot. Win.</p>
        <button className="btn btn-pink btn-xl" disabled={!transport || busy} onClick={createRoom}>
          {transport ? (busy ? 'Creating room…' : '📺 Create a room') : 'Connecting…'}
        </button>
        <p className="hint">This screen is the shared TV. Players join on their phones.</p>
        <MuteButton className="host" onGesture={unlockAudio} />
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  const joinUrl = `${window.location.origin}${window.location.pathname}#/play?code=${code}`
  const serverNow = transport.serverNow
  const props = { pub, serverNow, rm, engine: engineRef.current }
  const screens = {
    LOBBY: <LobbyScreen {...props} code={code} joinUrl={joinUrl} backend={BACKEND} />,
    INTRO: <IntroScreen {...props} />,
    ROUND_TITLE: <RoundTitleScreen {...props} />,
    FINAL_TITLE: <RoundTitleScreen {...props} final />,
    CATEGORY_PICK: <CategoryPickScreen {...props} />,
    QUESTION: <QuestionScreen {...props} />,
    LIE_ENTRY: <LieEntryScreen {...props} />,
    PICK_TRUTH: <PickTruthScreen {...props} />,
    REVEAL: <RevealScreen {...props} />,
    SCOREBOARD: <ScoreboardScreen {...props} />,
    WINNER: <WinnerScreen {...props} />,
    AWARDS: <AwardsScreen {...props} />,
  }
  const variants = rm
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '-100%' } }

  return (
    <MotionConfig reducedMotion={rm ? 'always' : 'never'}>
      <Stage>
        {phase !== 'LOBBY' && <div className="room-tag">Room {code}</div>}
        {hidden ? (
          <div key={phaseKey} className="phase-layer">{screens[phase]}</div>
        ) : (
          <AnimatePresence initial={false} key={visKey}>
            <motion.div
              key={phaseKey}
              className="phase-layer"
              variants={variants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: rm ? 0.2 : 0.4, ease: [0.34, 1.2, 0.64, 1] }}
            >
              {screens[phase]}
            </motion.div>
          </AnimatePresence>
        )}
      </Stage>
      <MuteButton className="host" onGesture={unlockAudio} />
      {needsSoundClick && (
        <button
          className="sound-banner"
          onClick={() => {
            unlockAudio()
            primeLobbyMusic()
            setNeedsSoundClick(false)
            if (phase === 'LIE_ENTRY') playMusic('chill')
          }}
        >
          🔊 Click to enable sound
        </button>
      )}
      {(phase === 'LOBBY' || phase === 'AWARDS') && <button
        className="new-room"
        onClick={() => {
          localStorage.removeItem(HOST_CODE_KEY)
          engineRef.current?.stop()
          window.location.reload()
        }}
      >
        New room
      </button>}
    </MotionConfig>
  )
}
