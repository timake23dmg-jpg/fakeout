import React, { useEffect, useRef, useState } from 'react'
import { getMusicState, subscribeMusic, setMuted } from '../lib/lobbyMusic.js'

// Mute toggle for this device. If the browser blocked autoplay, the first
// tap starts the music instead (the tap itself unlocks audio).
export function MuteButton({ className = '', onGesture }) {
  const [state, setState] = useState(getMusicState)
  useEffect(() => subscribeMusic(setState), [])
  const label = state.muted ? 'Unmute sound' : state.blocked ? 'Start the music' : 'Mute sound'
  return (
    <button
      type="button"
      className={`mute-btn ${state.blocked ? 'blocked' : ''} ${className}`}
      onClick={() => {
        onGesture?.()
        if (!state.blocked) setMuted(!state.muted)
      }}
      aria-pressed={state.muted}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{state.muted ? '🔇' : '🔊'}</span>
      {state.blocked && <span className="mute-hint">Tap for music</span>}
    </button>
  )
}

export const AVATARS = ['🦊', '🐸', '🐙', '🦄', '🐼', '🐯', '🦉', '🐧', '🐵', '🦁', '🐨', '🐷', '🦖', '🐝', '🐢', '🦩']
export const PLAYER_COLORS = ['#FF4F8B', '#3DDC97', '#FFC940', '#5AB8FF', '#B784FF', '#FF8A3D', '#4FE3E3', '#F2F2F2']

export const colorFor = (slot) => PLAYER_COLORS[(slot ?? 0) % PLAYER_COLORS.length]
export const fmt = (n) => (n ?? 0).toLocaleString('en-US')
export const signed = (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Re-renders every `interval` ms, returning the current server-aligned time.
export function useNow(serverNow, interval = 100) {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), interval)
    return () => clearInterval(id)
  }, [serverNow, interval])
  return now
}

export function Avatar({ player, size = 64, done = false, dim = false, flip = true }) {
  if (!player) return null
  return (
    <div
      className={`avatar ${done && flip ? 'avatar-done' : ''} ${dim ? 'avatar-dim' : ''}`}
      style={{ '--size': `${size}px`, '--ring': colorFor(player.slot) }}
      title={player.name}
    >
      <div className="avatar-inner">
        <div className="avatar-face avatar-front">{player.avatar}</div>
        <div className="avatar-face avatar-back">✓</div>
      </div>
    </div>
  )
}

export function TimerRing({ deadline, startedAt, serverNow, size = 120, onTick }) {
  const now = useNow(serverNow, 100)
  const lastSecond = useRef(null)
  const total = Math.max(1, (deadline ?? 0) - (startedAt ?? 0))
  const left = Math.max(0, (deadline ?? 0) - now)
  const secs = Math.ceil(left / 1000)
  useEffect(() => {
    if (secs !== lastSecond.current) {
      lastSecond.current = secs
      if (secs > 0 && secs <= 5) onTick?.(secs)
    }
  }, [secs, onTick])
  if (deadline == null) return null
  const r = size / 2 - 8
  const c = 2 * Math.PI * r
  const urgent = secs <= 10
  return (
    <div className={`timer ${urgent ? 'timer-urgent' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={`${secs} seconds left`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="timer-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="timer-bar"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - left / total)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span key={urgent ? secs : 'n'} className={urgent ? 'timer-num pulse' : 'timer-num'}>{secs}</span>
    </div>
  )
}

// Splits a prompt around its blank ("______") so the blank can be styled.
export function Prompt({ text, fill = null, className = '' }) {
  const parts = String(text || '').split(/_{2,}/)
  return (
    <span className={className}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {p}
          {i < parts.length - 1 && <span className="blank">{fill ?? ' '.repeat(12)}</span>}
        </React.Fragment>
      ))}
    </span>
  )
}
