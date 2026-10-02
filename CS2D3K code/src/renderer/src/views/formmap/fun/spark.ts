// "Spark" prompts against blank-page paralysis: provocative questions for product definition and developer joy.

export const SPARKS: string[] = [
  'What is the 10× simpler version?',
  'What would make a developer smile on day one?',
  'What can we delete?',
  'What would we build if we had only one week?',
  'Which feature would users miss most if it vanished tomorrow?',
  'What is the most boring part of the job, and can it disappear?',
  'What would a delightful first five minutes look like?',
  'Which principle are we most tempted to break?',
  'What would the opposite product look like?',
  'What do we keep doing by hand that a machine should do?',
  'What is the riskiest assumption we have not tested?',
  'If this shipped tomorrow, what would embarrass us?',
  'What would make someone tell a friend about it?',
  'Where is the toil hiding?',
  'What is the smallest thing that proves the core idea?',
  'Which feature is fun to build but useless to ship?',
  'What would a game designer add here?',
  'What should never need a settings toggle?',
  'What does "done" feel like for the user?',
  'How could this fail spectacularly — and how do we see it coming?',
  'What would we do if effort were free but attention were scarce?',
  'Which decision are we avoiding?',
  'What could we copy instead of invent?',
  'What would make the feedback loop instant?',
  'What is the one metric that would make us proud?',
  'What would a beginner find confusing?',
  'What would an expert find slow?',
  'What could be a keyboard shortcut instead of a screen?',
  'Which feature would we cut if the budget halved?',
  'What would make debugging feel like detective work instead of chores?',
  'Where could we celebrate progress?',
  'What do we believe that most teams do not?',
  'What would this look like if it were easy?',
  'What does the product say "no" to?',
  'What can the agent do while we sleep?',
  'Which question, once answered, unlocks three others?',
  'What would we build for ourselves first?',
  'What is the most surprising thing it could do?',
  'What would make a Friday afternoon demo irresistible?',
  'What would we regret not deciding now?',
  'Which part should feel like magic, and which should feel boringly reliable?',
  'What would the README brag about?'
]

let last = -1

/** A random prompt (never the same twice in a row). */
export function randomSpark(): string {
  let i = Math.floor(Math.random() * SPARKS.length)
  if (i === last) i = (i + 1) % SPARKS.length
  last = i
  return SPARKS[i]
}
