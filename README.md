# paperfold

`paperfold` is a small TypeScript protocol library for patches over [paperdoll](https://github.com/urcades/paperdoll) bodies: change itself as a value. A patch is a document that records a difference between two bodies precisely enough to be applied, composed, inverted, and refused — diff, apply, compose, invert, with laws.

It is the dynamics layer of the paper* family. It has no runtime dependencies beyond the kernel, and it adds no new opinion about what a good body is: a patch is lawful at a body iff applying it yields a kernel-valid body.

## Install

```sh
npm install paperfold
```

## Minimal Document

```ts
import { PAPERFOLD_PROTOCOL, applyPatch, diffBodies, invertPatch } from "paperfold";
import type { Body, PaperfoldDocument } from "paperfold";

const before: Body = {
  root: "torso",
  vessels: {
    torso: { ports: { left: { vessel: "arm", side: "right" } } },
    arm: {
      contains: [{ kind: "item", type: "held", id: "rope" }],
      ports: { right: { vessel: "torso", side: "left" } }
    }
  }
};

// sever the arm — the rope goes with it
const severing: PaperfoldDocument = {
  protocol: PAPERFOLD_PROTOCOL,
  patch: [
    {
      op: "deleteVessel",
      vesselId: "arm",
      vessel: {
        contains: [{ kind: "item", type: "held", id: "rope" }],
        ports: { right: { vessel: "torso", side: "left" } }
      },
      collapsed: null
    }
  ]
};

const severed = applyPatch(before, severing);
if (!severed.ok) throw new Error(severed.errors[0].message);
console.log(severed.value.vessels.arm); // undefined

// law 3: the inverse is computed from the patch alone, and restores the arm
const restored = applyPatch(severed.value, invertPatch(severing));
if (!restored.ok) throw new Error(restored.errors[0].message);
console.log(restored.value.vessels.arm.contains); // [{ kind: "item", type: "held", id: "rope" }]

// law 1: diff produces the same kind of document
const patch = diffBodies(before, severed.value);
if (!patch.ok) throw new Error(patch.errors[0].message);
console.log(patch.value.patch[0].op); // "deleteVessel"
```

## The Model

The patch vocabulary is not an edit language of its own — it is the **reification of the kernel's operation set**, one entry shape per exported paperdoll operation:

`connect`, `disconnect`, `insertVessel`, `deleteVessel`, `insertElement`, `removeElement`, `moveElement`.

paperfold can never express an edit the kernel cannot perform, and a change to the kernel's operations breaks paperfold by definition — explicit, versioned coupling rather than slow drift.

Every entry carries, inline and under the kernel's own names, the destruction records the operation reports: `connect` records what it `displaced`, `disconnect` the connection it `removed`, `deleteVessel` the `vessel` it swallowed and any `collapsed` neighbor connection, `insertVessel` any `bridged` connection it split, `removeElement` and `moveElement` the `element` they touched. The records serve twice — they are the material for inversion, and they are integrity preconditions.

A multi-entry patch is a **transaction**: all entries or none, validated as a unit against the result.

## Laws

1. **Soundness** — `applyPatch(a, diffBodies(a, b))` yields exactly `b` (in canonical form). Diffs are sound, not minimal.
2. **Composition** — `composePatches(p, q)` is entry concatenation, and applying it equals applying `p` then `q`.
3. **Partial invertibility** — `invertPatch(p)` is computed from the entries' destruction records alone, body-free, and backs out any patch that applied: `applyPatch(applyPatch(a, p), invertPatch(p))` yields `a`.
4. **Staleness** — a destruction record that does not match what the kernel operation actually reports at apply time makes the whole patch an error (`stale patch: ...`, path-annotated). A patch recorded against a different state is refused, not repaired.

**Commutation is deliberately absent** — whether independent patches apply in either order is operational-transform territory, deferred per the pre-RFC until a multiplayer consumer needs it.

## Operations

All operations are pure; inputs are never mutated.

- `applyPatch(body, patch)` — applies entries sequentially through the kernel's own operations, checks every destruction record (law 4), then validates the final body against all eight kernel laws. Returns `Result<Body, ProtocolError[]>`: the new body in canonical form, or all errors and no body. Atomic by purity.
- `invertPatch(patch)` — returns the inverse patch document, body-free (law 3). One entry may invert to several: a `deleteVessel` inverts to an `insertVessel` plus one `connect` per severed port.
- `composePatches(p, q)` — returns the concatenated patch document (law 2).
- `diffBodies(a, b)` — returns a patch document such that applying it to `a` yields `b`, or precise errors (`Result`). Its partial domain requires valid bodies, equal roots, and unchanged root `accepts`. For kept vessels it preserves the longest canonically equal `contains` prefix and suffix and replaces only the changed middle.
- `parsePatch` / `validatePatch` / `assertPatch` — strict structural validation with path-annotated errors (`$.patch.2.from.side: ...`); unknown keys anywhere are rejected; `parsePatch` returns a deep copy.
- `canonicalizeBody(body)` — the canonical form the laws are stated over: empty `ports`/`contains` (kernel residue) dropped, recursively; `accepts` untouched (sealed ≠ open).

## The Family

- [paperdoll](https://github.com/urcades/paperdoll) — the kernel: bodies, vessels, containment, the eight laws. paperfold reads it; it never reads paperfold.
- [paperchain](https://github.com/urcades/paperchain) — the relations layer: scenes of bodies and the relations between them.
- [paperfold](https://github.com/urcades/paperfold) — the dynamics layer: this library.
- [papermold](https://github.com/urcades/papermold) — the judgment layer: profiles and conformance over bodies and scenes.

Scene targeting is paperfold/v2 — see below.

## Portability

The protocol is the document format plus the laws in the current normative [`paperfold/v1 and paperfold/v2 specification`](docs/spec.md). [`schema/paperfold-v1.schema.json`](schema/paperfold-v1.schema.json) and [`schema/paperfold-v2.schema.json`](schema/paperfold-v2.schema.json) are structural JSON Schema (2020-12) companions, not complete specifications. Package versions and dependency floors are listed in the [`paper* family compatibility matrix`](https://github.com/urcades/paperdoll/blob/main/docs/family-compatibility.md). Any language can validate and apply paperfold documents against conforming paperdoll and paperchain implementations.

The optional [`paper-json-portable/v1` profile](docs/spec.md#portable-json) limits integral binary64 values, including indices, budgets, and opaque nested data, to `±9007199254740991`. `validatePortableJson` checks that independent second verdict; larger exact integers should use canonical decimal strings under an application field contract.

## API

- constants: `PAPERFOLD_PROTOCOL`, `PAPERFOLD_SCENE_PROTOCOL`, `MAX_PORTABLE_INTEGER` (re-exported from paperdoll)
- validation: `parsePatch`, `assertPatch`, `validatePatch`, `parseScenePatch`, `assertScenePatch`, `validateScenePatch`, `validatePortableJson`, `formatProtocolErrors` (portable helpers re-exported from paperdoll)
- dynamics: `applyPatch`, `invertPatch`, `composePatches`, `diffBodies`
- canonical form: `canonicalizeBody`
- types: `PaperfoldDocument`, `PatchEntry` and the seven entry types, `VesselShape`, plus re-exported kernel types (`Body`, `Connection`, `ContainedElement`, `Endpoint`, `ProtocolError`, `Result`, `Side`, `Vessel`, `VesselId`)

Validation is strict: unknown keys anywhere in a patch document are rejected. `ContainedElement.data` is opaque to paperfold — it is copied and compared, never read.

## Design Notes

See [`docs/spec.md`](docs/spec.md) for normative behavior. [`docs/rfc-paperfold.md`](docs/rfc-paperfold.md) is the historical pre-RFC lineage.

## Scene Patches (paperfold/v2)

`paperfold/v2` does to [paperchain](https://github.com/urcades/paperchain) what v1 does to the kernel: it reifies the scene layer's operation set, so change to a whole scene — bodies, kinds, and relations together — is a value with the same four laws. An entry is either one of the seven kernel entries aimed at a named scene body (a `body` field, plus an optional nested-body `path`), or the reification of exactly one paperchain operation: `declareKind`, `deleteKind`, `insertBody`, `deleteBody`, `addRelation`, `removeRelation`. paperfold can never express a scene edit paperchain cannot perform.

```ts
import { PAPERFOLD_SCENE_PROTOCOL, applyScenePatch } from "paperfold";
import type { ScenePatchDocument } from "paperfold";

// declare a kind and relate two bodies
const binding: ScenePatchDocument = {
  protocol: PAPERFOLD_SCENE_PROTOCOL,
  patch: [
    { op: "declareKind", kindId: "holds", declaration: { fromMax: 1 } },
    { op: "addRelation", relation: { kind: "holds", from: "alice/left-hand", to: "bob/right-hand/rope" } }
  ]
};
const bound = applyScenePatch(scene, binding);
```

The marquee is the transaction story: paperchain forbids dangling relation endpoints (strictly, twice — locally in `deleteBody`, globally in the final scene validation), so a structural edit that orphans a relation must carry the relation cleanup **in the same patch**. The rope drops as part of the severing:

```ts
// sever the rope from alice's hand — the holds relation goes in the same transaction
const severing: ScenePatchDocument = {
  protocol: PAPERFOLD_SCENE_PROTOCOL,
  patch: [
    { op: "removeRelation", relation: { kind: "holds", from: "alice/left-hand", to: "bob/right-hand/rope" } },
    {
      op: "removeElement",
      body: "bob",
      vesselId: "right-hand",
      index: 0,
      element: { kind: "item", type: "held", id: "rope" }
    }
  ]
};
```

Without the `removeRelation`, the patch is refused — and `diffScenes` always emits such cleanup itself.

Kernel entries can also reach *inside* an embedded body with `path`: an alternating vessel/element-id chain (even segment count) ending at an element that carries a body, with the entry's fields stated relative to that inner body:

```ts
{
  op: "insertElement",
  body: "alice",
  path: "back/field-pack",       // the pack embedded in alice's back
  vesselId: "side-pocket",       // a vessel of the pack's body
  element: { kind: "item", type: "tool", id: "whetstone" },
  index: 1
}
```

A path whose prefix no longer resolves is a stale patch, refused like any other staleness. (`diffScenes` itself stays shallow: nested differences reify as whole-element replacement; `path` is for hand-authored patches and their inverses.)

v2 exports, mirroring the v1 surface one-for-one:

- constants: `PAPERFOLD_SCENE_PROTOCOL`
- validation: `parseScenePatch`, `assertScenePatch`, `validateScenePatch`
- dynamics: `applyScenePatch`, `invertScenePatch`, `composeScenePatches`, `diffScenes`
- canonical form: `canonicalizeScene` (canonical bodies plus the relation table sorted by `(kind, from, to)` — relation order carries no meaning)
- types: `ScenePatchDocument`, `ScenePatchEntry`, `SceneKernelEntry`, `SceneEntry` and the six scene entry types, plus re-exported paperchain types (`Scene`, `Relation`, `KindDeclaration`, `KindId`, `BodyName`, `SceneAddress`)

The v2 document format is captured structurally in [`schema/paperfold-v2.schema.json`](schema/paperfold-v2.schema.json); the hardened specification lives in [`docs/spec.md`](docs/spec.md) alongside v1.
