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
  the next phase, now unblocked by paperchain v1, per paperchain decisions 1
  and 4.
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
