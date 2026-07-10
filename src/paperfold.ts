import {
  OPPOSITE_SIDES,
  PAPER_DOLL_PROTOCOL,
  SIDES,
  connect,
  deleteVessel,
  deriveConnections,
  disconnect,
  formatProtocolErrors,
  insertElement,
  insertVessel,
  isId,
  moveElement,
  removeElement,
  validateAcceptToken,
  validateConnection,
  validateContainedElement,
  validateDocument,
  validateEndpoint,
  validateKnownKeys
} from "paperdoll";
import type {
  Body,
  Connection,
  ContainedElement,
  Endpoint,
  JsonValue,
  ProtocolError,
  Result,
  Side,
  Vessel,
  VesselId
} from "paperdoll";

export const PAPERFOLD_PROTOCOL = "paperfold/v1" as const;

// The patch vocabulary is the reification of the kernel's operation set: one
// entry shape per exported paperdoll operation. Every entry carries the
// destruction records the kernel op reports, inlined under the kernel's own
// names. The records serve twice: they are the material for body-free
// inversion (law 3), and they are integrity preconditions — if the kernel op
// reports something other than what the entry records, the patch is stale and
// application fails (law 4).

export type VesselShape = Omit<Vessel, "ports">;

export type ConnectEntry = {
  op: "connect";
  from: Endpoint;
  to: Endpoint;
  displaced: Connection[];
};

export type DisconnectEntry = {
  op: "disconnect";
  endpoint: Endpoint;
  removed: Connection;
};

export type InsertVesselEntry = {
  op: "insertVessel";
  vesselId: VesselId;
  vessel: VesselShape;
  at?: Endpoint;
  bridged: Connection | null;
};

export type DeleteVesselEntry = {
  op: "deleteVessel";
  vesselId: VesselId;
  collapseOppositeNeighbors?: boolean;
  vessel: Vessel;
  collapsed: Connection | null;
};

export type InsertElementEntry = {
  op: "insertElement";
  vesselId: VesselId;
  element: ContainedElement;
  index: number;
};

export type RemoveElementEntry = {
  op: "removeElement";
  vesselId: VesselId;
  index: number;
  element: ContainedElement;
};

export type MoveElementEntry = {
  op: "moveElement";
  from: VesselId;
  index: number;
  to: VesselId;
  element: ContainedElement;
  toIndex: number;
};

export type PatchEntry =
  | ConnectEntry
  | DisconnectEntry
  | InsertVesselEntry
  | DeleteVesselEntry
  | InsertElementEntry
  | RemoveElementEntry
  | MoveElementEntry;

export type PaperfoldDocument = {
  protocol: typeof PAPERFOLD_PROTOCOL;
  patch: PatchEntry[];
};

const OPS = [
  "connect",
  "disconnect",
  "insertVessel",
  "deleteVessel",
  "insertElement",
  "removeElement",
  "moveElement"
] as const;

const SIDE_SET = new Set<string>(SIDES);

// Parsing and validation

export function parsePatch(input: unknown): Result<PaperfoldDocument, ProtocolError[]> {
  const errors = validatePatch(input);
  if (errors.length > 0) return { ok: false, errors };
  const document = input as PaperfoldDocument;
  return {
    ok: true,
    value: { protocol: PAPERFOLD_PROTOCOL, patch: document.patch.map((entry) => structuredClone(entry)) }
  };
}

export function assertPatch(input: unknown): asserts input is PaperfoldDocument {
  const result = parsePatch(input);
  if (!result.ok) {
    throw new Error(formatProtocolErrors(result.errors));
  }
}

export function validatePatch(input: unknown): ProtocolError[] {
  const errors: ProtocolError[] = [];

  if (!isRecord(input)) {
    return [{ path: "$", message: "Patch document must be an object." }];
  }

  if (input.protocol !== PAPERFOLD_PROTOCOL) {
    errors.push({ path: "$.protocol", message: `Expected "${PAPERFOLD_PROTOCOL}".` });
  }

  validateKnownKeys(input, ["protocol", "patch"], "$", errors);

  if (!Array.isArray(input.patch)) {
    errors.push({ path: "$.patch", message: "Patch must be an array of patch entries." });
    return errors;
  }

  input.patch.forEach((entry, index) => validateEntry(entry, `$.patch.${index}`, errors));

  return errors;
}

export function validateEntry(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Patch entry must be an object." });
    return;
  }

  switch (input.op) {
    case "connect":
      validateKnownKeys(input, ["op", "from", "to", "displaced"], path, errors);
      validateEndpoint(input.from, `${path}.from`, errors);
      validateEndpoint(input.to, `${path}.to`, errors);
      validateConnectionList(input.displaced, `${path}.displaced`, errors);
      return;
    case "disconnect":
      validateKnownKeys(input, ["op", "endpoint", "removed"], path, errors);
      validateEndpoint(input.endpoint, `${path}.endpoint`, errors);
      if (input.removed === null) {
        errors.push({
          path: `${path}.removed`,
          message: "A no-op disconnect is not a lawful entry; removed must be the severed connection."
        });
        return;
      }
      validateConnection(input.removed, `${path}.removed`, errors);
      return;
    case "insertVessel":
      validateKnownKeys(input, ["op", "vesselId", "vessel", "at", "bridged"], path, errors);
      validateVesselId(input.vesselId, `${path}.vesselId`, errors);
      validateVesselShape(input.vessel, `${path}.vessel`, errors);
      if (input.at !== undefined) validateEndpoint(input.at, `${path}.at`, errors);
      validateNullableConnection(input.bridged, `${path}.bridged`, errors);
      return;
    case "deleteVessel":
      validateKnownKeys(input, ["op", "vesselId", "collapseOppositeNeighbors", "vessel", "collapsed"], path, errors);
      validateVesselId(input.vesselId, `${path}.vesselId`, errors);
      if (input.collapseOppositeNeighbors !== undefined && typeof input.collapseOppositeNeighbors !== "boolean") {
        errors.push({ path: `${path}.collapseOppositeNeighbors`, message: "collapseOppositeNeighbors must be a boolean." });
      }
      validateVessel(input.vessel, `${path}.vessel`, errors);
      validateNullableConnection(input.collapsed, `${path}.collapsed`, errors);
      return;
    case "insertElement":
      validateKnownKeys(input, ["op", "vesselId", "element", "index"], path, errors);
      validateVesselId(input.vesselId, `${path}.vesselId`, errors);
      validateContainedElement(input.element, `${path}.element`, errors);
      validateIndex(input.index, `${path}.index`, errors);
      return;
    case "removeElement":
      validateKnownKeys(input, ["op", "vesselId", "index", "element"], path, errors);
      validateVesselId(input.vesselId, `${path}.vesselId`, errors);
      validateIndex(input.index, `${path}.index`, errors);
      validateContainedElement(input.element, `${path}.element`, errors);
      return;
    case "moveElement":
      validateKnownKeys(input, ["op", "from", "index", "to", "element", "toIndex"], path, errors);
      validateVesselId(input.from, `${path}.from`, errors);
      validateIndex(input.index, `${path}.index`, errors);
      validateVesselId(input.to, `${path}.to`, errors);
      validateContainedElement(input.element, `${path}.element`, errors);
      validateIndex(input.toIndex, `${path}.toIndex`, errors);
      return;
    default:
      errors.push({
        path: `${path}.op`,
        message: `Unknown op ${JSON.stringify(input.op)}. Expected one of ${OPS.join(", ")}.`
      });
  }
}

function validateNullableConnection(input: unknown, path: string, errors: ProtocolError[]): void {
  if (input === undefined) {
    errors.push({ path, message: "Destruction record is required; use null when the operation destroyed nothing." });
    return;
  }
  if (input === null) return;
  validateConnection(input, path, errors);
}

function validateConnectionList(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!Array.isArray(input)) {
    errors.push({ path, message: "Destruction record must be an array of connections (empty when nothing was displaced)." });
    return;
  }
  input.forEach((connection, index) => validateConnection(connection, `${path}.${index}`, errors));
}

function validateVesselId(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isId(input)) {
    errors.push({ path, message: "Vessel id must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens." });
  }
}

function validateVesselShape(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Vessel must be an object." });
    return;
  }
  if (input.ports !== undefined) {
    errors.push({
      path: `${path}.ports`,
      message: "insertVessel vessels are created without ports; connections are made by connect entries."
    });
  }
  // "ports" is allowed here only so the tailored error above stands alone,
  // without a duplicate generic "Unknown key" error at the same path.
  validateKnownKeys(input, ["accepts", "contains", "ports"], path, errors);
  validateAcceptTokens(input.accepts, `${path}.accepts`, errors);
  validateElements(input.contains, `${path}.contains`, errors);
}

function validateVessel(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Vessel must be an object." });
    return;
  }
  validateKnownKeys(input, ["accepts", "contains", "ports"], path, errors);
  validateAcceptTokens(input.accepts, `${path}.accepts`, errors);
  validateElements(input.contains, `${path}.contains`, errors);

  if (input.ports === undefined) return;
  if (!isRecord(input.ports)) {
    errors.push({ path: `${path}.ports`, message: "Ports must be an object keyed by side." });
    return;
  }
  for (const [side, port] of Object.entries(input.ports)) {
    if (!isSide(side)) {
      errors.push({ path: `${path}.ports.${side}`, message: "Port side must be top, right, bottom, or left." });
      continue;
    }
    validatePortAddress(port, `${path}.ports.${side}`, errors);
  }
}

function validatePortAddress(input: unknown, path: string, errors: ProtocolError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, message: "Port address must be an object." });
    return;
  }
  validateKnownKeys(input, ["vessel", "side"], path, errors);
  if (!isId(input.vessel)) {
    errors.push({ path: `${path}.vessel`, message: "Port vessel must be a valid vessel id." });
  }
  if (!isSide(input.side)) {
    errors.push({ path: `${path}.side`, message: "Port side must be top, right, bottom, or left." });
  }
}

function validateAcceptTokens(input: unknown, path: string, errors: ProtocolError[]): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) {
    errors.push({ path, message: "Accepts must be an array of accept token objects." });
    return;
  }
  input.forEach((token, index) => validateAcceptToken(token, `${path}.${index}`, errors));
}

function validateElements(input: unknown, path: string, errors: ProtocolError[]): void {
  if (input === undefined) return;
  if (!Array.isArray(input)) {
    errors.push({ path, message: "Contains must be an array of contained element objects." });
    return;
  }
  input.forEach((element, index) => validateContainedElement(element, `${path}.${index}`, errors));
}

function validateIndex(input: unknown, path: string, errors: ProtocolError[]): void {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    errors.push({ path, message: "Index must be a non-negative integer." });
  }
}

// Application
//
// Entries apply sequentially through the kernel's exported operations, which
// enforce local laws by throwing; thrown messages become path-annotated
// errors. Each destruction record is checked against what the kernel op
// actually reported — a mismatch means the patch was recorded against a
// different state, and the whole application fails ("stale patch"). After the
// last entry the resulting body is validated globally (the kernel's
// local/global split: legitimate multi-entry patches pass through globally
// incomplete intermediate states). Application is atomic by purity: on any
// failure the errors are returned and no body is produced.

export function applyPatch(body: Body, document: PaperfoldDocument): Result<Body, ProtocolError[]> {
  const patchErrors = validatePatch(document);
  if (patchErrors.length > 0) return { ok: false, errors: patchErrors };

  let current = body;
  for (const [index, entry] of document.patch.entries()) {
    const path = `$.patch.${index}`;
    let step: Result<Body, ProtocolError[]>;
    try {
      step = applyEntry(current, entry, path);
    } catch (thrown) {
      return { ok: false, errors: [{ path, message: thrown instanceof Error ? thrown.message : String(thrown) }] };
    }
    if (!step.ok) return step;
    current = step.value;
  }

  const globalErrors = validateDocument({ protocol: PAPER_DOLL_PROTOCOL, body: current });
  if (globalErrors.length > 0) return { ok: false, errors: globalErrors };

  return { ok: true, value: canonicalizeBody(current) };
}

export function applyEntry(body: Body, entry: PatchEntry, path: string): Result<Body, ProtocolError[]> {
  switch (entry.op) {
    case "connect": {
      const { body: next, displaced } = connect(body, entry.from, entry.to);
      if (!connectionListsEqual(displaced, entry.displaced)) {
        return stale(
          `${path}.displaced`,
          `connect displaced ${describeConnections(displaced)} but the entry records ${describeConnections(entry.displaced)}`
        );
      }
      return { ok: true, value: next };
    }
    case "disconnect": {
      const { body: next, removed } = disconnect(body, entry.endpoint);
      if (!removed) {
        return stale(
          `${path}.removed`,
          `disconnect at ${describeEndpoint(entry.endpoint)} removed nothing but the entry records ${describeConnection(entry.removed)}`
        );
      }
      if (!connectionsEqual(removed, entry.removed)) {
        return stale(
          `${path}.removed`,
          `disconnect removed ${describeConnection(removed)} but the entry records ${describeConnection(entry.removed)}`
        );
      }
      return { ok: true, value: next };
    }
    case "insertVessel": {
      const options = entry.at === undefined ? { id: entry.vesselId } : { id: entry.vesselId, at: entry.at };
      const { body: next, bridged } = insertVessel(body, entry.vessel, options);
      if (!nullableConnectionsEqual(bridged, entry.bridged)) {
        return stale(
          `${path}.bridged`,
          `insertVessel bridged ${describeNullableConnection(bridged)} but the entry records ${describeNullableConnection(entry.bridged)}`
        );
      }
      return { ok: true, value: next };
    }
    case "deleteVessel": {
      const options =
        entry.collapseOppositeNeighbors === undefined
          ? {}
          : { collapseOppositeNeighbors: entry.collapseOppositeNeighbors };
      const { body: next, vessel, collapsed } = deleteVessel(body, entry.vesselId, options);
      if (!vesselsEqual(vessel, entry.vessel)) {
        return stale(
          `${path}.vessel`,
          `deleteVessel removed a vessel that does not match the entry's record of "${entry.vesselId}"`
        );
      }
      if (!nullableConnectionsEqual(collapsed, entry.collapsed)) {
        return stale(
          `${path}.collapsed`,
          `deleteVessel collapsed ${describeNullableConnection(collapsed)} but the entry records ${describeNullableConnection(entry.collapsed)}`
        );
      }
      return { ok: true, value: next };
    }
    case "insertElement":
      return { ok: true, value: insertElement(body, entry.vesselId, entry.element, entry.index) };
    case "removeElement": {
      const { body: next, element } = removeElement(body, entry.vesselId, entry.index);
      if (!elementsEqual(element, entry.element)) {
        return stale(
          `${path}.element`,
          `removeElement at "${entry.vesselId}" index ${entry.index} removed an element that does not match the entry's record`
        );
      }
      return { ok: true, value: next };
    }
    case "moveElement": {
      const sourceBefore = body.vessels[entry.from]?.contains ?? [];
      const landing = entry.from === entry.to ? sourceBefore.length - 1 : (body.vessels[entry.to]?.contains ?? []).length;
      const next = moveElement(body, entry.from, entry.index, entry.to);
      const moved = sourceBefore[entry.index] as ContainedElement;
      if (!elementsEqual(moved, entry.element)) {
        return stale(
          `${path}.element`,
          `moveElement at "${entry.from}" index ${entry.index} moved an element that does not match the entry's record`
        );
      }
      if (landing !== entry.toIndex) {
        return stale(
          `${path}.toIndex`,
          `moveElement lands at index ${landing} in "${entry.to}" but the entry records ${entry.toIndex}`
        );
      }
      return { ok: true, value: next };
    }
  }
}

function stale(path: string, detail: string): Result<Body, ProtocolError[]> {
  return { ok: false, errors: [{ path, message: `stale patch: ${detail}.` }] };
}

// Inversion (law 3)
//
// Body-free: inversion reads only the entries themselves. The patch is
// reversed and each entry inverts to one or more entries whose destruction
// records are reconstructed from the original entry's records.

export function invertPatch(document: PaperfoldDocument): PaperfoldDocument {
  assertPatch(document);
  const inverted: PatchEntry[] = [];
  for (let index = document.patch.length - 1; index >= 0; index -= 1) {
    inverted.push(...invertEntry(document.patch[index] as PatchEntry));
  }
  return { protocol: PAPERFOLD_PROTOCOL, patch: inverted };
}

export function invertEntry(entry: PatchEntry): PatchEntry[] {
  switch (entry.op) {
    case "connect": {
      // Undo the created connection, then restore each displaced connection.
      // After the disconnect both created endpoints are free, and each
      // displaced connection's far endpoint was freed by the original
      // connect, so the restoring connects displace nothing.
      const created: Connection = structuredClone({ from: entry.from, to: entry.to });
      return [
        { op: "disconnect", endpoint: structuredClone(entry.from), removed: created },
        ...entry.displaced.map(
          (connection): ConnectEntry => ({
            op: "connect",
            from: structuredClone(connection.from),
            to: structuredClone(connection.to),
            displaced: []
          })
        )
      ];
    }
    case "disconnect":
      return [
        { op: "connect", from: structuredClone(entry.removed.from), to: structuredClone(entry.removed.to), displaced: [] }
      ];
    case "insertVessel": {
      if (entry.at === undefined) {
        return [
          { op: "deleteVessel", vesselId: entry.vesselId, vessel: structuredClone(entry.vessel), collapsed: null }
        ];
      }
      // The inserted vessel sits between `at` and (when bridged) the prior
      // neighbor; its ports are reconstructible from the entry alone. When a
      // connection was bridged, deleting with collapseOppositeNeighbors
      // restores it, and the collapse is recorded so the apply-time report
      // must match.
      const at: Endpoint = structuredClone(entry.at);
      const ports: Partial<Record<Side, Endpoint>> = {
        [OPPOSITE_SIDES[at.side]]: { vessel: at.vessel, side: at.side }
      };
      let collapsed: Connection | null = null;
      if (entry.bridged !== null) {
        const prior = endpointsEqual(entry.bridged.from, at) ? entry.bridged.to : entry.bridged.from;
        ports[at.side] = structuredClone(prior);
        collapsed = { from: { vessel: at.vessel, side: at.side }, to: structuredClone(prior) };
      }
      const vessel: Vessel = { ...structuredClone(entry.vessel), ports };
      const inverse: DeleteVesselEntry = { op: "deleteVessel", vesselId: entry.vesselId, vessel, collapsed };
      if (entry.bridged !== null) inverse.collapseOppositeNeighbors = true;
      return [inverse];
    }
    case "deleteVessel": {
      // Undo any collapse first, re-create the vessel portless, then restore
      // each of its recorded connections. The neighbors' ports were cleared
      // by the deletion, so the restoring connects displace nothing.
      const inverse: PatchEntry[] = [];
      if (entry.collapsed !== null) {
        inverse.push({
          op: "disconnect",
          endpoint: structuredClone(entry.collapsed.from),
          removed: structuredClone(entry.collapsed)
        });
      }
      const { ports, ...shape } = entry.vessel;
      inverse.push({ op: "insertVessel", vesselId: entry.vesselId, vessel: structuredClone(shape), bridged: null });
      for (const side of SIDES) {
        const target = ports?.[side];
        if (!target) continue;
        inverse.push({
          op: "connect",
          from: { vessel: entry.vesselId, side },
          to: { vessel: target.vessel, side: target.side },
          displaced: []
        });
      }
      return inverse;
    }
    case "insertElement":
      return [
        { op: "removeElement", vesselId: entry.vesselId, index: entry.index, element: structuredClone(entry.element) }
      ];
    case "removeElement":
      return [
        { op: "insertElement", vesselId: entry.vesselId, element: structuredClone(entry.element), index: entry.index }
      ];
    case "moveElement":
      // The kernel appends moved elements, so the element sits at the
      // recorded landing index; remove it there and re-insert it at its
      // original position (a bare moveElement back would append, losing the
      // position).
      return [
        { op: "removeElement", vesselId: entry.to, index: entry.toIndex, element: structuredClone(entry.element) },
        { op: "insertElement", vesselId: entry.from, element: structuredClone(entry.element), index: entry.index }
      ];
  }
}

// Composition (law 2)

export function composePatches(a: PaperfoldDocument, b: PaperfoldDocument): PaperfoldDocument {
  assertPatch(a);
  assertPatch(b);
  return {
    protocol: PAPERFOLD_PROTOCOL,
    patch: [...a.patch, ...b.patch].map((entry) => structuredClone(entry))
  };
}

// Diff (law 1)
//
// The diff is sound, not minimal: applyPatch(diffBodies(a, b), a) yields
// exactly b (in canonical form). The strategy tracks the intermediate body so
// every entry's destruction records are computed from the state that entry
// will actually apply against:
//
//   1. delete vessels absent from b, and vessels whose accepts changed
//      (no kernel operation edits accepts, so those reify as replacement);
//   2. disconnect every remaining connection not present in b;
//   3. wholesale-replace the contains of kept vessels that differ;
//   4. insert vessels new in b (including replacements), portless;
//   5. connect each connection of b not yet present, once, canonically.

export function diffBodies(a: Body, b: Body): Result<PaperfoldDocument, ProtocolError[]> {
  if (a.root !== b.root) {
    return {
      ok: false,
      errors: [
        {
          path: "$.root",
          message: `diff requires equal roots, but "${a.root}" and "${b.root}" differ; no kernel operation changes a body's root.`
        }
      ]
    };
  }

  const replaced = new Set<VesselId>();
  for (const [vesselId, vessel] of Object.entries(a.vessels)) {
    const counterpart = b.vessels[vesselId];
    if (counterpart && !jsonEqual(vessel.accepts, counterpart.accepts)) replaced.add(vesselId);
  }
  if (replaced.has(a.root)) {
    return {
      ok: false,
      errors: [
        {
          path: `$.vessels.${a.root}.accepts`,
          message: `diff cannot change the accepts of root vessel "${a.root}": accepts changes reify as vessel replacement, and the root cannot be deleted.`
        }
      ]
    };
  }

  const entries: PatchEntry[] = [];
  let current = canonicalizeBody(a);

  // 1. deletions (removed vessels and accepts-replaced vessels)
  const toDelete = Object.keys(a.vessels)
    .filter((vesselId) => !b.vessels[vesselId] || replaced.has(vesselId))
    .sort();
  for (const vesselId of toDelete) {
    const { body: next, vessel } = deleteVessel(current, vesselId);
    entries.push({ op: "deleteVessel", vesselId, vessel, collapsed: null });
    current = next;
  }

  // 2. disconnect connections not in b
  const wantedConnections = new Set(deriveConnections(b).map(connectionKey));
  const staleConnections = deriveConnections(current)
    .filter((connection) => !wantedConnections.has(connectionKey(connection)))
    .sort((x, y) => connectionKey(x).localeCompare(connectionKey(y)));
  for (const connection of staleConnections) {
    const { body: next, removed } = disconnect(current, connection.from);
    entries.push({ op: "disconnect", endpoint: structuredClone(connection.from), removed: removed as Connection });
    current = next;
  }

  // 3. reconcile contains on kept vessels (wholesale replacement)
  for (const vesselId of Object.keys(current.vessels).sort()) {
    const have = current.vessels[vesselId].contains ?? [];
    const want = b.vessels[vesselId].contains ?? [];
    if (have.length === want.length && have.every((element, index) => elementsEqual(element, want[index] as ContainedElement))) {
      continue;
    }
    for (let index = have.length - 1; index >= 0; index -= 1) {
      const { body: next, element } = removeElement(current, vesselId, index);
      entries.push({ op: "removeElement", vesselId, index, element });
      current = next;
    }
    want.forEach((element, index) => {
      const record = canonicalizeElement(element);
      const next = insertElement(current, vesselId, record, index);
      entries.push({ op: "insertElement", vesselId, element: structuredClone(record), index });
      current = next;
    });
  }

  // 4. insert vessels new in b (including replacements), portless
  const toInsert = Object.keys(b.vessels)
    .filter((vesselId) => !current.vessels[vesselId])
    .sort();
  for (const vesselId of toInsert) {
    const source = b.vessels[vesselId];
    const shape: VesselShape = {};
    if (source.accepts !== undefined) shape.accepts = source.accepts.map((token) => ({ ...token }));
    const contains = (source.contains ?? []).map(canonicalizeElement);
    if (contains.length > 0) shape.contains = contains;
    const { body: next, bridged } = insertVessel(current, shape, { id: vesselId });
    entries.push({ op: "insertVessel", vesselId, vessel: structuredClone(shape), bridged });
    current = next;
  }

  // 5. connect connections of b not yet present
  const presentConnections = new Set(deriveConnections(current).map(connectionKey));
  const missingConnections = deriveConnections(b)
    .filter((connection) => !presentConnections.has(connectionKey(connection)))
    .sort((x, y) => connectionKey(x).localeCompare(connectionKey(y)));
  for (const connection of missingConnections) {
    const { body: next, displaced } = connect(current, connection.from, connection.to);
    entries.push({
      op: "connect",
      from: structuredClone(connection.from),
      to: structuredClone(connection.to),
      displaced
    });
    current = next;
  }

  return { ok: true, value: { protocol: PAPERFOLD_PROTOCOL, patch: entries } };
}

// Canonical form
//
// The kernel's operations can leave semantically empty residue behind:
// clearing a vessel's last port leaves `ports: {}`, removing its last element
// leaves `contains: []`. Both are protocol-equivalent to the key being
// absent. paperfold's laws are stated over the canonical form, in which empty
// ports and contains are dropped (recursively, through embedded bodies).
// `accepts` is never touched: `accepts: []` (sealed) and absent accepts
// (open) mean different things. applyPatch returns canonical bodies, and all
// staleness comparisons are canonical.

export function canonicalizeBody(body: Body): Body {
  return {
    root: body.root,
    vessels: Object.fromEntries(
      Object.entries(body.vessels).map(([vesselId, vessel]) => [vesselId, canonicalizeVessel(vessel)])
    )
  };
}

function canonicalizeVessel(vessel: Vessel): Vessel {
  const next: Vessel = {};
  if (vessel.accepts !== undefined) next.accepts = vessel.accepts.map((token) => ({ ...token }));
  const contains = (vessel.contains ?? []).map(canonicalizeElement);
  if (contains.length > 0) next.contains = contains;
  const ports: Partial<Record<Side, { vessel: VesselId; side: Side }>> = {};
  for (const side of SIDES) {
    const port = vessel.ports?.[side];
    if (port) ports[side] = { vessel: port.vessel, side: port.side };
  }
  if (Object.keys(ports).length > 0) next.ports = ports;
  return next;
}

export function canonicalizeElement(element: ContainedElement): ContainedElement {
  const next: ContainedElement = { kind: element.kind };
  if (element.type !== undefined) next.type = element.type;
  if (element.id !== undefined) next.id = element.id;
  if (element.data !== undefined) next.data = structuredClone(element.data) as JsonValue;
  if (element.body !== undefined) next.body = canonicalizeBody(element.body);
  return next;
}

// Equality internals

function endpointKey(endpoint: Endpoint): string {
  return `${endpoint.vessel}:${endpoint.side}`;
}

function connectionKey(connection: Connection): string {
  return [endpointKey(connection.from), endpointKey(connection.to)].sort().join("|");
}

function endpointsEqual(a: Endpoint, b: Endpoint): boolean {
  return a.vessel === b.vessel && a.side === b.side;
}

function connectionsEqual(a: Connection, b: Connection): boolean {
  return connectionKey(a) === connectionKey(b);
}

function nullableConnectionsEqual(a: Connection | null, b: Connection | null): boolean {
  if (a === null || b === null) return a === b;
  return connectionsEqual(a, b);
}

function connectionListsEqual(a: readonly Connection[], b: readonly Connection[]): boolean {
  if (a.length !== b.length) return false;
  const aKeys = a.map(connectionKey).sort();
  const bKeys = b.map(connectionKey).sort();
  return aKeys.every((key, index) => key === bKeys[index]);
}

function vesselsEqual(a: Vessel, b: Vessel): boolean {
  return jsonEqual(canonicalizeVessel(a), canonicalizeVessel(b));
}

function elementsEqual(a: ContainedElement, b: ContainedElement): boolean {
  return jsonEqual(canonicalizeElement(a), canonicalizeElement(b));
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a).filter((key) => a[key] !== undefined).sort();
    const bKeys = Object.keys(b).filter((key) => b[key] !== undefined).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => bKeys[index] === key && jsonEqual(a[key], b[key]));
  }
  return false;
}

// Describing

function describeEndpoint(endpoint: Endpoint): string {
  return `${endpoint.vessel}.${endpoint.side}`;
}

function describeConnection(connection: Connection): string {
  return `${describeEndpoint(connection.from)}<->${describeEndpoint(connection.to)}`;
}

function describeNullableConnection(connection: Connection | null): string {
  return connection === null ? "nothing" : describeConnection(connection);
}

function describeConnections(connections: readonly Connection[]): string {
  if (connections.length === 0) return "nothing";
  return connections.map(describeConnection).join(", ");
}

// Predicates

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSide(value: unknown): value is Side {
  return typeof value === "string" && SIDE_SET.has(value);
}

