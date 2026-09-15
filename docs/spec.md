# paperfold/v1 — Specification

Status: v1, hardened 2026-07-10 (micro-decisions resolved the same day)
Depends on: paper-doll/v3 (paperdoll >= 0.8.1 — the symmetry-completion and the identity/addressing law)
Lineage: [`rfc-paperfold.md`](rfc-paperfold.md) (the pre-RFC; its six decisions are assumed here)

paperfold is the dynamics layer of the paper* family: change itself as a
value. A patch is a document that records a difference between two bodies
precisely enough to be applied, composed, inverted, and refused. This
specification is language-independent: the document format plus the laws
below are the protocol; the TypeScript library is one implementation.

## The patch document

```jsonc
{
  "protocol": "paperfold/v1",
  "patch": [ /* entries, applied in order, atomically */ ]
}
```

Strict unknown-key validation applies at every level, like every document in
the family: a key this specification does not name is an error, wherever it
appears. Ids, sides, endpoints, connections, vessels, and contained elements
are the kernel's (paper-doll/v3) types, validated structurally to the same
grammar (`^[a-z][a-z0-9-]*$` ids; sides `top | right | bottom | left`;
endpoints `{ vessel, side }`; connections `{ from, to }`). An element's
`body`, where present, must be a fully valid paper-doll/v3 body. An element's
`data` is opaque: paperfold copies and compares it, and never reads it.

## The entry vocabulary: reification, by rule

One entry shape per exported kernel operation — the pre-RFC's decision 2,
unchanged. paperfold can never express an edit the kernel cannot perform.
Each entry carries, inline and under the kernel's own names, the destruction
records that operation reports:

| entry | fields | destruction / precondition records |
|---|---|---|
| `connect` | `from`, `to` (endpoints) | `displaced`: the 0–2 connections the new one overwrote |
| `disconnect` | `endpoint` | `removed`: the severed connection. Must be non-null — a no-op disconnect is not a lawful entry |
| `insertVessel` | `vesselId`, `vessel` (portless), `at?` (endpoint) | `bridged`: the connection the insertion split, or `null` |
| `deleteVessel` | `vesselId`, `collapseOppositeNeighbors?` | `vessel`: the deleted vessel exactly as it was (accepts, contains, ports); `collapsed`: the neighbor connection the collapse created, or `null` |
| `insertElement` | `vesselId`, `element`, `index` | none destroyed; `index` is the insertion position |
| `removeElement` | `vesselId`, `index` | `element`: the removed element |
| `moveElement` | `from`, `index`, `to` | `element`: the moved element; `toIndex`: the index it lands at in `to` |

`insertVessel.vessel` never carries ports: connections are made by `connect`
entries (or by `at`, which reifies the kernel's bridging insert). All record
fields are mandatory in interchange; nullable records are written `null`,
never omitted (micro-decision 7).

## Laws

### Law 1 — Soundness

`apply(a, diff(a, b)) = b` (in canonical form — see below), for any pair of
valid bodies with equal roots for which `diff` succeeds. The diff need not be
minimal, only sound: this implementation replaces a vessel's whole `contains`
when any of it differs, and reifies `accepts` changes as vessel replacement.
Minimality is a quality-of-implementation concern, never a law.

### Law 2 — Composition

`compose(p, q)` is entry concatenation, and
`apply(a, compose(p, q)) = apply(apply(a, p), q)`. Concatenation is
associative, so composition of compositions is grouping-independent.

### Law 3 — Partial invertibility

For any patch `p` lawful at `a`: `apply(apply(a, p), invert(p)) = a`.

`invert` is **body-free**: it reads only the entries' destruction records —
no body, no lookup, no state. It reverses the entry sequence and inverts each
entry; one entry may invert to several:

| entry | inverse |
|---|---|
| `connect { from, to, displaced }` | `disconnect(from)` recording `from↔to` as removed, then for each displaced connection `d`: `connect(d.from, d.to)` recording `displaced: []` (the original connect freed every far endpoint, so the restorations displace nothing) |
| `disconnect { endpoint, removed }` | `connect(removed.from, removed.to)` recording `displaced: []` |
| `insertVessel` without `at` | `deleteVessel(vesselId)` recording the portless `vessel` and `collapsed: null` |
| `insertVessel` with `at` | `deleteVessel(vesselId)`, with the record's ports reconstructed from the entry alone: `opposite(at.side) → at`, plus — when `bridged` is non-null — `at.side → prior`, where `prior` is the endpoint of `bridged` that is not `at`. When `bridged` is non-null the inverse sets `collapseOppositeNeighbors: true` and records `collapsed = at↔prior`, so deleting the vessel re-fuses the bridged connection |
| `deleteVessel { vesselId, vessel, collapsed }` | first, if `collapsed` is non-null, `disconnect(collapsed.from)` recording `collapsed` as removed; then `insertVessel(vesselId, vessel sans ports)` recording `bridged: null`; then for each side `s` in `vessel.ports`: `connect({vesselId, s}, vessel.ports[s])` recording `displaced: []` |
| `insertElement { vesselId, element, index }` | `removeElement(vesselId, index)` recording `element` |
| `removeElement { vesselId, index, element }` | `insertElement(vesselId, element, index)` |
| `moveElement { from, index, to, element, toIndex }` | `removeElement(to, toIndex)` recording `element`, then `insertElement(from, element, index)` — a bare moveElement back would append and lose the original position |

"Partial" means what the pre-RFC meant: a patch that applied cleanly can
always be backed out; nothing is promised about applying `invert(p)` to
bodies other than `apply(p, a)` — the staleness law refuses those.

### Law 4 — Staleness (the integrity precondition)

At apply time, every destruction record is checked against what the kernel
operation actually reports:

- `connect`: the actual displaced set must equal the recorded `displaced`;
- `disconnect`: the actual removed connection must be non-null and equal
  `removed`;
- `insertVessel`: the actual bridged connection must equal `bridged`
  (both-null counts as equal);
- `deleteVessel`: the actual deleted vessel must equal the recorded `vessel`,
  and the actual collapse must equal `collapsed`;
- `removeElement`: the actual removed element must equal the recorded
  `element`;
- `moveElement`: the element at `from[index]` must equal the recorded
  `element`, and the landing position must equal `toIndex`.

Any mismatch is an error (`stale patch: ...`, path-annotated to the entry
field), and the whole application fails. The records thus serve twice: they
are the material for inversion, and they are preconditions that detect a
patch recorded against a different state. Vessel and element comparisons are
canonical deep equality (below); connection comparisons are
orientation-insensitive (`a↔b` equals `b↔a` — micro-decision 5).

### Commutation is absent

Deliberately, per pre-RFC decision 3: whether two independently produced
patches apply in either order with the same result is
operational-transform/CRDT territory, deferred until a multiplayer co-editing
consumer exists and the kernel's capacity question settles. paperfold/v1
promises nothing about reordering entries or patches.

## Application semantics

`apply(body, patch)`:

1. Validate the patch document structurally; any error refuses the patch.
2. Apply entries in order, each through the corresponding kernel operation.
   The kernel enforces local laws (existing endpoints, opposition,
   compatibility, id availability, index range) by throwing; a thrown
   violation becomes a path-annotated error at `$.patch.N`. Each entry's
   destruction records are checked per law 4.
3. After the last entry, validate the resulting body against all eight
   kernel laws (global validation). Multi-entry patches legitimately pass
   through globally incomplete intermediate states — the kernel's
   local/global split, generalized from one composite operation to arbitrary
   entry sequences (pre-RFC decision 5).
4. On success, return the resulting body in canonical form. On any failure,
   return the errors and no body: application is atomic by purity — inputs
   are never mutated, so a failed patch leaves nothing behind.

## Canonical form

The kernel's operations can leave semantically empty residue: clearing a
vessel's last port leaves `ports: {}`; removing its last element leaves
`contains: []`. Both are protocol-equivalent to the key being absent. A body
is **canonical** when no vessel (recursively, through embedded bodies)
carries an empty `ports` or `contains`. `accepts` is exempt: `accepts: []`
(sealed) and absent `accepts` (open) mean different things and are never
conflated. The laws above are stated over canonical form: `apply` returns
canonical bodies, and all staleness comparisons are canonical
(micro-decision 4).

## Diff

`diff(a, b)` requires `a.root === b.root` and produces a sound patch by
tracking the intermediate body, so every entry's destruction records are
computed from the state that entry will actually apply against:

1. delete vessels absent from `b`, and vessels whose `accepts` changed;
2. disconnect every remaining connection not present in `b`;
3. wholesale-replace the `contains` of kept vessels that differ (remove all,
   then insert `b`'s elements in order, with positions);
4. insert vessels new in `b` (including replacements), portless, with their
   `accepts` and `contains`;
5. connect each connection of `b` not yet present — each connection once,
   canonically ordered.

`diff` assumes both inputs are kernel-valid bodies (law 1's premise). Handing
it a body the kernel itself would reject — e.g. a sealed vessel containing an
element its `accepts` does not admit — propagates the kernel's thrown error
rather than returning `ProtocolError`s.

## Resolved micro-decisions (2026-07-10)

1. **Destruction records are inlined under the kernel's names, not nested
   under an `undo` key.** The pre-RFC sketched `"undo": { ... }`. Inlining
   `displaced` / `removed` / `vessel` / `collapsed` / `bridged` / `element`
   keeps each entry the exact reification of its operation's signature —
   arguments and reports alike — and lets the same fields serve as law-4
   preconditions without duplication. A nested undo object would restate the
   same data one level down and invite drift between the two copies.
2. **The destruction records are the integrity precondition.** The pre-RFC
   left open whether patches carry a digest, base-document hash, or sequence
   number. Resolved: none of those — the records themselves are checked
   against what the kernel reports at apply time, which detects exactly the
   divergence that matters (the state the patch assumed) with no new
   mechanism, no canonical-serialization question, and no hash function in a
   library with no dependencies beyond the kernel. Patches remain subject-agnostic (pre-RFC
   decision 6): nothing in a patch names whose body it is; consumer labels
   stay consumer-side.
3. **`moveElement` entries carry `element` and `toIndex`.** The operation
   destroys nothing, but law 3's body-free inversion needs the moved
   element's identity and its landing position, and law 4 wants both as
   preconditions. This is the entry-shape rule applied honestly: every entry
   carries the records needed for inversion and staleness detection, even
   when the kernel operation returns only the body.
4. **Canonical form.** Empty `ports` / `contains` are equivalent to absent;
   `apply` returns canonical bodies; comparisons are canonical. `accepts` is
   never normalized (sealed ≠ open).
5. **Connection equality is orientation-insensitive.** The kernel reports
   connections oriented by which endpoint it cleared; `a↔b` and `b↔a` name
   the same edge, so law-4 comparisons and diff's connection accounting use
   the canonical (sorted-endpoint) form.
6. **Undo carriage is mandatory** (resolving the pre-RFC's open question):
   every entry carries its records in interchange, so every patch document is
   an invertible document. The size cost is small; the self-containment is
   the point — an undo stack is just the patch log, inverted.
7. **Nullable records are explicit.** `bridged` and `collapsed` are required
   keys written `null` when nothing was destroyed, so an absent record is a
   validation error, never a silent "nothing".

## Limitations, recorded

- **Root equality.** `diff` refuses bodies with different roots: no kernel
  operation changes a body's root, so no reified patch can either. A
  consequence of reification, accepted.
- **Root `accepts`.** `accepts` changes reify as vessel replacement
  (delete + insert), and the root cannot be deleted, so `diff` refuses a
  root-`accepts` change. Same consequence.
- **Shallow diff.** `diff` compares elements as values: any difference —
  including deep inside an embedded `body` or opaque `data` — reifies as
  wholesale element replacement, not as a patch into the embedded body. A
  documented v1 limitation; a recursive diff would still be expressible in
  this vocabulary and may arrive without a protocol bump.
- **Diffs are not minimal.** Soundness is the only law; consumers must not
  read meaning into the particular entry sequence `diff` chooses.

## What paperfold/v1 does not do

- **No commutation** (law-level; see above).
- **No scene targeting.** v1 patches target bodies only. Scene targeting —
  relation entries traveling in the same transaction as the structural change
  that orphaned them (the rope drops *as part of* the severing) — is
  paperfold/v2, specified below.
- **No identity assignment.** A patch does not know whose body it edits;
  binding patches to characters, saves, or sessions is forever consumer-side
  (pre-RFC decision 6).
- **No new judgment about bodies.** Patch lawfulness is defined by reference
  to kernel validity: a patch is lawful at `b` iff it applies and the result
  satisfies the kernel's eight laws. paperfold adds no opinion about what a
  good body is.
- **No interpretation.** paperfold never reads `element.data`, never renders,
  never decides what a severing *means*. It records that a lawful difference
  occurred, and can take it back.

---

# paperfold/v2 — Scene patches

Status: v2, hardened 2026-07-10 (same day as v1; shipped in paperfold 0.2.0)
Depends on: paperchain/v1 (paperchain >= the exported operation surface below)
and everything v1 depends on. v1 is unchanged and remains valid interchange;
v2 is a second document dialect in the same library.

paperfold/v2 does to paperchain what v1 did to the kernel: it reifies the
scene layer's operation set as patch entries, so that change to a *scene* —
bodies, kinds, and relations together — is a value with the same four laws.
The v1 discipline is widened, not changed.

## The scene patch document

```jsonc
{
  "protocol": "paperfold/v2",
  "patch": [ /* entries, applied in order, atomically */ ]
}
```

Strict unknown-key validation applies at every level, as everywhere in the
family. An entry is one of exactly two families:

1. **A kernel entry aimed at a scene body.** Any of the seven v1 entry shapes,
   unchanged, plus a required `body` (the scene body's name — a lowercase
   slug) and an optional `path` (below). The entry applies inside that body
   through the v1 machinery.
2. **A scene entry: the reification of exactly one paperchain operation.**
   One entry shape per exported paperchain operation — the same rule, the
   same coupling: paperfold can never express a scene edit paperchain cannot
   perform, and a change to paperchain's operation set is a breaking change
   for paperfold **by definition**, exactly as with the kernel.

| entry | fields | destruction / precondition records |
|---|---|---|
| `declareKind` | `kindId`, `declaration` | none destroyed; the declaration doubles as the material for inversion |
| `deleteKind` | `kindId` | `declaration`: the deleted declaration exactly as it was |
| `insertBody` | `name` | `body`: the full body, valid paper-doll/v3 |
| `deleteBody` | `name` | `body`: the deleted body exactly as it was (compared canonically) |
| `addRelation` | `relation` | none destroyed; the relation doubles as its own record |
| `removeRelation` | — | `relation`: the removed relation, in **stored** orientation (below) |

Kind ids and body names are lowercase slugs; kind declarations are
paperchain's (`symmetric`, `irreflexive`, `fromMax`, `toMax`, with symmetric
kinds forbidden `toMax`); relations are paperchain's
`{ kind, from, to }` with scene-address endpoints (`bodyName/…`, at least two
segments — a bare body name is not an endpoint). paperfold restates none of
paperchain's rules; it validates these fields to the same grammar and defers
the laws to paperchain at apply time.

## Destruction records over scenes

`deleteKind`, `deleteBody`, and `removeRelation` carry what the paperchain
operation reports, and the records serve twice, as in v1: material for
body-free inversion, and law-4 staleness preconditions checked against what
the operation actually reports at apply time. Body records are compared in
canonical form; declarations by deep equality.

**The stored-orientation rule.** paperchain stores a symmetric relation in
whichever endpoint order it was added, and `removeRelation` reports the
stored form. A `removeRelation` entry's record must match that stored
orientation exactly — a record whose endpoints are swapped relative to
storage names the same symmetric relation but is a **stale** record: it was
taken from a different state (or never taken at all). This keeps the record a
genuine report, not a description; inversion then re-adds the relation
exactly as it was stored. (An `addRelation` entry's relation is trivially in
stored orientation — paperchain stores it as written — so its inverse
`removeRelation` needs no adjustment.)

## Nested-body paths

A kernel entry's optional `path` addresses an embedded body inside the named
scene body, using the kernel's own address grammar: a `/`-separated chain of
lowercase ids in alternating vessel / element-id pairs — so an **even**
number of segments — where each element carries a `body`, descending through
`element.body` at every pair, and ending *at* an embedded body. The entry
applies inside that innermost body, and **all of the entry's fields and
records are stated relative to the inner body** — vessel ids, indices, and
destruction records alike. Inversion stamps the same `body` and `path` onto
every inverse entry.

Resolution failure is staleness: a path whose prefix no longer resolves — a
missing vessel, a missing element, or an element that carries no body — was
recorded against a different structure, and refuses the patch with a
`stale patch: …` error naming the deepest failing prefix.

## Laws

The four laws of v1, restated over scenes; nothing is added and nothing
weakened.

1. **Soundness.** `applyScenePatch(a, diffScenes(a, b)) = b` in canonical
   stored-state form, for any pair of valid scenes for which the diff succeeds.
   This equality includes each relation's stored endpoint orientation, even
   when its kind is symmetric. Sound, not minimal, as always.
2. **Composition.** `composeScenePatches` is entry concatenation, and
   applying the composition equals applying in sequence whenever both sides
   are defined. Concatenation is associative.
3. **Partial invertibility.** `invertScenePatch` is body-free — computed from
   the entries alone. It reverses the sequence and inverts each entry:
   `declareKind` ↔ `deleteKind`, `insertBody` ↔ `deleteBody`,
   `addRelation` ↔ `removeRelation` (records swap roles as in v1), and kernel
   entries invert through the v1 table with `body`/`path` re-stamped. For a
   patch lawful at a scene, applying that patch and then its inverse restores
   the canonical starting scene. Sequence reversal alone settles the
   dependency order between kinds, bodies, and relations — no topological
   reasoning is needed.
4. **Staleness.** Every destruction record — the scene entries' above, and
   the kernel records inside targeted bodies — is checked against what the
   operation actually reports; any mismatch, a missing scene body, or an
   unresolvable path refuses the whole patch. Refused, not repaired.

Commutation remains absent, for v1's reasons.

## Application semantics

`applyScenePatch(scene, patch)`:

1. Validate the patch document structurally; any error refuses the patch.
2. Apply entries in order. Scene entries go through paperchain's exported
   operations, which enforce paperchain's **local** laws (kind existence and
   uniqueness, endpoint existence, irreflexivity, multiplicity, no
   duplicates, deleteKind refusing while relations use the kind, deleteBody
   refusing while relations touch the body) by throwing; a thrown violation
   becomes a path-annotated error at `$.patch.N`. Kernel entries resolve
   their `body` and optional `path`, apply through the v1 entry machinery
   against the inner body, and re-embed the result — siblings of the path
   untouched. Each entry's records are checked per law 4.
3. After the last entry, validate the resulting scene globally with
   paperchain's `validateScene` — all seven scene laws, including body
   validity of every body. Multi-entry patches legitimately pass through
   globally incomplete intermediate states, the local/global split
   generalized once more.
4. On success, return the scene in canonical form. On any failure, return
   the errors and no scene: atomic by purity.

**Strict dangling is enforced twice.** paperchain's law 4 (no dangling
relation endpoints) is enforced locally by `deleteBody` — paperchain refuses
to delete a body while relations touch it — and globally by the final
`validateScene`, which catches endpoints orphaned by kernel entries *inside*
a body (a removed element, a deleted vessel). A patch whose body edits orphan
a relation endpoint must therefore carry the `removeRelation` in the same
transaction: **the rope drops as part of the severing.** This is the
transaction story the pre-RFC promised (decision 4), now a law-level
consequence rather than a convention — and `diffScenes` always emits such
cleanup, so diffed patches never need hand-repair.

## Canonical form over scenes

A scene is canonical when every body (at the scene level and recursively
through embeddings) is canonical in the v1 sense, and the relation table is
sorted by `(kind, from, to)`. paperchain's relations are a flat table whose
order carries no meaning, so sorting prevents a remove/re-add cycle from
changing table order. Sorting is the only normalization relations need. It
does not swap a symmetric relation's endpoints: stored orientation remains
part of canonical scene equality because `removeRelation` reports and checks
that exact stored record. Symmetric equivalence governs relation operations,
not stored-state equality. Kinds have no non-canonical spellings, and scene
addresses are already canonical strings. `applyScenePatch` returns canonical
scenes, and all staleness comparisons of bodies are canonical.

## Diff

`diffScenes(a, b)` produces a sound patch by tracking a live intermediate
scene, so each entry's records are computed from the state that entry will
actually apply against, and each phase's local-law preconditions hold. Seven
phases, in order:

1. **remove relations** whose exact stored `(kind, from, to)` tuple is absent
   from `b` — including every relation of a kind whose declaration changed;
2. **delete bodies** absent from `b` (their relations went in 1, so
   `deleteBody`'s local law holds);
3. **delete kinds** absent from `b` or re-declared;
4. **declare kinds** new in `b` or re-declared;
5. **insert bodies** new in `b`;
6. per kept body that differs, the **v1 body diff**, its entries stamped with
   the body name;
7. **add exact stored relation tuples** of `b` not yet present.

Consequently, reversing the stored endpoints of a symmetric relation emits a
`removeRelation` with the old stored record followed by `addRelation` with the
new orientation. The two relations have the same symmetric meaning, but the
cycle is required for soundness against canonical stored-state equality and
for later destruction-record checks. Reversing an asymmetric relation remains
a change in both meaning and storage.

**The kind-re-declaration cycling rule.** A changed kind declaration reifies
as `deleteKind` + `declareKind` — there is no update operation to reify, as
ever. `deleteKind` refuses while relations use the kind, so every relation of
a re-declared kind is removed in phase 1 and re-added in phase 7, *even when
the relation itself is textually unchanged*. The relation cycles around the
re-declaration; soundness holds and order in the relation table carries no
meaning, so nothing is lost — but consumers must not read the cycle as
relation churn (law 1's minimality caveat, again).

Within each phase, entries are emitted in a deterministic sorted order
(relations by `(kind, from, to)`; bodies and kinds by name) — a
quality-of-implementation property, not a law.

## Limitations, recorded

- **Diff stays shallow.** Phase 6 is the v1 body diff, which compares
  elements as values: a difference deep inside an embedded body reifies as
  whole-element replacement, never as a `path`-targeted patch into the
  embedding. `path` exists for hand-authored (and inverted) patches;
  `diffScenes` does not yet emit it. As in v1, a recursive diff would be
  expressible in this same vocabulary and may arrive without a protocol
  bump.
- v1's other limitations (no commutation, no minimality, root equality and
  root-`accepts` within each body diff) carry over unchanged.
