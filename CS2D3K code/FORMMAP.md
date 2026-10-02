# Form-map: design

A **form-map** (`.formmap`) is a **more advanced canvas**. It is the plain canvas (cards, notes, code cells, web pages,
groups, edges), plus:

- **plain cards** with free **tags** and typed **fields**;
- **groups** that give the cards inside them meaning (a group can set fields on the cards dropped into it);
- **kanban**: saved **boards** built from the canvas's groups or fields, and **kanban nodes** embedded on the canvas;
- typed **relations**, a **Why?** trace, a **Coach**, **lenses** (Map, Board, Table, Doc), **pitch mode**, and some fun.

The plain `.canvas` stays simple: none of this applies to it.

Version 1 was built for one job, deciding what to build, with seven fixed card kinds. The user's feedback was:

> "Formmap is actually just a more advanced canvas. The kanban abilities mean I can create custom kanban boards from
> the groups on the canvas and embed kanbans on the canvas. … the groups like philosophy, initial features and future
> features are not the required structure but examples of things the canvas must be able to capture."

So version 2 removes everything built-in about the domain. The structure is **data the map carries**: groups, a field
registry, tag colors, card presets, saved boards, relation rules and coach rules. The Product Definition layout is now
**one template** that ships that data as an example.

Read `AGENTS.md` first for the architecture, contracts, commands and quality bar.

## First principles: each job and the feature that does it

| Job | Feature | Why this shape |
| --- | --- | --- |
| **Capture** with zero friction | Double-click anywhere, the toolbar (a plain card and the map's presets), mind-map keys (Tab = child, Enter = sibling), Spark prompts | A card needs nothing but a title. Presets make "a feature" or "a bug" one click without the app knowing what those are. |
| **Describe** a card | Free **tags** (colored chips) + typed **fields** from a map-wide **registry** | Tags are cheap, open-ended categories. Fields are typed properties (select, number, date, checklist…) that boards, the table and the coach can use. A registry keeps one definition per field name, so cards share options, colors and types. |
| **Structure** by position | **Groups** with optional `assign`, preset, prompt, emoji, color, pitch order and lock. Groups nest. | Position = meaning: dropping a card into "Later" sets `phase: later`. Any field works, and nesting composes: Sprint 12 → Doing sets `sprint` and `status`. |
| **Flow** work across stages | **Saved boards** (Board lens): groups as columns, or one group split by a field | A board is a view of the canvas, not a copy. Groups boards move cards *on the canvas* (geometry stays the truth); field boards set the field. Both stay live. |
| **Track** a small, self-contained list on the canvas | The **kanban node** | Some boards don't deserve canvas real estate per card: a node holds its own columns and cards, and cards can move in and out of it. |
| **Relate**: why does this exist? | Typed **relations** (serves, because, depends, refines, contradicts, relates, or any custom word) and the **Why?** trace | Same as v1, but the relation list is open. Relation **rules** on tags infer the default relation when connecting. |
| **Decide** and keep the map honest | **Coach**: generic checks plus the map's own declarative **rules**; dot votes; budgets | Generic checks work on any map. Domain checks ("every feature serves a goal") are data in the map, so a template can bring its own. |
| **See it differently** | Lenses: Map, Board, Table (the registry as columns), Doc | One data set, four views. |
| **Communicate** | Pitch mode (ordered groups as slides), Doc export (a markdown note) | The doc follows the groups in pitch order, so the map's layout is the document's outline. |
| **Fun** | Confetti when a card reaches a board's last column or a done checkbox is ticked, a progress HUD, pop/wiggle micro-animations, the pen | Celebrate finishing, generically: the last column of a board is "done" by convention. |

Deliberately **not** built: fixed card kinds, a fixed status workflow, a layers panel (lenses, the tag focus and locked
groups cover it), a second canvas file type for kanban.

## Data model (`views/formmap/schema.ts`)

A `.formmap` file is JSON Canvas (the same parser as `.canvas`), `formmap.version: 2`:

```jsonc
{
  "formmap": {
    "version": 2,
    "title": "Sprint board",
    "fields": {                                   // field registry: name → definition
      "Priority": { "type": "select", "options": [{ "value": "High", "color": "red" }, { "value": "Low" }] },
      "status":   { "type": "select", "label": "Status",
                    "options": [{ "value": "open", "for": ["question"] }, { "value": "done", "for": ["feature"] }] },
      "Estimate": { "type": "number", "label": "Estimate (days)" },
      "done":     { "type": "checkbox" }
    },
    "tags": { "bug": { "color": "red" }, "task": { "color": "green" } },
    "presets": [{ "id": "bug", "name": "Bug", "emoji": "🐞", "tags": ["bug"], "fields": { "Priority": "High" } }],
    "boards": [
      { "id": "b1", "name": "Sprint 12", "source": { "mode": "groups", "groupIds": ["todo", "doing", "done"] },
        "order": { "todo": ["c2", "c1"] }, "wip": { "doing": 3 } },
      { "id": "b2", "name": "By priority", "source": { "mode": "field", "field": "Priority", "groupId": "sprint" },
        "filter": { "tags": ["task"] } }
    ],
    "relationRules": [{ "from": "feature", "to": "goal", "relation": "serves" }],
    "checks": [{ "id": "open-q", "type": "count", "match": { "tags": ["question"], "fields": { "status": [null, "open"] } },
                 "title": "{n} open {n|question|questions}", "warnAbove": 3 }],
    "hudBoard": "b1"
  },
  "nodes": [
    { "id": "c1", "type": "form", "title": "Crash on empty vault", "text": "markdown…", "tags": ["bug"],
      "fields": { "Priority": "High", "done": true }, "votes": 3, "x": 0, "y": 0, "width": 260, "height": 130 },
    { "id": "doing", "type": "group", "label": "Doing", "emoji": "⚡", "prompt": "Finish before you start.",
      "assign": { "status": "doing" }, "preset": "task", "order": 2, "locked": false, "color": "5", "x": 0, "y": 0, … },
    { "id": "k", "type": "kanban", "title": "Bug triage",
      "columns": [{ "id": "n", "title": "New", "color": "orange", "collapsed": false,
                    "cards": [{ "id": "x", "title": "…", "text": "…", "tags": ["bug"], "fields": {}, "done": false }] }], … },
    { "id": "d", "type": "drawing", "points": [0, 0, 10, 4], "strokeWidth": 3, … }
  ],
  "edges": [{ "id": "e", "fromNode": "c1", "toNode": "c2", "relation": "depends" }]
}
```

- **Cards** (`type: "form"`): `title`, markdown `text`, `tags[]`, `fields{}`, optional `votes`. There is **no `kind`**.
  The accent is the node color, else the first tag's color.
- **Field types**: `text`, `longtext`, `number`, `select`, `multiselect`, `checkbox`, `date`, `rating` (`max`),
  `checklist` (`[{ text, done }]`), `link` (`[[Note]]`). A definition may have a `label` (display name), `options`
  (`value`, `label`, `color`, `points` for sums, and `for`: the tags an option is offered to), `color`, and `hidden`
  (not shown on the card face).
  The registry **builds itself**. Fields added from a card, a group assign, a kanban card or a hand edit are registered
  with an inferred type, and the Map tab edits them: rename everywhere, change type (values are converted, and select
  types gain options for the values in use), edit options and colors, delete everywhere.
- **Colors** of tags, options and fields are named (`red orange yellow green cyan blue purple pink gray`) or `#hex`.
  Node colors keep JSON Canvas's `"1"`–`"6"`.
- **Groups** are the canvas's own `group` node type with optional extras, so a converted `.canvas` keeps working and a
  `.formmap` renamed to `.canvas` still opens in any JSON Canvas app. A card belongs to every group containing its
  center. **Assigns** apply outermost first and inner groups win. A group's **parent** is the smallest *larger* group
  containing its center, which prevents cycles between overlapping groups. **Locked** groups can't be moved or resized,
  and their body counts as background.
- **Kanban nodes** are self-contained: their cards are not canvas nodes and have no edges.
- **Edges**: `relation` is any non-empty string. The six presets have colors, dashes, verbs and inverse labels; a
  custom relation gets a neutral style and uses its own name as the verb.

### Boards (`views/formmap/boards.ts`)

- **groups mode**: one column per group, in board order. A card is in the column of the **innermost** board group
  containing it. A card inside a nested group that is not a column counts for its parent column. Moving a card to a
  column moves it **geometrically** to a free spot in that group: no overlap, avoiding nested groups. The group's
  fields are then applied.
- **field mode**: the cards of one group (nested groups included) or of the whole map, split by a field's values:
  - select: the options (optionally a chosen subset `values`, and options scoped by the board's tag filter);
  - checkbox: Not done / Done;
  - rating: one column per star count;
  - other types: one column per distinct value.

  A "No value" column comes first when used (always for checkboxes). Values not on the board go to a locked "Other
  values" column. Moving a card sets or clears the field. If a group assigned the old value and another group assigns
  the new one, the card also moves there.
- `order` stores each column's card order. Cards without a stored position follow in map reading order. `wip` holds
  WIP limits per column. `filter` (tags / fields) narrows the board.
- The **done column** is the last real column. The HUD ring shows its share of the board's cards, and a card that
  newly lands there gets confetti.

### Coach (`views/formmap/analysis.ts`)

**Generic checks** run on every map:
- broken relations;
- contradictions between open cards;
- cards whose fields disagree with their groups' assigns (with an "Apply the group fields" fix);
- cards a field board can't place;
- cards outside groups;
- empty groups;
- untagged cards (once the map uses tags);
- cards with open checklist items;
- duplicate titles.

**Rules** (`formmap.checks`) are declarative:
- `relation`: matching cards without a relation to or from a matching target;
- `field`: matching cards where a field is empty;
- `count`: matching cards are flagged, and `warnAbove` raises the level above a count;
- `sum`: adds up option points (or numbers) over matching cards against a budget `max`, shown as an editable budget bar.

A filter (`CardFilter`) has `tags`, `notTags`, `fields` and `notFields`. A field value matches by equality, by "any of"
for an array, or by emptiness for `null`. Titles use `{n}`, `{titles}` and `{n|singular|plural}`. A broken rule never
breaks the coach.

## Migration (version 1 → 2, in `normalizeFormMap`)

A file is migrated **in memory** when it loads (`useCanvasDoc(path, normalizeFormMap)`). It is rewritten only on the
next edit, and nothing is lost:

| Version 1 | Version 2 |
| --- | --- |
| `form.kind` | the card's **first tag**. Kinds get their old colors in `formmap.tags`. |
| `form.fields` | **unchanged**, every key registered in `formmap.fields` with the old type, label and options. The per-kind `status` lists become one `status` select whose options carry `for: [kind]`, so a question still offers Open / Decided / Parked. Fields that only had a meaning in the inspector (`why`, `rationale`…) are `hidden` on cards, as before. |
| `type: "zone"` | `type: "group"`. `locked` defaulted to true for zones (kept: `locked: true` unless the zone was explicitly unlocked). `defaultKind` becomes `preset`. `label`, `emoji`, `prompt`, `assign`, `order` and `color` are unchanged. |
| the seven kinds | `formmap.presets` (ids = kind names, same emoji, default size and Tab child) |
| `inferRelation` by kind | `formmap.relationRules` on tags |
| the product-definition coach checks | `formmap.checks` rules. `mvpBudget` becomes the `mvp-budget` sum rule's `max`. |
| `formmap.version: 1` | `2`. Unknown keys of nodes and meta are kept. |

Presets, rules and checks are only added when the old map used kinds, so a converted canvas stays plain. The same
function also repairs hand-edited data:
- bad fields become `{}`;
- bad tags are dropped;
- non-string relations are dropped;
- kanban nodes get unique ids, and cards that aren't objects are dropped.

It also registers fields and tags that cards use but the registries lack. It returns the same object when nothing
changes, so there is no spurious re-render or save. Covered by `schema.migration.test.ts` (the real v1 sample is in
`tests/fixtures/definition-v1.formmap`) and the e2e test `form-map migration`.

## Interaction notes

- **Map**:
  - Card face: tags, title, markdown body, and the fields as chips. Clicking a select chip opens its menu, stars are
    clickable, a checkbox shows as "✓ Field", a checklist as a progress chip, a link as a chip that opens the note.
  - A selected card shows **+ tag** and **+ Field** chips.
  - Dragging a card shows the group's drop label ("Phase → Later").
  - Group context menu: lock, rename, tidy, add a preset card, *Create board from group*, *Board of this group by…*,
    *Convert to kanban node*, *Present from here*.
  - Selecting several groups offers *Create board from N groups* and *Convert selected groups to kanban node*.
- **Kanban node**:
  - Cards drag within, between columns and between kanban nodes (drop line feedback). Dropped outside, on the canvas, a
    card becomes a canvas card at that point, keeping its fields (a done card gets `done: true`). The drop group's
    fields apply.
  - A canvas card dragged over a column highlights it. Dropped there, it moves into the board, keeping its id, text,
    tags, fields, votes and color; its relations are removed.
  - Columns are added, renamed (double-click), recolored, collapsed, reordered (drag the header) and deleted.
  - Cards are added inline (Enter keeps adding) and edited inline (double-click; Ctrl+Enter saves).
  - Keyboard: Space toggles done, Shift+←/→ moves between columns, Alt+↑/↓ reorders, Delete removes. Alt+←/→ are the
    app's back/forward.
  - **Convert to groups** lays the columns out as groups inside a parent group named after the board, with the cards
    as canvas cards, and saves a groups board over them. **Convert to kanban node** does the inverse: a single parent
    group converts its child groups. Saved boards forget removed groups.
- **Board lens**:
  - Tabs of saved boards; right-click a tab to rename it, make the HUD follow it, choose its columns, or delete it.
  - *New board* opens a setup panel: groups as columns, or split by a field (whole map or one group).
  - Cards drag between and within columns, with a placeholder.
  - Each column has quick-add, a WIP limit (the count turns red over it) and a menu.
  - A tag filter narrows the board.
  - Columns render at most 150 cards until "Show more".
  - Keyboard: arrows move between cards, Shift+←/→ moves a card to the next column, Alt+↑/↓ reorders.
- **Inspector**:
  - **Card** tab:
    - a card: title, notes, tags, its fields with typed editors; *Add field* from the registry or a new name and type;
      removing a field; a field's menu to rename it everywhere, change its type or hide it; votes, relations (presets
      or custom) and Why?.
    - a group: label, emoji, color, prompt, preset, assigned fields (any field), pitch order and lock.
    - a kanban node: title and columns, convert to groups.
    - several cards: tags, and select fields in bulk.
  - **Coach**: budgets, tag tiles (click to focus the tag), and the checks.
  - **Map**: title, export path, Spark, the groups navigator, and the editors for the field registry, tags and presets.
    A preset can be made from the selected card.
- **Table**: the registry is the columns (with type icons). Filter by group or tags; sort any column; edit inline,
  including tags and multi-select.
- **Doc**: the groups in pitch order, then spatial order, as sections, nested groups as subsections. Each card has its
  tags, body, fields, votes and outgoing relations. Kanban nodes become task lists per column. Loose cards come last.
  Export writes `<map> - Doc.md`.
- **HUD**: the progress ring of the chosen board's last column (or of all checklists), then cards, groups,
  boards + kanbans, checked items and votes. Click a stat to highlight its cards; click the title to choose the board.

## Templates (`views/formmap/templates.ts`, `pack.ts`)

- **Blank**: nothing.
- **Brainstorm**: an idea inbox group and an Idea preset whose Tab child is another idea.
- **Kanban**: To do / Doing / Done groups inside a Board group, a saved groups board, Task and Bug presets, a few
  fields and starter cards.
- **Product definition** (the example): the old layout. It uses `pack.ts` for tags, presets, the field registry,
  relation rules and coach checks, plus two boards ("Roadmap" over Inbox → Later → MVP, and "Features by status").

The samples are generated by `scripts/gen-definition.py`. `sample-vault/CS2D3K Definition.formmap` uses the
Product Definition pack, and `sample-vault/Sprint board.formmap` shows nested groups, two saved boards and a kanban
node. A unit test checks that the Python pack and `pack.ts` agree, and that the migrated v1 sample matches the
regenerated one.

## Code map

| Area | Files |
| --- | --- |
| model, registry, migration | `schema.ts`, `pack.ts` |
| boards, kanban ops, placement | `boards.ts`, `kanban.ts`, `layout.ts` |
| coach, why-trace, stats | `analysis.ts` |
| shell, controller | `FormMapView.tsx` (adds `meta`, `activeBoard`, `openBoard`), `context.ts` |
| map lens | `map/MapLens.tsx`, `map/mapNodes.tsx` (cards, groups, drawings), `map/KanbanNode.tsx`, `map/MapToolbar.tsx`, `map/Minimap.tsx`, `map/logic.ts`, `map/mapContext.ts` |
| lenses | `lenses/BoardLens.tsx`, `lenses/TableLens.tsx`, `lenses/DocLens.tsx` + `lenses/docMarkdown.ts`, `lenses/ops.ts` (all edits), `lenses/widgets.tsx` |
| inspector | `inspector/CardTab.tsx`, `inspector/CoachTab.tsx`, `inspector/MapTab.tsx`, `inspector/fields.tsx`, `inspector/Relations.tsx` |
| fun | `fun/Hud.tsx`, `fun/celebrate.ts`, `fun/spark.ts` |
| engine hooks used | `CanvasExtension.onMoveStart` / `onMoveDrag` (a card dragged over a kanban column), `LodNodeStyle.lanes` (kanban columns on the canvas layer) |

Every edit goes through `ctl.doc.update`, one undo step each. A drag and what it causes (assign, kanban drop) is
one undo step.

## Performance

- Cards render from a `MetaContext` whose value only changes when `formmap` changes, so moving a card doesn't
  re-render the others.
- Group counts and dimming are computed once per data change.
- Hit testing for kanban drops runs per pointer move only when the map has a kanban node.
- A kanban node is a normal engine node: it is culled off-screen. Zoomed out it renders a placeholder (title,
  column headers and up to 6 card titles per column), and on the canvas layer it draws its columns as lanes with one
  stub per card that fits, with no per-frame cost.
- The Board lens caps columns at 150 cards until "Show more".

Bench numbers are in `PERFORMANCE.md`, from `node bench/run.mjs --only formmap`. The generator in `bench/vaults.mjs`
writes version 2 maps with a saved board.

## Limitations / next steps

- Kanban cards have no relations. Moving a canvas card into a kanban node removes its edges, and the chip says how many.
- Tags on cards are not part of the vault's tag index (`#tags` in card text are). Indexing them and kanban card text
  would need `mdparse.parseCanvasLinks`.
- Field boards over `multiselect`, `checklist` and `longtext` fields aren't offered.
- Tidy arranges a group's own cards and ignores nested groups' area.
