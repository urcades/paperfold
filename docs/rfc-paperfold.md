# RFC: paperfold — The Dynamics Layer

Status: pre-RFC (decisions recorded 2026-07-10; drafting precedes any implementation)
Depends on: paper-doll/v2.x symmetry-completion and paper-doll/v3 (the identity/addressing law — see `rfc-vessel-calculus.md`)
Relates to: `rfc-paperchain.md`, `rfc-papermold.md`, `core-ontology.md`, `design-gamecraft-consumer.md`

## Definition

paperdoll is a calculus of state: bodies are values, operations are pure functions from body to body, and the single judgment says whether a body is lawful. paperfold adds the dynamics layer: **change itself becomes a value.** A patch is a document that records a difference between two bodies (or two scenes) precisely enough to be applied, composed, inverted, and refused.

The core reframe: once changes are values, every verb becomes a noun you can store, send, inspect, invert, and refuse. A sword swing, a poison tick, an equip action — each is a patch. The consumer's vocabulary of *events* and the protocol's vocabulary of *differences* turn out to be the same thing, seen from opposite sides of the ontology boundary: the consumer knows the patch means "poison ticked"; the protocol knows only that it is a lawful difference.

paperfold's judgment is over pairs: **is this patch lawful *at* this body?** A patch is lawful at `b` iff applying it to `b` yields a kernel-valid body. Patch validity is defined *by reference to* kernel validity — paperfold adds no new notion of what a good body is.

## Why a sibling, not core

The kernel RFC already rejects diff/patch in core ("Pure operations make diffing trivial to build *on top*"). Recording the full argument, in three parts:

1. **The annealing test fails.** `Patch` is a new primitive, and it introduces a second judgment beside the kernel's single one — and a *two-place* judgment at that ("is this patch lawful at this body"), where the kernel's is one-place ("is this body lawful"). Every proposal in this family is tested against "does this subtract a concept or add a law?" — Patch adds a concept. A calculus with one judgment is a diamond; with two, a workbench. The workbench is worth having, but it is a different tool on a different bench.

2. **Dynamics is a theory *about* the kernel that needs nothing *from* it.** Because bodies are values and operations are pure, `diff`, `apply`, `compose`, and `invert` are definable entirely on top of the exported surface, and patch validity is definable by reference (apply, then run the seven laws). paperfold reads the kernel; the kernel never reads paperfold. That one-directional dependency is exactly the shape of a sibling.

3. **Different interchange, different clock.** Documents are state-at-rest: diamond-stable, safe on disk for years, versioned on the slow clock of the protocol string. Patches are change-in-flight: they live near netcode, sync engines, and CRDT churn, and their design pressure comes from technologies that turn over fast. Welding them into one format would couple the document format's versioning to sync-technology fashion. Keeping them siblings lets a `paper-doll/v3` document outlive several `paperfold/vN` patch dialects without a single migration.

## The patch vocabulary: reification, by rule

paperfold does not invent an edit language. Its patch vocabulary is defined as **the reification of the kernel's operation signatures**, by rule: one patch constructor per exported paperdoll operation —

`connect`, `disconnect`, `insertVessel`, `deleteVessel`, `insertElement`, `removeElement`, `moveElement`.

This rule is the whole schema-design policy, and it doubles as the drift mitigation: a change to the kernel's operation set is a breaking change for paperfold **by definition**. That is the correct coupling — explicit, versioned, and one-directional — rather than the accidental coupling that arises when two vocabularies describe the same edits and slowly diverge. paperfold can never grow a patch op the kernel cannot perform, and the kernel can never change an operation without the divergence being a named, versioned event.

## Laws

Three laws; a fourth is named and deliberately deferred.

1. **Soundness.** `apply(diff(a, b), a) = b`. Diff and apply are exact inverses over the pair that produced them.
2. **Composition.** Patches concatenate associatively: applying `p` then `q` equals applying `compose(p, q)`, and composition of compositions is order-of-grouping-independent.
3. **Partial invertibility.** Every patch entry carries enough information to construct its undo. Inversion is entry-wise reversal of the reversed sequence; a patch that applied cleanly can always be backed out.

**Commutation is deferred.** Whether two editors' independent patches can apply in either order with the same result is operational-transform/CRDT territory — the expensive frontier of this design space, and only multiplayer co-editing needs it. The deferral is also insurance against a known interaction recorded in the kernel RFC's capacity deferral: if capacity ever lands, admission starts depending on a vessel's *other contents*, and patches stop commuting exactly at full vessels. Committing to a commutation law now would either forbid capacity forever or be broken by it. Single-writer sequences (saves, replays, undo stacks, server-authoritative sync) need only laws 1–3.

## Kernel prerequisites

Both are recorded in the kernel RFC; paperfold implementation cannot start before both land. Drafting (this document, and the full RFC after it) can proceed now.

**(a) The symmetry-completion (paper-doll/v2.x, API-only).** Law 3 requires that every destructive operation return what it destroyed, so the undo half of each entry can be constructed at patch-creation time. Today the ledger is uneven: `removeElement` already returns the removed element; `deleteVessel` swallows the vessel and its severed connections; `disconnect` swallows the connection; `connect` silently clears up to two prior ports. Completing the symmetry is additive API work — no document changes, no protocol bump. (Shipped: paperdoll 0.7.0, 2026-07-10.)

**(b) paper-doll/v3 addressing.** Patches must name what they touched, and element addressing is unstable today: `contains` is an ordered array whose indices shift under splice, and `element.id` is optional and non-unique. Index-paths are invalidated by the very patches paperfold exists to record. Law 8 (element id uniqueness) plus the address grammar is the shared prerequisite — designed once, in the kernel, never per-sibling (paperchain decision 5 records the same dependency from the other side). (Shipped: paper-doll/v3, paperdoll 0.8.0, 2026-07-10.)

## The patch document

By value, strict unknown-key validation, like every document in the family:

```jsonc
{
  "protocol": "paperfold/v1",
  "patch": [
    // sever alice's lower arm — deleteVessel reified, with its undo
    {
      "op": "deleteVessel",
      "vessel": "alice/left-lower-arm",
      "undo": {
        "vessel": { "accepts": [{ "kind": "item", "type": "held" }],
                    "contains": [{ "kind": "item", "type": "held", "id": "rope" }],
                    "ports": { "top": { "vessel": "left-upper-arm", "side": "bottom" } } },
        "connections": [
          { "from": { "vessel": "left-upper-arm", "side": "bottom" },
            "to":   { "vessel": "left-lower-arm", "side": "top" } }
        ]
      }
    },
    // the rope drops as part of the severing — relation cleanup in the same transaction
    {
      "op": "removeRelation",
      "relation": { "kind": "holds", "from": "alice/left-lower-arm/rope", "to": "bob/right-hand" },
      "undo": { "relation": { "kind": "holds", "from": "alice/left-lower-arm/rope", "to": "bob/right-hand" } }
    }
  ]
}
```

(Scene-targeting entry shapes such as `removeRelation` belong to the scene-targeting phase and are sketched here only to show the transaction story; the bodies-only v1 vocabulary is exactly the seven reified kernel ops. Address forms shown are illustrative pending the v3 grammar.)

## Decisions

Six hard decisions, all resolved 2026-07-10:

### 1. Sibling protocol, not kernel extension

For the three arguments above (annealing, one-directional theory, different clocks). Rejected alternative: a `diff`/`apply` pair exported from paperdoll itself — rejected because it smuggles the second judgment into the diamond and welds the two version clocks together.

### 2. The vocabulary is the kernel's operation set, reified

One constructor per exported operation; kernel operation changes break paperfold by definition. Rejected alternative: an independent structural-diff language (JSON-Patch-style path/value edits) — rejected because it can express edits no kernel operation performs, so patch lawfulness would need its own theory instead of inheriting the kernel's, and the two vocabularies would drift.

### 3. Three laws now; commutation deferred

Soundness, composition, partial invertibility. Commutation waits for a multiplayer co-editing consumer, and for the capacity question to settle (capacity, if it lands, erodes commutation exactly at full vessels — cross-reference the kernel RFC's capacity deferral, point 4). Deferral is free: laws 1–3 are what saves, replays, undo, and server-authoritative sync consume.

### 4. Targets are bodies *and* paperchain scenes

paperchain decision 1 embeds bodies in scenes by value, which obligates paperfold to target scenes, not only bare bodies. paperchain decision 4 (dangling relations are strictly invalid) gives paperfold transactions a real job: relation cleanup travels in the same transaction as the structural change that orphaned it — the rope drops when the arm is severed, *as part of the severing*. Rejected alternative: bodies-only paperfold with consumers hand-editing relation tables — rejected because it reopens the invariant-bypassing hole (hand-edited `contains` arrays) that the kernel spent v1.x closing for containment.

### 5. Multi-entry patches are transactions

A patch applies atomically: all entries or none, validated as a unit against the result. The kernel-scale model already exists: `moveElement` checks the destination before removing, so it cannot strand an element. paperfold generalizes that discipline from one composite operation to arbitrary entry sequences. Rejected alternative: best-effort partial application — rejected because it makes the post-state unpredictable and breaks law 1 (the applied prefix of a failed patch is not the diff of anything).

### 6. Patches are subject-agnostic

A patch document does not know who alice is. Binding a patch (or a patch history) to a character, save file, or session is identity *assignment* — forever consumer-side, per the kernel RFC's identity split. paperfold consumes identity *reference* (the v3 address grammar) and nothing more. A patch document MAY carry an optional consumer label and/or an integrity precondition (e.g. a digest of the expected prior state); the shape of both is deliberately unsettled here — see Open questions.

## Compositions

The family compositions this layer makes available, each already demanded by a named document:

- **With papermold (profiles):** monitoring as diff-of-judgments. Run conformance over the patch stream and watch for transitions: a body ceasing to conform to `alive` is a death event; beginning to conform to `hostile-engaged` is an aggro trigger; a scene reaching `all-flags-captured` is a win condition. Profiles become the *goal language* and patches the *move language* — which is the whole grammar a planner needs: search over patch sequences for one whose endpoint conforms.
- **With gamecraft (`design-gamecraft-consumer.md`):** items as carriers of patches — an equippable's definition includes its on-equip patch and, by law 3, its inverse for unequip; wear events as patches that mutate `data` or reshape an embedded body (breakage); status effects as scheduled patch generators whose thresholds reify as structural change. The gamecraft note already promotes paperfold to next-protocol-work on this basis.

## What this unlocks

All as data with laws — storable, sendable, inspectable, refusable:

- **Event-sourced saves.** A save is a base document plus a patch log; the log is replayable, auditable, and survives migrations by replaying through them.
- **Time as a mechanic — undo, rewind, replays, ghosts.** All one law: editors get undo by inverting the last patch; Prince-of-Persia rewind is the same inversion at gameplay speed; a match replay or racing ghost is the patch stream re-applied to a copy.
- **Network sync with anti-cheat as a corollary.** Clients ship patches; the server validates each against the laws before applying. An unlawful patch is refused, not repaired — a cheat is just an invalid document. Rollback netcode is the same machinery run speculatively: apply the prediction, invert it when the authoritative patch disagrees.
- **Atomic trades and escrow.** Decision 5 makes a two-party exchange one transaction: both transfers or neither, composing with the paperdoll trading-desk pattern recorded in paperchain.
- **Animation from diffs.** The patch is the interface between simulation and renderer: the renderer interprets patches (a `deleteVessel` becomes a severing animation) and never touches game logic — preserving the core-ontology boundary at the dynamics layer.
- **Previews.** Compute the patch, validate it, render the hypothetical, then commit or discard — "what would equipping this look like" without mutating anything.
- **Fuzzing the protocol itself.** Property-based testing generates random patch sequences and asserts the laws: every lawful application preserves kernel validity, every composition equals its sequence, every inversion round-trips. The dynamics layer is the kernel's best adversary.

## Sequencing

1. paperdoll v2.x — destructive-operation symmetry-completion (API-only; prerequisite a).
2. paperdoll v3 — law 8 + address grammar (prerequisite b).
3. paperfold v1 — this document hardened into a full RFC: patch schema, the three laws, reified vocabulary over bodies, JSON Schema, reference implementation.
4. Scene targeting — lands alongside paperchain v1 (its decision 1 requires it; its decision 4 employs it).

The npm name `paperfold` is reserved (placeholder 0.0.1 published).

## Open questions

- **Subject binding shape.** Whether the optional consumer label and the integrity precondition (expected-prior-state digest? base-document hash? sequence number?) are one field or two, and what the precondition checks, is deferred to the full RFC.
- **Scene-targeting vocabulary.** Whether scene patches reify a paperchain operation set (which paperchain has not yet defined) by the same one-constructor-per-operation rule, or extend the body vocabulary with relation entries directly, waits on paperchain v1's exported surface.
- **Undo carriage.** Whether `undo` is mandatory on every entry (making all patches invertible documents) or derivable at apply-time and optional in interchange, is a size-versus-self-containment trade to settle with a real consumer.
