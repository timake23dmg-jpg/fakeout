// What the narrator says. Pure functions of the public game state, so the
// lines are easy to test and tweak. Lines are short enough to fit their
// phase's timer (e.g. a round title is on screen for 3 s).

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)]

export function listNames(names) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const nameOf = (pub, id) => pub.players.find((p) => p.id === id)?.name
const gamePlayers = (pub) => pub.players.filter((p) => !p.isAudience)
const spell = (code) => String(code).split('').join(' ')

// Line for the start of a phase, or null for phases narrated by their screen
// (REVEAL, WINNER, AWARDS speak in step with their animations).
export function phaseLine(pub, { code } = {}) {
  switch (pub.phase) {
    case 'LOBBY':
      return gamePlayers(pub).length === 0 && code
        ? `Welcome to Fakeout! Grab your phones and join with room code ${spell(code)}.`
        : null
    case 'INTRO':
      return 'Welcome to Fakeout! Write a lie that sounds true, spot the real answer, and fool your friends for points.'
    case 'ROUND_TITLE':
      return pub.round === 2
        ? pick(['Round two! Everything is worth double.', 'Round two! Double points!'])
        : pick(['Round one! Let the lying begin.', "Round one! Let's get lying."])
    case 'FINAL_TITLE':
      return 'The Final Fakeout! One question, triple points.'
    case 'CATEGORY_PICK': {
      const n = pub.questionIndex + 1
      const picker = nameOf(pub, pub.pickerId)
      if (!picker) return `Question ${n}. Picking a random category.`
      return pick([`Question ${n}. ${picker}, pick a category!`, `Question ${n}. ${picker}, choose a category on your phone.`])
    }
    case 'QUESTION':
      return `${pub.question.category}. ${pub.question.prompt}`
    case 'LIE_ENTRY':
      return pick(['Now write a believable lie!', 'Type a lie that sounds true!', 'Time to lie. Make it convincing!'])
    case 'PICK_TRUTH':
      return pick(["Pens down! Now, which one's the truth?", 'Find the truth! Pick it on your phone.', 'One of these is real. Which one?'])
    case 'SCOREBOARD':
      return leaderLine(pub)
    default:
      return null
  }
}

export function leaderLine(pub) {
  const players = gamePlayers(pub)
  if (!players.length) return null
  const top = Math.max(...players.map((p) => p.score))
  const leaders = players.filter((p) => p.score === top)
  if (top <= 0) return 'Nobody has any points yet!'
  if (leaders.length > 1) return `${listNames(leaders.map((p) => p.name))} are tied for the lead!`
  return pick([`${leaders[0].name} is in the lead!`, `${leaders[0].name} takes the lead with ${top} points.`])
}

// Two beats per reveal step: one when the card appears, one at the verdict.
export function revealLines(step, players, nobodyFound) {
  const names = (ids) => listNames(ids.map((id) => players[id]?.name).filter(Boolean))
  if (step.kind === 'truth') {
    if (nobodyFound) return { start: null, verdict: `Nobody found the truth! It was ${step.text}.` }
    return { start: 'And the truth is…', verdict: `${step.text}!` }
  }
  const fooled = names(step.pickers)
  if (step.kind === 'decoy') {
    return { start: null, verdict: fooled ? `A house lie! ${fooled} fell for it.` : 'A house lie!' }
  }
  const authors = names(step.authors)
  return { start: null, verdict: fooled ? `${fooled} fell for ${authors}'s lie!` : `That lie was by ${authors}!` }
}

export function winnerLines(winners) {
  const names = listNames(winners.map((w) => w.name))
  return { start: winners.length > 1 ? "It's a tie!" : 'And the winner is…', verdict: `${names}!` }
}

export function awardLine(award, players) {
  const names = listNames(award.playerIds.map((id) => players[id]?.name).filter(Boolean))
  return `${award.title}: ${names}. ${award.stat}.`
}

export const THANKS_LINE = 'Thanks for playing Fakeout! Play again, or head back to the lobby.'
