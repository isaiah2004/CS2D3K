# Generates the sample form-maps (format version 2: plain cards with tags and fields, groups, saved boards):
#   sample-vault/CS2D3K Definition.formmap — the CS2D3K product definition (from the CS2D3K-doc vault content). It uses
#       the Product Definition example pack: tags + presets instead of the old card kinds, a field registry, relation
#       rules, declarative coach checks and two saved boards.
#   sample-vault/Sprint board.formmap — a team board: To do / Doing / Review / Done groups inside a sprint group with a
#       saved groups board and a field board, a backlog, and an embedded kanban node.
# The pack below mirrors src/renderer/src/views/formmap/pack.ts (a unit test checks they agree).
import json, random

random.seed(7)


def hid():
    return ''.join(random.choice('0123456789abcdef') for _ in range(16))


# ---------------------------------------------------------------- the Product Definition pack (see pack.ts)

PD_TAGS = {
    "idea": {"color": "yellow"},
    "principle": {"color": "purple"},
    "goal": {"color": "red"},
    "approach": {"color": "cyan"},
    "feature": {"color": "green"},
    "question": {"color": "orange"},
    "note": {"color": "gray"},
}


def opt(value, label, color=None, points=None, for_=None):
    o = {"value": value, "label": label}
    if color:
        o["color"] = color
    if points is not None:
        o["points"] = points
    if for_:
        o["for"] = for_
    return o


PD_FIELDS = {
    "phase": {"type": "select", "label": "Phase", "options": [opt('mvp', 'Initial (MVP)', 'green'), opt('next', 'Next', 'blue'), opt('later', 'Later', 'purple'), opt('someday', 'Someday', 'gray')]},
    "priority": {"type": "select", "label": "Priority", "options": [opt('must', 'Must', 'red'), opt('should', 'Should', 'orange'), opt('could', 'Could', 'blue'), opt('wont', "Won't", 'gray')]},
    "effort": {"type": "select", "label": "Effort", "options": [opt('xs', 'XS', points=1), opt('s', 'S', points=2), opt('m', 'M', points=3), opt('l', 'L', points=5), opt('xl', 'XL', points=8)]},
    "status": {"type": "select", "label": "Status", "options": [
        opt('idea', 'Idea', 'gray', for_=['feature']), opt('planned', 'Planned', 'blue', for_=['feature']), opt('building', 'Building', 'orange', for_=['feature']),
        opt('done', 'Done', 'green', for_=['feature']), opt('cut', 'Cut', 'red', for_=['feature']),
        opt('open', 'Open', 'orange', for_=['question']), opt('decided', 'Decided', 'green', for_=['question']), opt('parked', 'Parked', 'gray', for_=['question']),
        opt('proposed', 'Proposed', 'orange', for_=['approach']), opt('accepted', 'Accepted', 'green', for_=['approach']), opt('superseded', 'Superseded', 'gray', for_=['approach']),
        opt('raw', 'Raw', 'gray', for_=['idea']), opt('refined', 'Refined', 'blue', for_=['idea']), opt('merged', 'Merged', 'green', for_=['idea']), opt('dropped', 'Dropped', 'red', for_=['idea'])]},
    "fun": {"type": "rating", "label": "Fun factor", "max": 5, "help": "How much joy does this bring to developers?"},
    "acceptance": {"type": "checklist", "label": "Acceptance criteria"},
    "strength": {"type": "rating", "label": "Conviction", "max": 5},
    "metric": {"type": "text", "label": "Success metric", "placeholder": "How will we know?"},
    "horizon": {"type": "select", "label": "Horizon", "options": [opt('final', 'Final goal', 'red'), opt('milestone', 'Milestone', 'orange')]},
    "decision": {"type": "longtext", "label": "Decision"},
    "why": {"type": "longtext", "label": "Why we believe it", "hidden": True},
    "rationale": {"type": "longtext", "label": "Rationale", "hidden": True},
    "alternatives": {"type": "longtext", "label": "Alternatives considered", "hidden": True},
    "options": {"type": "longtext", "label": "Options", "hidden": True},
    "source": {"type": "text", "label": "Source", "hidden": True, "placeholder": "Where did this come from?"},
    "note": {"type": "link", "label": "Linked note", "hidden": True, "placeholder": "[[Note]]"},
}

PD_PRESETS = [
    {"id": "idea", "name": "Idea", "emoji": "💡", "tags": ["idea"], "fields": {"status": "raw"}, "size": {"width": 240, "height": 140}, "hint": "A raw thought. Capture first, triage later."},
    {"id": "principle", "name": "Principle", "emoji": "🧭", "tags": ["principle"], "size": {"width": 280, "height": 150}, "child": "approach", "hint": "A belief that drives decisions (philosophy)."},
    {"id": "goal", "name": "Goal", "emoji": "🎯", "tags": ["goal"], "size": {"width": 280, "height": 150}, "child": "feature", "hint": "An outcome we want. Features should serve goals."},
    {"id": "approach", "name": "Approach", "emoji": "🛠️", "tags": ["approach"], "fields": {"status": "proposed"}, "size": {"width": 300, "height": 170}, "child": "feature", "hint": "An engineering decision with its rationale (ADR-style)."},
    {"id": "feature", "name": "Feature", "emoji": "✨", "tags": ["feature"], "size": {"width": 280, "height": 180}, "hint": "Something the product does. Give it a phase, priority and effort."},
    {"id": "question", "name": "Question", "emoji": "❓", "tags": ["question"], "fields": {"status": "open"}, "size": {"width": 260, "height": 150}, "child": "idea", "hint": "An open question or risk that blocks a decision."},
    {"id": "note", "name": "Note", "emoji": "📝", "tags": ["note"], "size": {"width": 260, "height": 140}, "hint": "Free-form context."},
]

PD_RELATION_RULES = [
    {"from": "idea", "relation": "refines"},
    {"from": "feature", "to": "goal", "relation": "serves"},
    {"from": "approach", "to": "goal", "relation": "serves"},
    {"from": "principle", "to": "principle", "relation": "relates"},
    {"to": "principle", "relation": "because"},
    {"from": "goal", "to": "goal", "relation": "serves"},
    {"from": "feature", "to": "feature", "relation": "depends"},
    {"from": "feature", "to": "approach", "relation": "depends"},
    {"from": "approach", "to": "approach", "relation": "depends"},
]

LIVE_FEATURE = {"tags": ["feature"], "notFields": {"status": "cut"}}
MVP_FEATURE = {"tags": ["feature"], "fields": {"phase": "mvp"}, "notFields": {"status": "cut"}}


def pd_checks(budget):
    return [
        {"id": "feature-no-goal", "type": "relation", "match": LIVE_FEATURE, "relation": "serves", "target": {"tags": ["goal"]}, "level": "warn",
         "title": "{n} {n|feature|features} {n|serves|serve} no goal", "detail": "{titles}. Connect each to the goal it helps achieve — or ask whether it belongs at all.", "good": "Every feature serves a goal"},
        {"id": "goal-no-features", "type": "relation", "dir": "in", "match": {"tags": ["goal"]}, "relation": "serves", "target": LIVE_FEATURE, "level": "warn",
         "title": "{n} {n|goal|goals} with no features", "detail": "{titles}. Nothing we plan to build moves {n|it|them} forward.", "good": "Every goal has features serving it"},
        {"id": "mvp-budget", "type": "sum", "match": MVP_FEATURE, "field": "effort", "label": "MVP", "unit": "pts", "max": budget},
        {"id": "mvp-unsized", "type": "field", "match": MVP_FEATURE, "field": "effort", "level": "info",
         "title": "{n} MVP {n|feature|features} without an effort estimate", "detail": "{titles}. The budget can't see {n|it|them}."},
        {"id": "unused-principles", "type": "relation", "dir": "in", "match": {"tags": ["principle"]}, "relation": "because", "level": "info",
         "title": "{n} {n|principle|principles} nobody relies on", "detail": "{titles}. No decision is \"because\" of {n|it|them} — link one, or let the principle go.", "good": "Every principle drives a decision"},
        {"id": "approaches-proposed", "type": "count", "match": {"tags": ["approach"], "fields": {"status": [None, "proposed"]}}, "level": "info",
         "title": "{n} {n|approach|approaches} still proposed", "detail": "{titles}. Accept or supersede {n|it|them} so everyone builds with confidence.", "good": "All engineering approaches are decided"},
        {"id": "open-questions", "type": "count", "match": {"tags": ["question"], "fields": {"status": [None, "open"]}}, "level": "info", "warnAbove": 3,
         "title": "{n} open {n|question|questions}", "detail": "{titles}. Decide {n|it|them}, or park {n|it|them} explicitly.", "good": "No open questions left"},
        {"id": "mvp-no-acceptance", "type": "field", "match": MVP_FEATURE, "field": "acceptance", "level": "info",
         "title": "{n} MVP {n|feature|features} without acceptance criteria", "detail": "{titles}. How will we know {n|it is|they are} done?", "good": "Every MVP feature has acceptance criteria"},
        {"id": "raw-ideas", "type": "count", "match": {"tags": ["idea"], "fields": {"status": [None, "raw"]}}, "level": "info",
         "title": "{n} raw {n|idea|ideas} waiting in the inbox", "detail": "{titles}. Triage: refine into a feature, merge, or drop."},
    ]


def write(path, data):
    with open(path, 'w', encoding='utf8') as fh:
        json.dump(data, fh, indent='\t', ensure_ascii=False)


# ---------------------------------------------------------------- CS2D3K Definition

W, GAP = 760, 80
col = lambda i: i * (W + GAP)
ROW1, ROW1H = 420, 1000
ROW2 = ROW1 + ROW1H + 80
ROW2H = 820
nodes, edges = [], []


def group(label, emoji, prompt, x, y, w, h, color, preset, order=None, assign=None):
    g = {"id": hid(), "type": "group", "label": label, "emoji": emoji, "prompt": prompt, "x": x, "y": y, "width": w, "height": h,
         "color": color, "preset": preset, "locked": True}
    if order:
        g["order"] = order
    if assign:
        g["assign"] = assign
    nodes.append(g)
    return g


def card(tag, title, x, y, w, h, text='', fields=None, votes=0):
    n = {"id": hid(), "type": "form", "title": title, "text": text, "tags": [tag], "fields": fields or {}, "x": x, "y": y, "width": w, "height": h}
    if votes:
        n["votes"] = votes
    nodes.append(n)
    return n


def rel(a, b, r):
    edges.append({"id": hid(), "fromNode": a["id"], "toNode": b["id"], "relation": r, "toEnd": "arrow"})


group('Core idea', '🌱', 'One or two sentences: what is this product and why must it exist?', 0, 0, 3 * W + 2 * GAP, 340, '3', 'note', 1)
group('Philosophy', '🧭', 'The beliefs that drive every decision. If a feature fights a principle, the principle wins.', col(0), ROW1, W, ROW1H, '6', 'principle', 2)
group('Engineering approach', '🛠️', 'How we build it: stack, process and the key technical decisions — each with a rationale.', col(1), ROW1, W, ROW1H, '5', 'approach', 3)
group('Final goal', '🎯', 'What does success look like? Make it measurable.', col(2), ROW1, W, ROW1H, '1', 'goal', 4, {"horizon": "final"})
g_mvp = group('Initial features (MVP)', '🚀', 'The smallest set of features that proves the core idea. Every one should serve a goal.', col(0), ROW2, W, ROW2H, '4', 'feature', 5, {"phase": "mvp"})
g_later = group('Later features', '🔭', 'Good ideas that are not needed to prove the core idea. Park them here guilt-free.', col(1), ROW2, W, ROW2H, '5', 'feature', 6, {"phase": "later"})
group('Open questions', '❓', 'Unknowns and risks. Decide them, or explicitly park them.', col(2), ROW2, W, ROW2H, '2', 'question', 7)
zi = group('Idea inbox', '📥', 'Dump raw ideas here. Drag them into a group when they are ready.', -(W // 2 + GAP + 40), ROW1, W // 2 + 40, ROW1H + 80 + ROW2H, '3', 'idea')

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

roadmap = {"id": hid(), "name": "Roadmap", "source": {"mode": "groups", "groupIds": [zi["id"], g_later["id"], g_mvp["id"]]}}
by_status = {"id": hid(), "name": "Features by status", "source": {"mode": "field", "field": "status", "values": ["idea", "planned", "building", "done"]}, "filter": {"tags": ["feature"]}}
data = {
    "formmap": {
        "version": 2, "title": "CS2D3K Definition", "template": "product-definition", "hudBoard": by_status["id"],
        "fields": PD_FIELDS, "tags": PD_TAGS, "presets": PD_PRESETS, "relationRules": PD_RELATION_RULES, "checks": pd_checks(24),
        "boards": [roadmap, by_status]
    },
    "nodes": nodes, "edges": edges
}
write('sample-vault/CS2D3K Definition.formmap', data)
print('definition:', len(nodes), 'nodes', len(edges), 'edges')

# ---------------------------------------------------------------- Sprint board

nodes, edges = [], []
CW, CG = 320, 40
sprint = {"id": hid(), "type": "group", "label": "Sprint 12", "emoji": "🏃", "prompt": "Two weeks. Ship the onboarding revamp.", "x": -40, "y": -80, "width": 4 * (CW + CG) - CG + 80, "height": 860, "color": "5"}
nodes.append(sprint)
cols = [("To do", "📝", "2", None), ("Doing", "⚡", "5", None), ("Review", "👀", "6", None), ("Done", "✅", "4", {"done": True})]
CG_ = []
for i, (label, emoji, color, assign) in enumerate(cols):
    g = {"id": hid(), "type": "group", "label": label, "emoji": emoji, "x": i * (CW + CG), "y": 0, "width": CW, "height": 740, "color": color, "preset": "task"}
    if assign:
        g["assign"] = assign
    nodes.append(g)
    CG_.append(g)


def task(g, i, title, text, tags, fields, votes=0):
    n = {"id": hid(), "type": "form", "title": title, "text": text, "tags": tags, "fields": fields, "x": g["x"] + 24, "y": g["y"] + 40 + i * 150, "width": CW - 48, "height": 130}
    if votes:
        n["votes"] = votes
    nodes.append(n)
    return n


t1 = task(CG_[0], 0, "Welcome tour", "Three steps, skippable, remembers where you left off.", ["task", "ux"], {"Owner": "Ana", "Priority": "High", "Estimate": 3}, 2)
t2 = task(CG_[0], 1, "Sample vault picker", "Offer the sample vault on first launch.", ["task"], {"Owner": "Ben", "Priority": "Medium", "Estimate": 2})
t3 = task(CG_[0], 2, "Empty-state illustrations", "", ["design"], {"Priority": "Low", "Estimate": 1})
t4 = task(CG_[1], 0, "Keyboard cheat sheet", "Opens with ?, searchable.", ["task", "ux"], {"Owner": "Cleo", "Priority": "High", "Estimate": 2, "Checklist": [{"text": "List shortcuts", "done": True}, {"text": "Search box", "done": False}]})
t5 = task(CG_[1], 1, "Crash on empty vault", "Opening an empty folder throws.", ["bug"], {"Owner": "Ben", "Priority": "High", "Estimate": 1}, 3)
t6 = task(CG_[2], 0, "Theme picker preview", "Live preview of each theme.", ["task", "design"], {"Owner": "Ana", "Priority": "Medium", "Estimate": 3})
t7 = task(CG_[3], 0, "Faster first launch", "Cache the vault index.", ["task"], {"Owner": "Cleo", "Priority": "High", "Estimate": 5, "done": True})
edges.append({"id": hid(), "fromNode": t1["id"], "toNode": t2["id"], "relation": "depends", "toEnd": "arrow"})
edges.append({"id": hid(), "fromNode": t6["id"], "toNode": t3["id"], "relation": "relates", "toEnd": "arrow"})

backlog = {"id": hid(), "type": "group", "label": "Backlog", "emoji": "📦", "prompt": "Not this sprint. Drag into “To do” when it's time.", "x": -40, "y": 860, "width": 2 * (CW + CG) - CG + 80, "height": 420, "color": "3", "preset": "task"}
nodes.append(backlog)
task({"x": 0, "y": 900}, 0, "Plugin API sketch", "What would a minimal plugin API look like?", ["idea"], {"Priority": "Low"})
task({"x": CW + CG, "y": 900}, 0, "Sync across devices", "", ["idea"], {"Priority": "Medium"}, 4)

kanban = {
    "id": hid(), "type": "kanban", "title": "Bug triage", "x": 820, "y": 900, "width": 820, "height": 380,
    "columns": [
        {"id": hid(), "title": "New", "color": "orange", "cards": [
            {"id": hid(), "title": "Tab title flickers on rename", "tags": ["bug"], "fields": {"Priority": "Low"}},
            {"id": hid(), "title": "Graph labels overlap", "text": "Dense areas at 0.3× zoom.", "tags": ["bug"]}]},
        {"id": hid(), "title": "Confirmed", "color": "blue", "cards": [
            {"id": hid(), "title": "Paste loses formatting", "tags": ["bug"], "fields": {"Priority": "High", "Owner": "Ben"}}]},
        {"id": hid(), "title": "Fixed", "color": "green", "cards": [
            {"id": hid(), "title": "Undo after drag", "tags": ["bug"], "done": True}]}
    ]
}
nodes.append(kanban)

board = {"id": hid(), "name": "Sprint 12", "source": {"mode": "groups", "groupIds": [g["id"] for g in CG_]}, "wip": {CG_[1]["id"]: 3}}
by_priority = {"id": hid(), "name": "Sprint by priority", "source": {"mode": "field", "field": "Priority", "groupId": sprint["id"]}}
data = {
    "formmap": {
        "version": 2, "title": "Sprint board", "template": "kanban", "hudBoard": board["id"],
        "fields": {
            "Owner": {"type": "text"},
            "Priority": {"type": "select", "options": [{"value": "High", "color": "red"}, {"value": "Medium", "color": "orange"}, {"value": "Low", "color": "gray"}]},
            "Estimate": {"type": "number", "label": "Estimate (days)"},
            "Checklist": {"type": "checklist"},
            "done": {"type": "checkbox", "label": "Done"},
        },
        "tags": {"task": {"color": "green"}, "bug": {"color": "red"}, "ux": {"color": "cyan"}, "design": {"color": "purple"}, "idea": {"color": "yellow"}},
        "presets": [
            {"id": "task", "name": "Task", "emoji": "✅", "tags": ["task"]},
            {"id": "bug", "name": "Bug", "emoji": "🐞", "tags": ["bug"], "fields": {"Priority": "High"}},
        ],
        "boards": [board, by_priority]
    },
    "nodes": nodes, "edges": edges
}
write('sample-vault/Sprint board.formmap', data)
print('sprint board:', len(nodes), 'nodes', len(edges), 'edges')
