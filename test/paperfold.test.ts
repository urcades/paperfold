import { describe, expect, it } from "vitest";
import { connect, deleteVessel, disconnect, insertElement, insertVessel } from "paperdoll";
import type { Body, ContainedElement, ProtocolError, Result } from "paperdoll";
import {
  PAPERFOLD_PROTOCOL,
  applyPatch,
  assertPatch,
  canonicalizeBody,
  composePatches,
  diffBodies,
  formatProtocolErrors,
  invertPatch,
  parsePatch,
  validatePatch,
  type PaperfoldDocument,
  type PatchEntry
} from "../src/index";
import { ALICE_BODY, SAMPLE_BODY } from "./sample-body";

const CONSTRUCTOR_ID: string = "constructor";

function sample(): Body {
  return structuredClone(SAMPLE_BODY);
}

function patchOf(...entries: PatchEntry[]): PaperfoldDocument {
  return { protocol: PAPERFOLD_PROTOCOL, patch: entries };
}

function expectOk<T>(result: Result<T, ProtocolError[]>): T {
  if (!result.ok) throw new Error(formatProtocolErrors(result.errors));
  return result.value;
}

function expectErrors<T>(result: Result<T, ProtocolError[]>): ProtocolError[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

// Law 1 backbone: apply(diff(a, b), a) = b, in canonical form.
function roundTrip(a: Body, b: Body): PaperfoldDocument {
  const patch = expectOk(diffBodies(a, b));
  const applied = expectOk(applyPatch(a, patch));
  expect(applied).toEqual(canonicalizeBody(b));
  return patch;
}

// Law 3 backbone: apply(invert(p), apply(p, a)) = a, in canonical form.
function invertRoundTrip(a: Body, patch: PaperfoldDocument): void {
  const forward = expectOk(applyPatch(a, patch));
  const back = expectOk(applyPatch(forward, invertPatch(patch)));
  expect(back).toEqual(canonicalizeBody(a));
}

function containmentBody(contains: ContainedElement[]): Body {
  return { root: "root", vessels: { root: { contains } } };
}

function mutableContents(body: Body): ContainedElement[] {
  return body.vessels.root.contains as ContainedElement[];
}

// A minimal figure for topology entries: a—b connected, c free.
const CHAIN: Body = {
  root: "a",
  vessels: {
    a: { ports: { right: { vessel: "b", side: "left" } } },
    b: { ports: { left: { vessel: "a", side: "right" } } },
    c: {}
  }
};

// a—x—b, for collapse behavior.
const TRIPLE: Body = {
  root: "a",
  vessels: {
    a: { ports: { right: { vessel: "x", side: "left" } } },
    x: {
      ports: {
        left: { vessel: "a", side: "right" },
        right: { vessel: "b", side: "left" }
      }
    },
    b: { ports: { left: { vessel: "x", side: "right" } } }
  }
};

describe("validatePatch", () => {
  it("accepts a patch with every entry shape", () => {
    const document = patchOf(
      { op: "removeElement", vesselId: "head", index: 0, element: { kind: "item", type: "head", id: "salve-hood" } },
      { op: "insertElement", vesselId: "thrown", element: { kind: "item", type: "thrown", id: "rock" }, index: 0 },
      {
        op: "moveElement",
        from: "left-hand",
        index: 0,
        to: "right-hand",
        element: { kind: "item", type: "weapon", id: "steel-dagger" },
        toIndex: 1
      },
      {
        op: "disconnect",
        endpoint: { vessel: "feet", side: "right" },
        removed: { from: { vessel: "feet", side: "right" }, to: { vessel: "missile-left", side: "left" } }
      },
      { op: "connect", from: { vessel: "feet", side: "right" }, to: { vessel: "missile-left", side: "left" }, displaced: [] },
      { op: "insertVessel", vesselId: "belt", vessel: { accepts: [{ kind: "item", type: "belt" }] }, bridged: null },
      {
        op: "deleteVessel",
        vesselId: "belt",
        vessel: { accepts: [{ kind: "item", type: "belt" }] },
        collapsed: null
      }
    );
    expect(validatePatch(document)).toEqual([]);
  });

  it("rejects non-object documents, wrong protocols, and non-array patches", () => {
    expect(validatePatch(null)[0].message).toContain("must be an object");
    expect(validatePatch({ protocol: "paperfold/v2", patch: [] })[0].path).toBe("$.protocol");
    const errors = validatePatch({ protocol: PAPERFOLD_PROTOCOL, patch: "no" });
    expect(errors[0].path).toBe("$.patch");
    expect(errors[0].message).toContain("array");
  });

  it("rejects unknown keys at every level, with paths", () => {
    const errors = validatePatch({
      protocol: PAPERFOLD_PROTOCOL,
      sneaky: true,
      patch: [
        {
          op: "disconnect",
          endpoint: { vessel: "feet", side: "right", label: "Feet!" },
          removed: { from: { vessel: "feet", side: "right" }, to: { vessel: "missile-left", side: "left" } },
          note: "riding along"
        }
      ]
    });
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.sneaky");
    expect(paths).toContain("$.patch.0.note");
    expect(paths).toContain("$.patch.0.endpoint.label");
  });

  it("rejects unknown ops by name", () => {
    const errors = validatePatch({ protocol: PAPERFOLD_PROTOCOL, patch: [{ op: "teleport" }] });
    expect(errors[0].path).toBe("$.patch.0.op");
    expect(errors[0].message).toContain('"teleport"');
  });

  it("rejects malformed endpoints with path-annotated errors", () => {
    const errors = validatePatch(
      patchOf(
        { op: "connect", from: { vessel: "A", side: "up" }, to: { vessel: "b", side: "left" }, displaced: [] } as never
      )
    );
    const paths = errors.map((error) => error.path);
    expect(paths).toContain("$.patch.0.from.vessel");
    expect(paths).toContain("$.patch.0.from.side");
  });

  it("rejects insertVessel entries whose vessel carries ports", () => {
    const errors = validatePatch(
      patchOf({
        op: "insertVessel",
        vesselId: "belt",
        vessel: { ports: { left: { vessel: "body", side: "right" } } } as never,
        bridged: null
      })
    );
    expect(errors[0].path).toBe("$.patch.0.vessel.ports");
    expect(errors[0].message).toContain("without ports");
  });

  it("rejects a disconnect that records no removed connection", () => {
    const errors = validatePatch(
      patchOf({ op: "disconnect", endpoint: { vessel: "feet", side: "right" }, removed: null } as never)
    );
    expect(errors[0].path).toBe("$.patch.0.removed");
    expect(errors[0].message).toContain("no-op disconnect");
  });

  it("requires destruction records to be present, null when empty", () => {
    const errors = validatePatch(
      patchOf({ op: "insertVessel", vesselId: "belt", vessel: {} } as never)
    );
    expect(errors[0].path).toBe("$.patch.0.bridged");
    expect(errors[0].message).toContain("required");
  });

  it("validates embedded bodies inside element records through the kernel", () => {
    const errors = validatePatch(
      patchOf({
        op: "insertElement",
        vesselId: "back",
        element: { kind: "item", id: "bad-pack", body: { root: "ghost", vessels: {} } },
        index: 0
      })
    );
    expect(errors.some((error) => error.path === "$.patch.0.element.body.root")).toBe(true);
  });

  it("collects all errors instead of stopping at the first", () => {
    const errors = validatePatch(
      patchOf(
        { op: "warp" } as never,
        { op: "insertElement", vesselId: "UPPER", element: { kind: "item" }, index: -1 } as never
      )
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.map((error) => error.path)).toContain("$.patch.1.index");
  });
});

describe("parsePatch", () => {
  it("returns a deep copy, disconnected in both directions", () => {
    const input = patchOf({
      op: "insertElement",
      vesselId: "thrown",
      element: { kind: "item", type: "thrown", id: "rock", data: { weight: 3 } },
      index: 0
    });
    const parsed = expectOk(parsePatch(input));
    expect(parsed).toEqual(input);

    (input.patch[0] as { vesselId: string }).vesselId = "mutated";
    expect((parsed.patch[0] as { vesselId: string }).vesselId).toBe("thrown");

    (parsed.patch[0] as { index: number }).index = 99;
    expect((input.patch[0] as { index: number }).index).toBe(0);
  });

  it("assertPatch throws formatted, path-annotated errors", () => {
    expect(() => assertPatch({ protocol: PAPERFOLD_PROTOCOL, patch: [{ op: "warp" }] })).toThrow("$.patch.0.op");
  });
});

describe("applyPatch", () => {
  it("applies a patch without mutating the input body", () => {
    const body = sample();
    const snapshot = structuredClone(body);
    const applied = expectOk(
      applyPatch(
        body,
        patchOf({ op: "insertElement", vesselId: "thrown", element: { kind: "item", type: "thrown", id: "rock" }, index: 0 })
      )
    );
    expect(body).toEqual(snapshot);
    expect(applied.vessels.thrown.contains).toEqual([{ kind: "item", type: "thrown", id: "rock" }]);
  });

  it("an empty patch returns the canonical body", () => {
    const applied = expectOk(applyPatch(sample(), patchOf()));
    expect(applied).toEqual(canonicalizeBody(SAMPLE_BODY));
  });

  it("converts thrown kernel errors into path-annotated errors", () => {
    const errors = expectErrors(
      applyPatch(
        sample(),
        patchOf({
          op: "connect",
          from: { vessel: "ghost", side: "right" },
          to: { vessel: "thrown", side: "left" },
          displaced: []
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0");
    expect(errors[0].message).toContain('"ghost"');
  });

  it("is atomic: a patch whose second entry fails produces no body", () => {
    const body = sample();
    const snapshot = structuredClone(body);
    const result = applyPatch(
      body,
      patchOf(
        { op: "removeElement", vesselId: "head", index: 0, element: { kind: "item", type: "head", id: "salve-hood" } },
        {
          op: "connect",
          from: { vessel: "ghost", side: "right" },
          to: { vessel: "thrown", side: "left" },
          displaced: []
        }
      )
    );
    const errors = expectErrors(result);
    expect(errors[0].path).toBe("$.patch.1");
    expect(body).toEqual(snapshot);
  });

  it("rejects a patch that leaves the final body globally invalid, even though every entry applied", () => {
    // Disconnecting the torso from the back strands the back/feet/missile
    // chain: every entry is locally lawful, the result is not.
    const errors = expectErrors(
      applyPatch(
        sample(),
        patchOf({
          op: "disconnect",
          endpoint: { vessel: "body", side: "bottom" },
          removed: { from: { vessel: "body", side: "bottom" }, to: { vessel: "back", side: "top" } }
        })
      )
    );
    expect(errors.map((error) => error.message).join("\n")).toContain("not reachable");
  });

  it("rejects a stale connect whose displaced record does not match", () => {
    const errors = expectErrors(
      applyPatch(
        structuredClone(CHAIN),
        patchOf({
          op: "connect",
          from: { vessel: "a", side: "right" },
          to: { vessel: "c", side: "left" },
          displaced: [] // actually displaces a<->b
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.displaced");
    expect(errors[0].message).toContain("stale patch");
  });

  it("rejects a stale removeElement whose element record does not match", () => {
    const errors = expectErrors(
      applyPatch(
        sample(),
        patchOf({ op: "removeElement", vesselId: "left-hand", index: 0, element: { kind: "item", type: "tool", id: "torch" } })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.element");
    expect(errors[0].message).toContain("stale patch");
  });

  it("rejects a stale deleteVessel whose vessel record does not match", () => {
    const errors = expectErrors(
      applyPatch(
        sample(),
        patchOf({
          op: "deleteVessel",
          vesselId: "missile-right",
          vessel: { accepts: [{ kind: "item", type: "missile" }] }, // record omits contents and ports
          collapsed: null
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.vessel");
    expect(errors[0].message).toContain("stale patch");
  });

  it("rejects a disconnect of an already-empty port as stale", () => {
    const errors = expectErrors(
      applyPatch(
        structuredClone(CHAIN),
        patchOf({
          op: "disconnect",
          endpoint: { vessel: "c", side: "left" },
          removed: { from: { vessel: "c", side: "left" }, to: { vessel: "a", side: "right" } }
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.removed");
    expect(errors[0].message).toContain("stale patch");
  });
});

describe("law 1: soundness — apply(diff(a, b), a) = b", () => {
  it("element edits", () => {
    const a = sample();
    const b = sample();
    b.vessels.face.contains = [{ kind: "item", type: "face", id: "visor", data: { tint: "amber" } }];
    roundTrip(a, b);
  });

  it("vessel deletion, including a ported vessel", () => {
    const a = sample();
    const b = deleteVessel(a, "left-hand").body; // leaves hands-worn adrift, portless
    const patch = roundTrip(a, b);
    expect(patch.patch.some((entry) => entry.op === "deleteVessel")).toBe(true);
  });

  it("vessel insertion with connections", () => {
    const a = sample();
    const b = insertVessel(
      a,
      { accepts: [{ kind: "item", type: "arm" }] },
      { id: "elbow", at: { vessel: "body", side: "right" } }
    ).body;
    roundTrip(a, b);
  });

  it("deletes an explicitly declared constructor vessel instead of finding an inherited target", () => {
    const a: Body = {
      root: "torso",
      vessels: {
        torso: { ports: { right: { vessel: "constructor", side: "left" } } },
        [CONSTRUCTOR_ID]: { ports: { left: { vessel: "torso", side: "right" } } }
      }
    };
    const b: Body = { root: "torso", vessels: { torso: {} } };

    const patch = roundTrip(a, b);

    expect(patch.patch).toContainEqual({
      op: "deleteVessel",
      vesselId: "constructor",
      vessel: { ports: { left: { vessel: "torso", side: "right" } } },
      collapsed: null
    });
  });

  it("inserts an explicitly declared constructor vessel instead of finding an inherited target", () => {
    const a: Body = { root: "torso", vessels: { torso: {} } };
    const b: Body = {
      root: "torso",
      vessels: {
        torso: { ports: { right: { vessel: "constructor", side: "left" } } },
        [CONSTRUCTOR_ID]: { ports: { left: { vessel: "torso", side: "right" } } }
      }
    };

    const patch = roundTrip(a, b);

    expect(patch.patch).toContainEqual({
      op: "insertVessel",
      vesselId: "constructor",
      vessel: {},
      bridged: null
    });
  });

  it("port rewiring", () => {
    const a = sample();
    let b = disconnect(a, { vessel: "feet", side: "right" }).body;
    b = disconnect(b, { vessel: "missile-left", side: "right" }).body;
    b = connect(b, { vessel: "feet", side: "right" }, { vessel: "missile-right", side: "left" }).body;
    roundTrip(a, b);
  });

  it("contains reordering", () => {
    const a = insertElement(sample(), "left-hand", { kind: "item", type: "tool", id: "whetstone" });
    const b = structuredClone(a);
    b.vessels["left-hand"].contains = [...(b.vessels["left-hand"].contains ?? [])].reverse();
    roundTrip(a, b);
  });

  it("embedded-body element replacement", () => {
    const a = sample();
    const b = sample();
    const pack = (b.vessels.back.contains ?? [])[0];
    pack.body!.vessels["main-pocket"].contains = [];
    pack.body!.vessels["side-pocket"].contains = [
      { kind: "item", type: "tool", id: "flint" },
      { kind: "item", type: "tool", id: "rope" }
    ];
    roundTrip(a, b);
  });

  it("a -> a is the empty diff", () => {
    const patch = expectOk(diffBodies(sample(), sample()));
    expect(patch.patch).toEqual([]);
    expect(expectOk(applyPatch(sample(), patch))).toEqual(canonicalizeBody(SAMPLE_BODY));
  });

  it("accepts changes reify as vessel replacement", () => {
    const a = sample();
    const b = sample();
    b.vessels.face.accepts = [{ kind: "item" }];
    const patch = roundTrip(a, b);
    expect(patch.patch.some((entry) => entry.op === "deleteVessel" && entry.vesselId === "face")).toBe(true);
    expect(patch.patch.some((entry) => entry.op === "insertVessel" && entry.vesselId === "face")).toBe(true);
  });

  it("does not mutate either input", () => {
    const a = sample();
    const b = deleteVessel(sample(), "missile-right").body;
    const aSnapshot = structuredClone(a);
    const bSnapshot = structuredClone(b);
    expectOk(diffBodies(a, b));
    expect(a).toEqual(aSnapshot);
    expect(b).toEqual(bSnapshot);
  });

  it("refuses bodies with different roots, precisely", () => {
    const b = sample();
    b.root = "head";
    const errors = expectErrors(diffBodies(sample(), b));
    expect(errors[0].path).toBe("$.root");
    expect(errors[0].message).toContain('"body"');
    expect(errors[0].message).toContain('"head"');
  });

  it("refuses accepts changes on the root vessel, precisely", () => {
    const b = sample();
    b.vessels.body.accepts = [{ kind: "item" }];
    const errors = expectErrors(diffBodies(sample(), b));
    expect(errors[0].path).toBe("$.vessels.body.accepts");
    expect(errors[0].message).toContain("root");
  });
});

describe("diff containment granularity", () => {
  it("represents one short payload edit in 500 elements with two detached entries", () => {
    const source = containmentBody(
      Array.from({ length: 500 }, (_, index) => ({ kind: "item", id: `item-${index}`, data: { value: "same" } }))
    );
    const target = structuredClone(source);
    mutableContents(target)[250].data = { value: "edit" };
    const sourceBefore = structuredClone(source);
    const targetBefore = structuredClone(target);

    const patch = expectOk(diffBodies(source, target));

    expect(patch.patch).toEqual([
      {
        op: "removeElement",
        vesselId: "root",
        index: 250,
        element: { kind: "item", id: "item-250", data: { value: "same" } }
      },
      {
        op: "insertElement",
        vesselId: "root",
        index: 250,
        element: { kind: "item", id: "item-250", data: { value: "edit" } }
      }
    ]);
    expect(new TextEncoder().encode(JSON.stringify(patch)).byteLength).toBeLessThanOrEqual(512);
    expect(expectOk(applyPatch(source, patch))).toEqual(canonicalizeBody(target));
    invertRoundTrip(source, patch);
    expect(source).toEqual(sourceBefore);
    expect(target).toEqual(targetBefore);

    const patchBeforeInputMutation = structuredClone(patch);
    mutableContents(source)[250].data = { value: "source-mutated" };
    mutableContents(target)[250].data = { value: "target-mutated" };
    expect(patch).toEqual(patchBeforeInputMutation);

    (patch.patch[0] as { element: ContainedElement }).element.data = { value: "patch-mutated" };
    expect(mutableContents(source)[250].data).toEqual({ value: "source-mutated" });
    expect(mutableContents(target)[250].data).toEqual({ value: "target-mutated" });
  });

  it("records a middle insertion at the preserved-prefix index", () => {
    const source = containmentBody([
      { kind: "item", id: "a" },
      { kind: "item", id: "b" },
      { kind: "item", id: "c" },
      { kind: "item", id: "d" }
    ]);
    const target = structuredClone(source);
    mutableContents(target).splice(2, 0, { kind: "item", id: "new" });

    const patch = roundTrip(source, target);

    expect(patch.patch).toEqual([
      { op: "insertElement", vesselId: "root", index: 2, element: { kind: "item", id: "new" } }
    ]);
    invertRoundTrip(source, patch);
  });

  it("records a middle deletion at the preserved-prefix index", () => {
    const source = containmentBody([
      { kind: "item", id: "a" },
      { kind: "item", id: "b" },
      { kind: "item", id: "old" },
      { kind: "item", id: "c" },
      { kind: "item", id: "d" }
    ]);
    const target = structuredClone(source);
    mutableContents(target).splice(2, 1);

    const patch = roundTrip(source, target);

    expect(patch.patch).toEqual([
      { op: "removeElement", vesselId: "root", index: 2, element: { kind: "item", id: "old" } }
    ]);
    invertRoundTrip(source, patch);
  });

  it("removes a reordered middle before reinserting duplicate ids", () => {
    const source = containmentBody([
      { kind: "item", id: "a" },
      { kind: "item", id: "b" },
      { kind: "item", id: "c" }
    ]);
    const target = containmentBody([
      { kind: "item", id: "b" },
      { kind: "item", id: "a" },
      { kind: "item", id: "c" }
    ]);

    const patch = roundTrip(source, target);

    expect(patch.patch.map((entry) => [entry.op, "index" in entry ? entry.index : undefined])).toEqual([
      ["removeElement", 1],
      ["removeElement", 0],
      ["insertElement", 0],
      ["insertElement", 1]
    ]);
    expect(patch.patch.length).toBeLessThanOrEqual(6);
    invertRoundTrip(source, patch);
  });

  it("matches repeated id-less elements by canonical position", () => {
    const repeated: ContainedElement = { kind: "item", data: { value: "repeat" } };
    const source = containmentBody([
      structuredClone(repeated),
      structuredClone(repeated),
      { kind: "item", data: { value: "old" } },
      structuredClone(repeated),
      structuredClone(repeated)
    ]);
    const target = structuredClone(source);
    mutableContents(target)[2] = { kind: "item", data: { value: "new" } };

    const patch = roundTrip(source, target);

    expect(patch.patch.map((entry) => [entry.op, "index" in entry ? entry.index : undefined])).toEqual([
      ["removeElement", 2],
      ["insertElement", 2]
    ]);
    invertRoundTrip(source, patch);
  });

  it("preserves canonically equal nested elements at both edges", () => {
    const nested: ContainedElement = {
      kind: "item",
      body: { root: "inner", vessels: { inner: {} } }
    };
    const source = containmentBody([
      nested,
      { kind: "item", data: { value: "old" } },
      structuredClone(nested)
    ]);
    const target = containmentBody([
      { kind: "item", body: { root: "inner", vessels: { inner: { contains: [] } } } },
      { kind: "item", data: { value: "new" } },
      { kind: "item", body: { root: "inner", vessels: { inner: { ports: {} } } } }
    ]);

    const patch = roundTrip(source, target);

    expect(patch.patch.map((entry) => [entry.op, "index" in entry ? entry.index : undefined])).toEqual([
      ["removeElement", 1],
      ["insertElement", 1]
    ]);
    invertRoundTrip(source, patch);
  });
});

describe("law 2: composition — apply(compose(p, q), a) = apply(q, apply(p, a))", () => {
  it("holds across a three-body chain", () => {
    const a = sample();
    const b = deleteVessel(a, "missile-right").body;
    const c = insertElement(b, "thrown", { kind: "item", type: "thrown", id: "rock" });

    const p = expectOk(diffBodies(a, b));
    const q = expectOk(diffBodies(b, c));

    const sequential = expectOk(applyPatch(expectOk(applyPatch(a, p)), q));
    const composed = expectOk(applyPatch(a, composePatches(p, q)));
    expect(composed).toEqual(sequential);
    expect(composed).toEqual(canonicalizeBody(c));
  });

  it("composition is entry concatenation", () => {
    const p = patchOf({ op: "removeElement", vesselId: "head", index: 0, element: { kind: "item", id: "x" } });
    const q = patchOf({ op: "insertElement", vesselId: "head", element: { kind: "item", id: "x" }, index: 0 });
    const composed = composePatches(p, q);
    expect(composed.patch).toEqual([...p.patch, ...q.patch]);
  });
});

describe("law 3: partial invertibility — apply(invert(p), apply(p, a)) = a", () => {
  it("connect, including displaced-connection restoration", () => {
    invertRoundTrip(
      structuredClone(CHAIN),
      patchOf({
        op: "connect",
        from: { vessel: "a", side: "right" },
        to: { vessel: "c", side: "left" },
        displaced: [{ from: { vessel: "a", side: "right" }, to: { vessel: "b", side: "left" } }]
      })
    );
  });

  it("disconnect", () => {
    invertRoundTrip(
      structuredClone(CHAIN),
      patchOf({
        op: "disconnect",
        endpoint: { vessel: "a", side: "right" },
        removed: { from: { vessel: "a", side: "right" }, to: { vessel: "b", side: "left" } }
      })
    );
  });

  it("insertVessel of a free vessel", () => {
    invertRoundTrip(
      structuredClone(CHAIN),
      patchOf({
        op: "insertVessel",
        vesselId: "d",
        vessel: { accepts: [{ kind: "item" }], contains: [{ kind: "item", id: "pebble" }] },
        bridged: null
      })
    );
  });

  it("insertVessel at an occupied endpoint (bridged)", () => {
    invertRoundTrip(
      structuredClone(CHAIN),
      patchOf({
        op: "insertVessel",
        vesselId: "mid",
        vessel: {},
        at: { vessel: "a", side: "right" },
        bridged: { from: { vessel: "a", side: "right" }, to: { vessel: "b", side: "left" } }
      })
    );
  });

  it("insertVessel at an empty endpoint (unbridged)", () => {
    invertRoundTrip(
      structuredClone(CHAIN),
      patchOf({
        op: "insertVessel",
        vesselId: "far",
        vessel: {},
        at: { vessel: "b", side: "right" },
        bridged: null
      })
    );
  });

  it("deleteVessel of a leaf", () => {
    invertRoundTrip(
      structuredClone(CHAIN),
      patchOf({
        op: "deleteVessel",
        vesselId: "b",
        vessel: { ports: { left: { vessel: "a", side: "right" } } },
        collapsed: null
      })
    );
  });

  it("deleteVessel with collapseOppositeNeighbors", () => {
    invertRoundTrip(
      structuredClone(TRIPLE),
      patchOf({
        op: "deleteVessel",
        vesselId: "x",
        collapseOppositeNeighbors: true,
        vessel: {
          ports: {
            left: { vessel: "a", side: "right" },
            right: { vessel: "b", side: "left" }
          }
        },
        collapsed: { from: { vessel: "a", side: "right" }, to: { vessel: "b", side: "left" } }
      })
    );
  });

  it("insertElement", () => {
    invertRoundTrip(
      sample(),
      patchOf({ op: "insertElement", vesselId: "thrown", element: { kind: "item", type: "thrown", id: "rock" }, index: 0 })
    );
  });

  it("removeElement", () => {
    invertRoundTrip(
      sample(),
      patchOf({ op: "removeElement", vesselId: "head", index: 0, element: { kind: "item", type: "head", id: "salve-hood" } })
    );
  });

  it("moveElement, restoring the original position", () => {
    invertRoundTrip(
      sample(),
      patchOf({
        op: "moveElement",
        from: "left-hand",
        index: 0,
        to: "right-hand",
        element: { kind: "item", type: "weapon", id: "steel-dagger" },
        toIndex: 1
      })
    );
  });

  it("a mixed multi-entry patch", () => {
    invertRoundTrip(
      sample(),
      patchOf(
        { op: "removeElement", vesselId: "head", index: 0, element: { kind: "item", type: "head", id: "salve-hood" } },
        { op: "insertElement", vesselId: "thrown", element: { kind: "item", type: "thrown", id: "rock" }, index: 0 },
        {
          op: "moveElement",
          from: "left-hand",
          index: 0,
          to: "right-hand",
          element: { kind: "item", type: "weapon", id: "steel-dagger" },
          toIndex: 1
        },
        {
          op: "deleteVessel",
          vesselId: "missile-right",
          vessel: {
            accepts: [{ kind: "item", type: "missile" }],
            contains: [{ kind: "item", type: "missile", id: "quiver" }],
            ports: { left: { vessel: "missile-left", side: "right" } }
          },
          collapsed: null
        },
        {
          op: "insertVessel",
          vesselId: "belt",
          vessel: { accepts: [{ kind: "item", type: "belt" }] },
          at: { vessel: "body", side: "right" },
          bridged: { from: { vessel: "body", side: "right" }, to: { vessel: "right-arm", side: "left" } }
        }
      )
    );
  });

  it("inversion round-trips every diffed patch", () => {
    const a = sample();
    const b = insertVessel(
      deleteVessel(a, "missile-right").body,
      { accepts: [{ kind: "item", type: "arm" }] },
      { id: "elbow", at: { vessel: "body", side: "right" } }
    ).body;
    invertRoundTrip(a, expectOk(diffBodies(a, b)));
  });

  it("does not mutate the patch it inverts", () => {
    const patch = patchOf({
      op: "removeElement",
      vesselId: "head",
      index: 0,
      element: { kind: "item", type: "head", id: "salve-hood" }
    });
    const snapshot = structuredClone(patch);
    invertPatch(patch);
    expect(patch).toEqual(snapshot);
  });
});

describe("the severed arm (pre-RFC narrative)", () => {
  it("severs the lower arm — rope and all — and the inversion restores it exactly", () => {
    const severing = patchOf({
      op: "deleteVessel",
      vesselId: "left-lower-arm",
      vessel: {
        accepts: [{ kind: "item", type: "held" }],
        contains: [{ kind: "item", type: "held", id: "rope" }],
        ports: { right: { vessel: "left-upper-arm", side: "left" } }
      },
      collapsed: null
    });

    const severed = expectOk(applyPatch(structuredClone(ALICE_BODY), severing));
    expect(severed.vessels["left-lower-arm"]).toBeUndefined();
    expect(JSON.stringify(severed)).not.toContain("rope"); // the rope went with the arm
    expect(severed.vessels["left-upper-arm"].ports?.left).toBeUndefined();

    const restoration = invertPatch(severing);
    expect(restoration.patch.map((entry) => entry.op)).toEqual(["insertVessel", "connect"]);

    const restored = expectOk(applyPatch(severed, restoration));
    expect(restored).toEqual(canonicalizeBody(ALICE_BODY));
    expect(restored.vessels["left-lower-arm"].contains).toEqual([{ kind: "item", type: "held", id: "rope" }]);
  });

  it("refuses to sever the same arm twice: the second application is an error", () => {
    const severing = patchOf({
      op: "deleteVessel",
      vesselId: "left-lower-arm",
      vessel: {
        accepts: [{ kind: "item", type: "held" }],
        contains: [{ kind: "item", type: "held", id: "rope" }],
        ports: { right: { vessel: "left-upper-arm", side: "left" } }
      },
      collapsed: null
    });
    const severed = expectOk(applyPatch(structuredClone(ALICE_BODY), severing));
    const errors = expectErrors(applyPatch(severed, severing));
    expect(errors[0].message).toContain('"left-lower-arm"');
  });
});
