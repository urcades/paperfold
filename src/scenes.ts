import {
  addRelation,
  declareKind,
  deleteBody,
  deleteKind,
  insertBody,
  parseSceneAddress,
  removeRelation,
  validateScene
} from "paperchain";
import type { BodyName, KindDeclaration, KindId, Relation, Scene } from "paperchain";
import { formatProtocolErrors, isId, PAPER_DOLL_PROTOCOL, parseAddress, validateDocument } from "paperdoll";
import type { Body, ContainedElement, ProtocolError, Result, VesselId } from "paperdoll";
import {
  applyEntry,
  canonicalizeBody,
  diffBodies,
  invertEntry,
  jsonEqual,
  validateEntry,
  type PatchEntry
} from "./paperfold.js";

// paperfold/v2 — patches over paperchain scenes.
//
// The v1 discipline widened, not changed: a scene patch entry is either a
// kernel entry addressed to a named body (optionally through an embedded-body
// path), or the reification of exactly one paperchain operation. paperfold
// can never express a scene edit paperchain cannot perform. Destruction
// records ride inline under paperchain's own names and serve twice — as the
// material for body-free inversion and as staleness preconditions.
//
// Strict dangling (paperchain law 4) is enforced twice: locally by
// deleteBody (paperchain refuses while relations touch the body), and
// globally by the final validateScene. A patch whose body entries orphan a
// relation endpoint must carry the removeRelation in the same transaction —
// the rope drops as part of the severing. diffScenes always emits such
// cleanup.

export const PAPERFOLD_SCENE_PROTOCOL = "paperfold/v2" as const;

/**
 * A v1 kernel entry aimed at one of the scene's bodies. `path`, when present,
 * is a paperdoll address of an embedded-body chain — alternating
 * vessel/element-id segments (even count), ending at an element that carries
 * a `body` — and the operation applies inside that innermost body. Records
 * are stated relative to the inner body.
 */
export type SceneKernelEntry = PatchEntry & {
  body: BodyName;
  path?: string;
};

export type DeclareKindEntry = {
  op: "declareKind";
  kindId: KindId;
  declaration: KindDeclaration;
};

export type DeleteKindEntry = {
  op: "deleteKind";
  kindId: KindId;
  declaration: KindDeclaration; // destruction record
};

export type InsertBodyEntry = {
  op: "insertBody";
  name: BodyName;
  body: Body;
};

export type DeleteBodyEntry = {
  op: "deleteBody";
  name: BodyName;
  body: Body; // destruction record
};

export type AddRelationEntry = {
  op: "addRelation";
  relation: Relation;
};

/**
 * The relation doubles as its own destruction record, and must be in the
 * STORED orientation: paperchain stores symmetric relations in whichever
 * endpoint order they were added, and removeRelation reports the stored
 * form. A record whose endpoints are swapped relative to storage is stale.
 */
export type RemoveRelationEntry = {
  op: "removeRelation";
  relation: Relation;
};

export type SceneEntry =
  | DeclareKindEntry
  | DeleteKindEntry
  | InsertBodyEntry
  | DeleteBodyEntry
  | AddRelationEntry
  | RemoveRelationEntry;

export type ScenePatchEntry = SceneKernelEntry | SceneEntry;

export type ScenePatchDocument = {
  protocol: typeof PAPERFOLD_SCENE_PROTOCOL;
  patch: ScenePatchEntry[];
};

const SCENE_OPS = ["declareKind", "deleteKind", "insertBody", "deleteBody", "addRelation", "removeRelation"] as const;
type SceneOpName = (typeof SCENE_OPS)[number];

const KERNEL_OPS = new Set([
  "connect",
  "disconnect",
  "insertVessel",
  "deleteVessel",
  "insertElement",
  "removeElement",
  "moveElement"
]);

function isSceneOp(op: unknown): op is SceneOpName {
  return typeof op === "string" && (SCENE_OPS as readonly string[]).includes(op);
}

// Parsing and validation

export function parseScenePatch(input: unknown): Result<ScenePatchDocument, ProtocolError[]> {
  const errors = validateScenePatch(input);
  if (errors.length > 0) return { ok: false, errors };
  const document = input as ScenePatchDocument;
  return {
    ok: true,
    value: {
      protocol: PAPERFOLD_SCENE_PROTOCOL,
      patch: document.patch.map((entry) => structuredClone(entry))
    }
  };
}

export function assertScenePatch(input: unknown): asserts input is ScenePatchDocument {
  const result = parseScenePatch(input);
  if (!result.ok) {
    throw new Error(formatProtocolErrors(result.errors));
  }
}

export function validateScenePatch(input: unknown): ProtocolError[] {
  const errors: ProtocolError[] = [];

  if (!isRecord(input)) {
    return [{ path: "$", message: "Scene patch document must be an object." }];
  }

  if (input.protocol !== PAPERFOLD_SCENE_PROTOCOL) {
    errors.push({ path: "$.protocol", message: `Expected "${PAPERFOLD_SCENE_PROTOCOL}".` });
  }

  for (const key of Object.keys(input)) {
    if (key !== "protocol" && key !== "patch") {
      errors.push({ path: `$.${key}`, message: `Unknown key "${key}".` });
    }
  }

  if (!Array.isArray(input.patch)) {
    errors.push({ path: "$.patch", message: "Patch must be an array of scene patch entries." });
    return errors;
  }

  input.patch.forEach((entry, index) => validateScenePatchEntry(entry, `$.patch.${index}`, errors));

  return errors;
}

function validateScenePatchEntry(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Scene patch entry must be an object." });
    return;
  }

  if (isSceneOp(input.op)) {
    validateSceneEntry(input, path, errors);
    return;
  }

  if (!KERNEL_OPS.has(input.op as string)) {
    errors.push({
      path: `${path}.op`,
      message: `Unknown op ${JSON.stringify(input.op)}. Expected a kernel op or one of ${SCENE_OPS.join(", ")}.`
    });
    return;
  }

  // A kernel entry aimed at a scene body: validate the targeting fields, then
  // hand the remainder to the v1 entry validator.
  const { body, path: bodyPath, ...rest } = input;
  if (!isId(body)) {
    errors.push({ path: `${path}.body`, message: "Kernel entries must name a scene body by id." });
  }
  if (bodyPath !== undefined) validateBodyPathGrammar(bodyPath, `${path}.path`, errors);
  validateEntry(rest, path, errors);
}

function validateBodyPathGrammar(input: unknown, path: string, errors: ProtocolError[]): void {
  if (typeof input !== "string") {
    errors.push({ path, message: "Path must be a string address of an embedded-body chain." });
    return;
  }
  let segments: string[];
  try {
    segments = parseAddress(input);
  } catch (thrown) {
    errors.push({ path, message: thrown instanceof Error ? thrown.message : String(thrown) });
    return;
  }
  if (segments.length % 2 !== 0) {
    errors.push({
      path,
      message: "Path must have an even number of segments (vessel/elementId pairs ending at an embedded body)."
    });
  }
}

function validateSceneEntry(input: Record<string, unknown>, path: string, errors: ProtocolError[]): void {
  switch (input.op as SceneOpName) {
    case "declareKind":
    case "deleteKind":
      validateKnownEntryKeys(input, ["op", "kindId", "declaration"], path, errors);
      if (!isId(input.kindId)) {
        errors.push({ path: `${path}.kindId`, message: "Kind id must be a lowercase slug." });
      }
      validateKindDeclaration(input.declaration, `${path}.declaration`, errors);
      return;
    case "insertBody":
    case "deleteBody":
      validateKnownEntryKeys(input, ["op", "name", "body"], path, errors);
      if (!isId(input.name)) {
        errors.push({ path: `${path}.name`, message: "Body name must be a lowercase slug." });
      }
      validateBodyRecord(input.body, `${path}.body`, errors);
      return;
    case "addRelation":
    case "removeRelation":
      validateKnownEntryKeys(input, ["op", "relation"], path, errors);
      validateRelation(input.relation, `${path}.relation`, errors);
      return;
  }
}

function validateKnownEntryKeys(
  input: Record<string, unknown>,
  known: readonly string[],
  path: string,
  errors: ProtocolError[]
): void {
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) {
      errors.push({ path: `${path}.${key}`, message: `Unknown key "${key}".` });
    }
  }
}

function validateKindDeclaration(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Kind declaration must be an object." });
    return;
  }
  validateKnownEntryKeys(input, ["symmetric", "irreflexive", "fromMax", "toMax"], path, errors);
  for (const flag of ["symmetric", "irreflexive"] as const) {
    if (input[flag] !== undefined && typeof input[flag] !== "boolean") {
      errors.push({ path: `${path}.${flag}`, message: `${flag} must be a boolean.` });
    }
  }
  for (const budget of ["fromMax", "toMax"] as const) {
    const value = input[budget];
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
      errors.push({ path: `${path}.${budget}`, message: `${budget} must be a non-negative integer.` });
    }
  }
  if (input.symmetric === true && input.toMax !== undefined) {
    errors.push({ path: `${path}.toMax`, message: "Symmetric kinds may not declare toMax; positions are one pool." });
  }
}

function validateBodyRecord(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Body must be an object." });
    return;
  }
  for (const error of validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body: input })) {
    errors.push({
      path: error.path.startsWith("$.body") ? `${path}${error.path.slice("$.body".length)}` : `${path} (${error.path})`,
      message: error.message
    });
  }
}

function validateRelation(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Relation must be an object with kind, from, and to." });
    return;
  }
  validateKnownEntryKeys(input, ["kind", "from", "to"], path, errors);
  if (!isId(input.kind)) {
    errors.push({ path: `${path}.kind`, message: "Relation kind must be a lowercase slug." });
  }
  for (const end of ["from", "to"] as const) {
    const value = input[end];
    if (typeof value !== "string") {
      errors.push({ path: `${path}.${end}`, message: "Relation endpoint must be a scene address string." });
      continue;
    }
    try {
      parseSceneAddress(value);
    } catch (thrown) {
      errors.push({ path: `${path}.${end}`, message: thrown instanceof Error ? thrown.message : String(thrown) });
    }
  }
}

// Nested-body path resolution
//
// A path is an alternating vessel/element-id chain descending through
// element.body. Resolution records each hop so the mutated inner body can be
// re-embedded by rebuilding the chain outward. A path whose prefix no longer
// resolves is a stale patch: it was recorded against a different structure.

type PathHop = { vesselId: VesselId; elementIndex: number };

function resolveBodyPath(
  body: Body,
  path: string,
  errorPath: string
): Result<{ inner: Body; hops: PathHop[] }, ProtocolError[]> {
  const segments = parseAddress(path);
  const hops: PathHop[] = [];
  let scope = body;
  for (let position = 0; position < segments.length; position += 2) {
    const vesselId = segments[position];
    const elementId = segments[position + 1];
    const prefix = segments.slice(0, position + 2).join("/");
    if (!Object.hasOwn(scope.vessels, vesselId)) {
      return staleAt(errorPath, `path segment "${prefix}" does not resolve: no vessel "${vesselId}"`);
    }
    const vessel = scope.vessels[vesselId];
    const elementIndex = (vessel.contains ?? []).findIndex((element) => element.id === elementId);
    if (elementIndex === -1) {
      return staleAt(errorPath, `path segment "${prefix}" does not resolve: no element "${elementId}" in "${vesselId}"`);
    }
    const element = vessel.contains![elementIndex] as ContainedElement;
    if (!element.body) {
      return staleAt(errorPath, `path segment "${prefix}" does not resolve: element "${elementId}" carries no body`);
    }
    hops.push({ vesselId, elementIndex });
    scope = element.body;
  }
  return { ok: true, value: { inner: scope, hops } };
}

function reembed(outer: Body, hops: PathHop[], inner: Body): Body {
  if (hops.length === 0) return inner;
  const [hop, ...rest] = hops;
  const vessel = outer.vessels[hop.vesselId];
  const contains = [...(vessel.contains ?? [])];
  const element = contains[hop.elementIndex] as ContainedElement;
  contains[hop.elementIndex] = { ...element, body: reembed(element.body as Body, rest, inner) };
  return {
    ...outer,
    vessels: { ...outer.vessels, [hop.vesselId]: { ...vessel, contains } }
  };
}

function staleAt<T>(path: string, detail: string): Result<T, ProtocolError[]> {
  return { ok: false, errors: [{ path, message: `stale patch: ${detail}.` }] };
}

// Application
//
// Entries fold left-to-right. Scene entries call paperchain's exported
// operations (local laws enforced by throwing; thrown messages become
// path-annotated errors) and then check their destruction records. Kernel
// entries resolve their body (and optional path), apply through the v1 entry
// machinery against the inner body, and re-embed. After the last entry the
// scene is validated globally — this is where strict dangling surfaces — and
// returned with every body in canonical form.

export function applyScenePatch(scene: Scene, document: ScenePatchDocument): Result<Scene, ProtocolError[]> {
  const patchErrors = validateScenePatch(document);
  if (patchErrors.length > 0) return { ok: false, errors: patchErrors };

  let current = scene;
  for (const [index, entry] of document.patch.entries()) {
    const path = `$.patch.${index}`;
    let step: Result<Scene, ProtocolError[]>;
    try {
      step = applyScenePatchEntry(current, entry, path);
    } catch (thrown) {
      return { ok: false, errors: [{ path, message: thrown instanceof Error ? thrown.message : String(thrown) }] };
    }
    if (!step.ok) return step;
    current = step.value;
  }

  const globalErrors = validateScene(current);
  if (globalErrors.length > 0) return { ok: false, errors: globalErrors };

  return { ok: true, value: canonicalizeScene(current) };
}

function applyScenePatchEntry(scene: Scene, entry: ScenePatchEntry, path: string): Result<Scene, ProtocolError[]> {
  switch (entry.op) {
    case "declareKind":
      return { ok: true, value: declareKind(scene, entry.kindId, structuredClone(entry.declaration)) };
    case "deleteKind": {
      const { scene: next, declaration } = deleteKind(scene, entry.kindId);
      if (!jsonEqual(declaration, entry.declaration)) {
        return staleAt(
          `${path}.declaration`,
          `deleteKind removed a declaration of "${entry.kindId}" that does not match the entry's record`
        );
      }
      return { ok: true, value: next };
    }
    case "insertBody":
      return { ok: true, value: insertBody(scene, entry.name, structuredClone(entry.body)) };
    case "deleteBody": {
      const { scene: next, body } = deleteBody(scene, entry.name);
      if (!jsonEqual(canonicalizeBody(body), canonicalizeBody(entry.body))) {
        return staleAt(`${path}.body`, `deleteBody removed a body "${entry.name}" that does not match the entry's record`);
      }
      return { ok: true, value: next };
    }
    case "addRelation":
      return { ok: true, value: addRelation(scene, structuredClone(entry.relation)) };
    case "removeRelation": {
      const { scene: next, relation } = removeRelation(scene, entry.relation);
      if (
        relation.kind !== entry.relation.kind ||
        relation.from !== entry.relation.from ||
        relation.to !== entry.relation.to
      ) {
        return staleAt(
          `${path}.relation`,
          `removeRelation removed the stored relation ${relation.from} ${relation.kind} ${relation.to}, but the entry records ${entry.relation.from} ${entry.relation.kind} ${entry.relation.to}`
        );
      }
      return { ok: true, value: next };
    }
    default:
      return applyKernelEntry(scene, entry, path);
  }
}

function applyKernelEntry(scene: Scene, entry: SceneKernelEntry, path: string): Result<Scene, ProtocolError[]> {
  if (!Object.hasOwn(scene.bodies, entry.body)) {
    return staleAt(`${path}.body`, `scene has no body "${entry.body}"`);
  }
  const target = scene.bodies[entry.body];

  let inner = target;
  let hops: PathHop[] = [];
  if (entry.path !== undefined) {
    const resolved = resolveBodyPath(target, entry.path, `${path}.path`);
    if (!resolved.ok) return resolved;
    inner = resolved.value.inner;
    hops = resolved.value.hops;
  }

  const step = applyEntry(inner, entry, path);
  if (!step.ok) return step;

  const nextBody = reembed(target, hops, step.value);
  return { ok: true, value: { ...scene, bodies: { ...scene.bodies, [entry.body]: nextBody } } };
}

// Inversion (law 3) — body-free, as in v1. Sequence reversal alone settles
// the dependency order between kinds, bodies, and relations.

export function invertScenePatch(document: ScenePatchDocument): ScenePatchDocument {
  assertScenePatch(document);
  const inverted: ScenePatchEntry[] = [];
  for (let index = document.patch.length - 1; index >= 0; index -= 1) {
    inverted.push(...invertScenePatchEntry(document.patch[index] as ScenePatchEntry));
  }
  return { protocol: PAPERFOLD_SCENE_PROTOCOL, patch: inverted };
}

function invertScenePatchEntry(entry: ScenePatchEntry): ScenePatchEntry[] {
  switch (entry.op) {
    case "declareKind":
      return [{ op: "deleteKind", kindId: entry.kindId, declaration: structuredClone(entry.declaration) }];
    case "deleteKind":
      return [{ op: "declareKind", kindId: entry.kindId, declaration: structuredClone(entry.declaration) }];
    case "insertBody":
      return [{ op: "deleteBody", name: entry.name, body: structuredClone(entry.body) }];
    case "deleteBody":
      return [{ op: "insertBody", name: entry.name, body: structuredClone(entry.body) }];
    case "addRelation":
      // An added relation is stored exactly as written, so the record is
      // trivially in stored orientation.
      return [{ op: "removeRelation", relation: structuredClone(entry.relation) }];
    case "removeRelation":
      return [{ op: "addRelation", relation: structuredClone(entry.relation) }];
    default: {
      const { body, path, ...kernel } = entry;
      return invertEntry(kernel as PatchEntry).map((inverse) =>
        path === undefined ? { ...inverse, body } : { ...inverse, body, path }
      );
    }
  }
}

// Composition (law 2)

export function composeScenePatches(a: ScenePatchDocument, b: ScenePatchDocument): ScenePatchDocument {
  assertScenePatch(a);
  assertScenePatch(b);
  return {
    protocol: PAPERFOLD_SCENE_PROTOCOL,
    patch: [...a.patch, ...b.patch].map((entry) => structuredClone(entry))
  };
}

// Diff (law 1)
//
// Sound, not minimal: applyScenePatch(a, diffScenes(a, b)) yields exactly b
// in canonical form, including each relation's stored endpoint orientation.
// The strategy tracks a live intermediate scene so each entry's records are
// computed from the state it will apply against, and each phase's local-law
// preconditions hold:
//
//   1. remove relations whose exact stored tuple is absent from b — including
//      every relation of a kind whose declaration changed (declaration changes
//      reify as deleteKind + declareKind, and deleteKind refuses while
//      relations use the kind);
//   2. delete bodies absent from b (their relations went in 1);
//   3. delete kinds absent from b or re-declared;
//   4. declare kinds new in b or re-declared;
//   5. insert bodies new in b;
//   6. per kept body, the v1 body diff, entries stamped with the body name
//      (shallow: nested-body differences reify as whole-element replacement);
//   7. add relations of b not yet present.

export function diffScenes(a: Scene, b: Scene): Result<ScenePatchDocument, ProtocolError[]> {
  const entries: ScenePatchEntry[] = [];
  let current: Scene = {
    protocol: a.protocol,
    bodies: { ...a.bodies },
    kinds: { ...a.kinds },
    relations: [...a.relations]
  };

  const changedKinds = new Set<KindId>();
  for (const [kindId, declaration] of Object.entries(a.kinds)) {
    const counterpart = Object.hasOwn(b.kinds, kindId) ? b.kinds[kindId] : undefined;
    if (counterpart !== undefined && !jsonEqual(declaration, counterpart)) changedKinds.add(kindId);
  }

  const relationSort = (x: Relation, y: Relation): number =>
    `${x.kind} ${x.from} ${x.to}`.localeCompare(`${y.kind} ${y.from} ${y.to}`);

  // 1. remove relations absent from b, or whose kind is removed/re-declared
  const keptInB = (relation: Relation): boolean => {
    if (changedKinds.has(relation.kind)) return false;
    if (!Object.hasOwn(b.kinds, relation.kind)) return false;
    return b.relations.some((candidate) => sameStoredRelation(candidate, relation));
  };
  const toRemove = current.relations.filter((relation) => !keptInB(relation)).sort(relationSort);
  for (const relation of toRemove) {
    const { scene: next, relation: removed } = removeRelation(current, relation);
    entries.push({ op: "removeRelation", relation: structuredClone(removed) });
    current = next;
  }

  // 2. delete bodies absent from b
  for (const name of Object.keys(current.bodies).sort()) {
    if (Object.hasOwn(b.bodies, name)) continue;
    const { scene: next, body } = deleteBody(current, name);
    entries.push({ op: "deleteBody", name, body: canonicalizeBody(body) });
    current = next;
  }

  // 3. delete kinds absent from b or re-declared
  for (const kindId of Object.keys(current.kinds).sort()) {
    if (Object.hasOwn(b.kinds, kindId) && !changedKinds.has(kindId)) continue;
    const { scene: next, declaration } = deleteKind(current, kindId);
    entries.push({ op: "deleteKind", kindId, declaration: structuredClone(declaration) });
    current = next;
  }

  // 4. declare kinds new in b or re-declared
  for (const kindId of Object.keys(b.kinds).sort()) {
    if (Object.hasOwn(current.kinds, kindId)) continue;
    const declaration = structuredClone(b.kinds[kindId]);
    entries.push({ op: "declareKind", kindId, declaration: structuredClone(declaration) });
    current = declareKind(current, kindId, declaration);
  }

  // 5. insert bodies new in b
  for (const name of Object.keys(b.bodies).sort()) {
    if (Object.hasOwn(current.bodies, name)) continue;
    const body = canonicalizeBody(b.bodies[name]);
    entries.push({ op: "insertBody", name, body: structuredClone(body) });
    current = insertBody(current, name, body);
  }

  // 6. per-kept-body kernel diff
  for (const name of Object.keys(current.bodies).sort()) {
    const want = Object.hasOwn(b.bodies, name) ? b.bodies[name] : undefined;
    const have = current.bodies[name];
    if (!want || have === want) continue;
    const diff = diffBodies(have, want);
    if (!diff.ok) {
      return {
        ok: false,
        errors: diff.errors.map((error) => ({
          path: error.path.startsWith("$") ? `$.bodies.${name}${error.path.slice(1)}` : error.path,
          message: error.message
        }))
      };
    }
    for (const entry of diff.value.patch) {
      entries.push({ ...entry, body: name });
    }
    current = { ...current, bodies: { ...current.bodies, [name]: canonicalizeBody(want) } };
  }

  // 7. add exact stored relation tuples of b not yet present
  const missing = b.relations
    .filter((relation) => !current.relations.some((candidate) => sameStoredRelation(candidate, relation)))
    .sort(relationSort);
  for (const relation of missing) {
    entries.push({ op: "addRelation", relation: structuredClone(relation) });
    current = addRelation(current, structuredClone(relation));
  }

  return { ok: true, value: { protocol: PAPERFOLD_SCENE_PROTOCOL, patch: entries } };
}

function sameStoredRelation(a: Relation, b: Relation): boolean {
  return a.kind === b.kind && a.from === b.from && a.to === b.to;
}

// Canonical form: every body canonical, and the relation table sorted by
// (kind, from, to) — paperchain's relations are a flat table whose order
// carries no meaning, so remove/re-add cycles must not read as change. Kinds
// have no non-canonical spellings (addresses are already canonical strings).

export function canonicalizeScene(scene: Scene): Scene {
  return {
    protocol: scene.protocol,
    bodies: Object.fromEntries(
      Object.entries(scene.bodies).map(([name, body]) => [name, canonicalizeBody(body)])
    ),
    kinds: structuredClone(scene.kinds),
    relations: scene.relations
      .map((relation) => ({ ...relation }))
      .sort((x, y) => `${x.kind} ${x.from} ${x.to}`.localeCompare(`${y.kind} ${y.from} ${y.to}`))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
