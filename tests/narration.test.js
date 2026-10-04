import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phaseLine, revealLines, winnerLines, awardLine, listNames } from '../src/host/narration.js'

const players = [
  { id: 'a', name: 'Ana', score: 1500, isAudience: false },
  { id: 'b', name: 'Ben', score: 500, isAudience: false },
  { id: 'c', name: 'Cat', score: 0, isAudience: false },
]
const byId = Object.fromEntries(players.map((p) => [p.id, p]))

test('listNames', () => {
  assert.equal(listNames(['Ana']), 'Ana')
  assert.equal(listNames(['Ana', 'Ben']), 'Ana and Ben')
  assert.equal(listNames(['Ana', 'Ben', 'Cat']), 'Ana, Ben and Cat')
})

test('a line for every round phase', () => {
  const base = { players, round: 1, questionIndex: 0, pickerId: 'b', question: { category: 'Animals', prompt: 'A ____ can sleep for 3 years.' } }
  for (const phase of ['INTRO', 'ROUND_TITLE', 'FINAL_TITLE', 'CATEGORY_PICK', 'QUESTION', 'LIE_ENTRY', 'PICK_TRUTH', 'SCOREBOARD']) {
    assert.ok(phaseLine({ ...base, phase }), phase)
  }
  assert.match(phaseLine({ ...base, phase: 'CATEGORY_PICK' }), /Ben/)
  assert.equal(phaseLine({ ...base, phase: 'QUESTION' }), 'Animals. A ____ can sleep for 3 years.')
  assert.match(phaseLine({ ...base, phase: 'ROUND_TITLE', round: 2 }), /double/i)
  assert.match(phaseLine({ ...base, phase: 'SCOREBOARD' }), /Ana/)
  assert.match(phaseLine({ ...base, players: [], phase: 'LOBBY' }, { code: 'ABCD' }), /A B C D/)
  assert.equal(phaseLine({ ...base, phase: 'REVEAL' }), null)
})

test('reveal, winner and award lines', () => {
  assert.equal(revealLines({ kind: 'lie', authors: ['a'], pickers: ['b', 'c'] }, byId, false).verdict, "Ben and Cat fell for Ana's lie!")
  assert.match(revealLines({ kind: 'decoy', authors: [], pickers: ['b'] }, byId, false).verdict, /house lie/i)
  const truth = revealLines({ kind: 'truth', text: 'snail', authors: [], pickers: ['a'] }, byId, false)
  assert.equal(truth.verdict, 'snail!')
  assert.match(revealLines({ kind: 'truth', text: 'snail', authors: [], pickers: [] }, byId, true).verdict, /Nobody.*snail/)
  assert.equal(winnerLines([players[0]]).verdict, 'Ana!')
  assert.match(winnerLines(players.slice(0, 2)).start, /tie/i)
  assert.equal(awardLine({ title: 'Biggest Liar', playerIds: ['a'], stat: 'Fooled 3 players' }, byId), 'Biggest Liar: Ana. Fooled 3 players.')
})
