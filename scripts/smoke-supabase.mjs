// Smoke test against a live Supabase project (see MULTIPLAYER-ARCHITECTURE.md §10).
// Signs in a host and three anonymous players as separate sessions, then plays
// one full game through the real RPCs, RLS policies and realtime, using the
// same HostEngine the TV runs (timers sped up).
//
//   npm run smoke        (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env)

import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { HostEngine } from '../src/engine/hostEngine.js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env first.')
  process.exit(1)
}

// Separate clients = separate anonymous sessions (no shared storage in Node).
const session = async () => {
  const sb = createClient(url, key, { db: { schema: 'fakeout' }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInAnonymously()
  if (error) throw error
  return { sb, userId: data.user.id }
}
const ok = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// The browser transport touches `document`; give Node a tiny stand-in.
globalThis.document ??= { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
const { createSupabaseHostTransport } = await import('../src/lib/transport/supabaseTransport.js')

async function main() {
  const host = createSupabaseHostTransport({ url, anonKey: key })
  await host.init()
  const code = await host.createGame({ profanityFilter: true })
  console.log('room', code)

  const players = []
  for (const name of ['Ana', 'Ben', 'Cat']) {
    const s = await session()
    const row = ok(await s.sb.rpc('join_game', { p_code: code, p_name: name, p_avatar: '🦊', p_audience: false }))
    players.push({ ...s, id: row.id, name })
  }
  const [ana, ben, cat] = players

  // Like real phones: join the room channel and announce presence.
  await Promise.all(players.map((p) => new Promise((resolve) => {
    const ch = p.sb.channel(`room:${code}`, { config: { presence: { key: p.id } } })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track({ playerId: p.id }).then(resolve)
    })
  })))

  // RLS: a player cannot read questions or the host's secrets.
  assert.equal(ok(await ana.sb.from('questions').select('id')).length, 0, 'questions must be unreadable')
  assert.equal(ok(await ana.sb.from('game_secrets').select('code')).length, 0, 'secrets must be unreadable')
  // Rejoining from the same session returns the same row (reconnect).
  const again = ok(await ana.sb.rpc('join_game', { p_code: code, p_name: 'Ana', p_avatar: '🦊', p_audience: false }))
  assert.equal(again.id, ana.id)

  let pub = null
  const engine = new HostEngine({ transport: host, code, timeScale: 0.1, onPublic: (s) => (pub = s) })
  await engine.start()
  const until = async (pred, ms = 30000) => {
    const t0 = Date.now()
    while (!pub || !pred(pub)) {
      if (Date.now() - t0 > ms) throw new Error(`timeout in ${pub?.phase}`)
      await wait(50)
    }
    return pub
  }

  await until((s) => s.players.length === 3 && s.players.every((p) => p.connected))
  console.log('all 3 players online via presence')
  ok(await ana.sb.from('commands').insert({ game_code: code, player_id: ana.id, cmd: 'start', payload: {} }))
  await until((s) => s.phase === 'INTRO')
  console.log('started by VIP via realtime command')

  let n = 0
  for (;;) {
    const s = await until((x) => ['CATEGORY_PICK', 'FINAL_TITLE', 'WINNER'].includes(x.phase))
    if (s.phase === 'WINNER') break
    if (s.phase === 'CATEGORY_PICK') {
      const picker = players.find((p) => p.id === s.pickerId)
      ok(await picker.sb.from('commands').insert({ game_code: code, player_id: picker.id, cmd: 'pickCategory', payload: { category: s.categoryOptions[0] } }))
    }
    const q = await until((x) => x.phase === 'LIE_ENTRY')
    const qn = q.questionNo
    const answer = engine.s.current.question.answer
    const rejected = ok(await ana.sb.rpc('submit_lie', { p_code: code, p_question_no: qn, p_text: `The ${answer}!` }))
    assert.equal(rejected.reason, 'isTruth')
    for (const p of players) {
      const r = ok(await p.sb.rpc('submit_lie', { p_code: code, p_question_no: qn, p_text: `${p.name} lie ${n}` }))
      assert.ok(r.ok, JSON.stringify(r))
    }
    // Another player's lie is invisible to Ana.
    assert.equal(ok(await ana.sb.from('lies').select('player_id').eq('game_code', code).eq('question_no', qn)).length, 1)
    const pick = await until((x) => x.phase === 'PICK_TRUTH')
    assert.ok(!JSON.stringify(pick).includes('isTruth'), 'truth flag must not be public before reveal')
    for (const p of players) {
      const own = `${p.name} lie ${n}`.toLowerCase()
      const opt = pick.options.find((o) => o.text.toLowerCase() !== own)
      ok(await p.sb.rpc('submit_pick', { p_code: code, p_question_no: qn, p_option_id: opt.id }))
    }
    await until((x) => x.phase === 'REVEAL')
    n++
    console.log(`question ${n} ok`)
  }
  assert.equal(n, 7)
  console.log('winner:', pub.winners.map((id) => players.find((p) => p.id === id)?.name).join(', '))
  engine.stop()
  console.log('SMOKE TEST PASSED')
  process.exit(0)
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err)
  process.exit(1)
})
