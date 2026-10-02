# Generates sample-vault/CS2D3K Definition.formmap from the CS2D3K-doc vault content.
import json, random

random.seed(7)


def hid():
    return ''.join(random.choice('0123456789abcdef') for _ in range(16))


W, GAP = 760, 80
col = lambda i: i * (W + GAP)
ROW1, ROW1H = 420, 1000
ROW2 = ROW1 + ROW1H + 80
ROW2H = 820
nodes, edges = [], []


def zone(label, emoji, prompt, x, y, w, h, color, kind, order=None, assign=None):
    z = {"id": hid(), "type": "zone", "label": label, "emoji": emoji, "prompt": prompt, "x": x, "y": y, "width": w, "height": h,
         "color": color, "defaultKind": kind, "locked": True}
    if order:
        z["order"] = order
    if assign:
        z["assign"] = assign
    nodes.append(z)
    return z


def card(kind, title, x, y, w, h, text='', fields=None, votes=0):
    n = {"id": hid(), "type": "form", "kind": kind, "title": title, "text": text, "fields": fields or {}, "x": x, "y": y, "width": w, "height": h}
    if votes:
        n["votes"] = votes
    nodes.append(n)
    return n


def rel(a, b, r):
    edges.append({"id": hid(), "fromNode": a["id"], "toNode": b["id"], "relation": r, "toEnd": "arrow"})


zone('Core idea', '🌱', 'One or two sentences: what is this product and why must it exist?', 0, 0, 3 * W + 2 * GAP, 340, '3', 'note', 1)
zone('Philosophy', '🧭', 'The beliefs that drive every decision. If a feature fights a principle, the principle wins.', col(0), ROW1, W, ROW1H, '6', 'principle', 2)
zone('Engineering approach', '🛠️', 'How we build it: stack, process and the key technical decisions — each with a rationale.', col(1), ROW1, W, ROW1H, '5', 'approach', 3)
zone('Final goal', '🎯', 'What does success look like? Make it measurable.', col(2), ROW1, W, ROW1H, '1', 'goal', 4, {"horizon": "final"})
zone('Initial features (MVP)', '🚀', 'The smallest set of features that proves the core idea. Every one should serve a goal.', col(0), ROW2, W, ROW2H, '4', 'feature', 5, {"phase": "mvp"})
zone('Later features', '🔭', 'Good ideas that are not needed to prove the core idea. Park them here guilt-free.', col(1), ROW2, W, ROW2H, '5', 'feature', 6, {"phase": "later"})
zone('Open questions', '❓', 'Unknowns and risks. Decide them, or explicitly park them.', col(2), ROW2, W, ROW2H, '2', 'question', 7)
zi = zone('Idea inbox', '📥', 'Dump raw ideas here. Drag them into a zone when they are ready.', -(W // 2 + GAP + 40), ROW1, W // 2 + 40, ROW1H + 80 + ROW2H, '3', 'idea')

card('note', 'CS2D3K — Constrained State Space Documentation Defined Development Kit', 40, 90, 2 * W + GAP - 40, 200,
     "Pronounced *CS2-Deck*. The new way to write software in the AI era: bring out **every ounce of ability** in AI models while building **Secure, Scalable and Satisfying** software — in that order.\n\nDocumentation defines the project; agents do the mundane. And we bring the **fun** back into software development.")

beliefs = [
    ("Don't read all the agent's code", "There is little to no point reading all the code your agent writes."),
    ("Don't reinvent the wheel", "Never make an agent write code it could have copy-pasted or paraphrased."),
    ("Do nearly all the thinking", "Agents act as your muscle memory: they do the mundane."),
    ("Parallelize heavily", "Get used to heavy parallelization of work."),
    ("Over-test, over-critique, over-validate", ""),
    ("Prompts are code", "Prompt quality is everything. Write prompts as though they were code."),
    ("Test every scenario end-to-end", "Full end-to-end testing of every possible scenario, plus agentic testing."),
    ("Ultra-granular logging", "Easy-to-toggle, ultra-granular logging."),
    ("Multiple passes", "Write the code in multiple passes, focusing on a subset of requirements at a time."),
    ("Validate prompts, not code", "Validate your prompts so you don't have to validate your code."),
    ("Sonnet executes, Opus/Fable orchestrate", "Plans must be executable by Sonnet; Opus and Fable do the orchestration and checks."),
]
P = []
for i, (t, txt) in enumerate(beliefs):
    c, r = i % 2, i // 2
    P.append(card('principle', f"{i + 1}. {t}", col(0) + 30 + c * 360, ROW1 + 80 + r * 150, 340, 130, txt, {"strength": 5 if i in (2, 5, 9) else 4}))

appr = [
    ("Documentation-defined development", "Every project = Definition → Architecture → Code. Docs are the source of truth; code is derived from them.", "accepted", [2, 9]),
    ("Constrained state space", "Each pass may only change one layer (definition, architecture or code), keeping agent work predictable.", "proposed", [8, 4]),
    ("Model tiering", "Sonnet executes plans; Opus/Fable orchestrate, review and check.", "accepted", [10]),
    ("Parallel task queue", "Refined ideas are queued and executed in parallel; each first lands as a reviewable artifact.", "accepted", [3, 1]),
    ("Validate everything", "E2E + agentic tests and toggleable granular logs on every change.", "accepted", [4, 6, 7]),
    ("Multi-pass implementation", "Build in passes, each focused on a subset of requirements.", "proposed", [8]),
]
A = []
for i, (t, txt, st, why) in enumerate(appr):
    c, r = i % 2, i // 2
    a = card('approach', t, col(1) + 30 + c * 360, ROW1 + 80 + r * 290, 340, 260, txt, {"status": st, "rationale": txt})
    A.append(a)
    for w in why:
        rel(a, P[w], 'because')

goals = [
    ("Secure, Scalable, Satisfying — in that order", "Every shipped project passes security review, scales, and delights its users.", "Security issues found after release → 0"),
    ("Every ounce of AI ability", "Agents do the mundane; humans do the thinking.", "% of code written by agents with no manual rewrite"),
    ("Bring the fun back", "Developers enjoy building again: less toil, more creation.", "Developers choose to open CS2D3K every day"),
]
G = [card('goal', t, col(2) + 40, ROW1 + 80 + i * 300, 680, 260, txt, {"horizon": "final", "metric": m}) for i, (t, txt, m) in enumerate(goals)]

mvp = [
    ("Idea panel", "Dump ideas and work on them in the context of the project; drafts live here; queue tasks.", 'must', 'm', 5, [2], 7),
    ("Task queue panel", "Refined ideas queued for execution; first implemented as artifacts for review, then applied Definition → Architecture → Code.", 'must', 'l', 4, [1, 0], 6),
    ("Dev agent panel", "Manage agents, chats and subagents.", 'must', 'l', 3, [1], 4),
    ("Review panel", "Questions from running tasks + review proposals: UI mockups, architecture mockups, task-queue updates.", 'must', 'm', 3, [0], 5),
    ("Project workspace", "Each project has a Definition, an Architecture and Code, plus its own context level.", 'must', 'm', 3, [0, 1], 3),
    ("Form-map definition board", "Decide the product visually: philosophy → approach → goals → features. Fun by design.", 'should', 's', 5, [2], 8),
]
M = []
for i, (t, txt, pr, ef, fun, serves, v) in enumerate(mvp):
    c, r = i % 2, i // 2
    f = card('feature', t, col(0) + 30 + c * 360, ROW2 + 80 + r * 240, 340, 220, txt,
             {"phase": "mvp", "priority": pr, "effort": ef, "status": "building" if i == 5 else "planned", "fun": fun}, v)
    M.append(f)
    for s in serves:
        rel(f, G[s], 'serves')
rel(M[1], M[0], 'depends')
rel(M[3], M[1], 'depends')
rel(M[2], M[1], 'depends')
rel(M[0], A[3], 'relates')

later = [
    ("Automated server bug detection", "Detect server bugs automatically and propose fixes in the review panel.", 'could', 'xl', 3, [0]),
    ("Plan screen", "The logical structure of a project at a glance (doc still unfinished).", 'should', 'l', 4, [1]),
    ("Agentic test harness", "Agents that explore and test the product like users.", 'should', 'l', 3, [0, 1]),
    ("UI mockup generation", "Generate UI mockups for review before building.", 'could', 'm', 5, [2]),
]
L = []
for i, (t, txt, pr, ef, fun, serves) in enumerate(later):
    c, r = i % 2, i // 2
    f = card('feature', t, col(1) + 30 + c * 360, ROW2 + 80 + r * 240, 340, 220, txt, {"phase": "later", "priority": pr, "effort": ef, "status": "idea", "fun": fun})
    L.append(f)
    for s in serves:
        rel(f, G[s], 'serves')

qs = [
    ("What exactly does the Plan screen show?", "`Plan screen.md` stops mid-sentence: \"Here is the logical structure of the…\""),
    ("How is a project's 'context level' scoped and stored?", "Project.md: \"A project has its own context level.\""),
    ("How do we keep agent cost under control?", "Opus/Fable orchestration and heavy parallelization can get expensive."),
    ("Desktop only, or also web/mobile?", "Belongs in Project Architecture."),
]
Q = [card('question', t, col(2) + 40, ROW2 + 80 + i * 175, 680, 155, txt, {"status": "open"}) for i, (t, txt) in enumerate(qs)]
rel(Q[0], L[1], 'relates')
rel(Q[2], A[2], 'relates')

ideas = [("XP for merged tasks", "Gamify: earn XP and streaks when tasks land."), ("Voice capture", "Talk ideas into the idea panel."),
         ("Weekly 'what shipped' recap", "Auto-generated, celebratory changelog.")]
for i, (t, txt) in enumerate(ideas):
    card('idea', t, zi["x"] + 30, ROW1 + 80 + i * 190, zi["width"] - 60, 170, txt, {"status": "raw"})

data = {"formmap": {"version": 1, "title": "CS2D3K Definition", "template": "product-definition", "mvpBudget": 24}, "nodes": nodes, "edges": edges}
with open('sample-vault/CS2D3K Definition.formmap', 'w', encoding='utf8') as fh:
    json.dump(data, fh, indent='\t', ensure_ascii=False)
print(len(nodes), 'nodes', len(edges), 'edges')
