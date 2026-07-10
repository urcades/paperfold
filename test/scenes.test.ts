import { describe, expect, it } from "vitest";
import { validateScene } from "paperchain";
import type { Scene } from "paperchain";
import {
  applyScenePatch,
  assertScenePatch,
  canonicalizeScene,
  composeScenePatches,
  diffScenes,
  invertScenePatch,
  parseScenePatch,
  validateScenePatch,
  PAPERFOLD_SCENE_PROTOCOL,
  type ScenePatchDocument,
  type ScenePatchEntry
} from "../src/index.js";
import { sampleScene } from "./sample-scene.js";

function patchOf(...entries: ScenePatchEntry[]): ScenePatchDocument {
  return { protocol: PAPERFOLD_SCENE_PROTOCOL, patch: entries };
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; errors: unknown }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.value;
}

function expectErrors<T>(result: { ok: true; value: T } | { ok: false; errors: { path: string; message: string }[] }) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

/** Law 1 over scenes: applying the diff of a→b onto a yields exactly canonical b. */
function sceneRoundTrip(a: Scene, b: Scene): ScenePatchDocument {
  const patch = expectOk(diffScenes(a, b));
  const applied = expectOk(applyScenePatch(a, patch));
  expect(applied).toEqual(canonicalizeScene(b));
  return patch;
}

/** Law 3 over scenes: a patch that applied can be backed out body-free. */
function invertSceneRoundTrip(a: Scene, patch: ScenePatchDocument): void {
  const forward = expectOk(applyScenePatch(a, patch));
  const back = expectOk(applyScenePatch(forward, invertScenePatch(patch)));
  expect(back).toEqual(canonicalizeScene(a));
}

describe("validateScenePatch", () => {
  it("accepts every entry shape", () => {
    const scene = sampleScene();
    const document = patchOf(
      { op: "declareKind", kindId: "guards", declaration: { fromMax: 2 } },
      { op: "deleteKind", kindId: "wields", declaration: { fromMax: 1, toMax: 1 } },
      { op: "insertBody", name: "carol", body: structuredClone(scene.bodies.alice) },
      { op: "deleteBody", name: "bob", body: structuredClone(scene.bodies.bob) },
      { op: "addRelation", relation: { kind: "wields", from: "bob/right-hand", to: "bob/right-hand/torch" } },
      { op: "removeRelation", relation: { kind: "holding-hands", from: "alice/right-hand", to: "bob/left-hand" } },
      { op: "insertElement", body: "alice", vesselId: "head", element: { kind: "item", type: "head", id: "hat" }, index: 1 },
      {
        op: "removeElement",
        body: "alice",
        path: "back/field-pack",
        vesselId: "main-pocket",
        index: 0,
        element: { kind: "item", type: "tool", id: "rope" }
      }
    );
    expect(validateScenePatch(document)).toEqual([]);
  });

  it("rejects the v1 protocol string", () => {
    const errors = validateScenePatch({ protocol: "paperfold/v1", patch: [] });
    expect(errors).toEqual([{ path: "$.protocol", message: `Expected "${PAPERFOLD_SCENE_PROTOCOL}".` }]);
  });

  it("rejects unknown ops naming both vocabularies", () => {
    const errors = validateScenePatch(patchOf({ op: "teleport" } as never));
    expect(errors[0].path).toBe("$.patch.0.op");
    expect(errors[0].message).toContain("removeRelation");
  });

  it("rejects kernel entries without a body target", () => {
    const errors = validateScenePatch(
      patchOf({ op: "insertElement", vesselId: "head", element: { kind: "item" }, index: 0 } as never)
    );
    expect(errors.some((error) => error.path === "$.patch.0.body")).toBe(true);
  });

  it("rejects odd-segment and malformed paths", () => {
    const entry = {
      op: "insertElement",
      body: "alice",
      vesselId: "main-pocket",
      element: { kind: "item" },
      index: 0
    };
    const odd = validateScenePatch(patchOf({ ...entry, path: "back" } as never));
    expect(odd.some((error) => error.path === "$.patch.0.path" && error.message.includes("even number"))).toBe(true);
    const malformed = validateScenePatch(patchOf({ ...entry, path: "Back/Pack" } as never));
    expect(malformed.some((error) => error.path === "$.patch.0.path")).toBe(true);
  });

  it("rejects symmetric kinds declaring toMax, and bad relations", () => {
    const errors = validateScenePatch(
      patchOf(
        { op: "declareKind", kindId: "bond", declaration: { symmetric: true, toMax: 1 } },
        { op: "addRelation", relation: { kind: "bond", from: "alice", to: "bob/left-hand" } }
      )
    );
    expect(errors.some((error) => error.path === "$.patch.0.declaration.toMax")).toBe(true);
    // bare body name is not a lawful endpoint
    expect(errors.some((error) => error.path === "$.patch.1.relation.from")).toBe(true);
  });

  it("rejects invalid body records with re-rooted paths", () => {
    const errors = validateScenePatch(
      patchOf({ op: "insertBody", name: "carol", body: { root: "torso", vessels: {} } })
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].path.startsWith("$.patch.0.body")).toBe(true);
  });

  it("parseScenePatch returns a deep copy", () => {
    const document = patchOf({ op: "declareKind", kindId: "guards", declaration: {} });
    const parsed = expectOk(parseScenePatch(document));
    expect(parsed).toEqual(document);
    parsed.patch.pop();
    expect(document.patch).toHaveLength(1);
  });
});

describe("applyScenePatch", () => {
  it("does not mutate its inputs", () => {
    const scene = sampleScene();
    const snapshot = structuredClone(scene);
    const document = patchOf({ op: "declareKind", kindId: "guards", declaration: {} });
    expectOk(applyScenePatch(scene, document));
    expect(scene).toEqual(snapshot);
  });

  it("applies kernel entries inside a named body", () => {
    const scene = sampleScene();
    const applied = expectOk(
      applyScenePatch(
        scene,
        patchOf({
          op: "insertElement",
          body: "bob",
          vesselId: "head",
          element: { kind: "item", type: "head", id: "crown" },
          index: 1
        })
      )
    );
    expect(applied.bodies.bob.vessels.head.contains).toHaveLength(2);
    expect(applied.bodies.alice.vessels.head.contains).toHaveLength(1);
  });

  it("applies kernel entries through a nested-body path and re-embeds", () => {
    const scene = sampleScene();
    const applied = expectOk(
      applyScenePatch(
        scene,
        patchOf({
          op: "insertElement",
          body: "alice",
          path: "back/field-pack",
          vesselId: "side-pocket",
          element: { kind: "item", type: "tool", id: "whetstone" },
          index: 1
        })
      )
    );
    const pack = applied.bodies.alice.vessels.back.contains!.find((element) => element.id === "field-pack")!;
    expect(pack.body!.vessels["side-pocket"].contains!.map((element) => element.id)).toEqual(["flint", "whetstone"]);
    // Siblings of the path survive re-embedding untouched.
    expect(applied.bodies.alice.vessels["left-hand"].contains![0].id).toBe("steel-dagger");
  });

  it("reports a stale path at the deepest failing prefix", () => {
    const scene = sampleScene();
    const errors = expectErrors(
      applyScenePatch(
        scene,
        patchOf({
          op: "insertElement",
          body: "alice",
          path: "back/lost-pack",
          vesselId: "main-pocket",
          element: { kind: "item" },
          index: 0
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.path");
    expect(errors[0].message).toContain('back/lost-pack');
  });

  it("reports a missing scene body as stale", () => {
    const errors = expectErrors(
      applyScenePatch(
        sampleScene(),
        patchOf({ op: "insertElement", body: "carol", vesselId: "head", element: { kind: "item" }, index: 0 })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.body");
    expect(errors[0].message).toContain("stale patch");
  });

  it("converts paperchain throws into path-annotated errors", () => {
    const errors = expectErrors(
      applyScenePatch(sampleScene(), patchOf({ op: "deleteKind", kindId: "wields", declaration: { fromMax: 1, toMax: 1 } }))
    );
    expect(errors[0].path).toBe("$.patch.0");
    expect(errors[0].message).toContain("wields");
  });

  it("rejects a stale deleteKind declaration record", () => {
    const scene = sampleScene();
    const document = patchOf(
      { op: "removeRelation", relation: { kind: "wields", from: "alice/left-hand", to: "alice/left-hand/steel-dagger" } },
      { op: "deleteKind", kindId: "wields", declaration: { fromMax: 7 } }
    );
    const errors = expectErrors(applyScenePatch(scene, document));
    expect(errors[0].path).toBe("$.patch.1.declaration");
    expect(errors[0].message).toContain("stale patch");
  });

  it("rejects a stale deleteBody record", () => {
    const scene = sampleScene();
    const wrongBody = structuredClone(scene.bodies.bob);
    wrongBody.vessels.head.contains = [];
    const document = patchOf(
      { op: "removeRelation", relation: { kind: "holding-hands", from: "alice/right-hand", to: "bob/left-hand" } },
      { op: "deleteBody", name: "bob", body: wrongBody }
    );
    const errors = expectErrors(applyScenePatch(scene, document));
    expect(errors[0].path).toBe("$.patch.1.body");
    expect(errors[0].message).toContain("stale patch");
  });

  it("rejects a removeRelation record in swapped orientation for a symmetric kind", () => {
    const scene = sampleScene();
    // Stored as alice/right-hand -> bob/left-hand; the swapped record still
    // names the same symmetric relation, but not the stored orientation.
    const errors = expectErrors(
      applyScenePatch(
        scene,
        patchOf({
          op: "removeRelation",
          relation: { kind: "holding-hands", from: "bob/left-hand", to: "alice/right-hand" }
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.relation");
    expect(errors[0].message).toContain("stored relation");
  });

  it("propagates kernel staleness inside a named body", () => {
    const scene = sampleScene();
    const errors = expectErrors(
      applyScenePatch(
        scene,
        patchOf({
          op: "removeElement",
          body: "alice",
          vesselId: "head",
          index: 0,
          element: { kind: "item", type: "head", id: "different-hood" }
        })
      )
    );
    expect(errors[0].path).toBe("$.patch.0.element");
    expect(errors[0].message).toContain("stale patch");
  });

  it("the rope drops as part of the severing: orphaning body entries need their removeRelation", () => {
    const scene = sampleScene();
    const severDagger: ScenePatchEntry = {
      op: "removeElement",
      body: "alice",
      vesselId: "left-hand",
      index: 0,
      element: { kind: "item", type: "weapon", id: "steel-dagger" }
    };

    // Without the cleanup, the final validateScene rejects on law 4.
    const bare = expectErrors(applyScenePatch(scene, patchOf(severDagger)));
    expect(bare.some((error) => error.path.includes("relations"))).toBe(true);

    // With the removeRelation in the same transaction, the patch applies…
    const document = patchOf(
      { op: "removeRelation", relation: { kind: "wields", from: "alice/left-hand", to: "alice/left-hand/steel-dagger" } },
      severDagger
    );
    const applied = expectOk(applyScenePatch(scene, document));
    expect(applied.relations).toHaveLength(1);
    expect(validateScene(applied)).toEqual([]);

    // …and its inverse restores the original scene exactly.
    invertSceneRoundTrip(scene, document);
  });
});

describe("invertScenePatch (law 3)", () => {
  it("inverts each scene entry shape", () => {
    const scene = sampleScene();
    invertSceneRoundTrip(scene, patchOf({ op: "declareKind", kindId: "guards", declaration: { symmetric: true } }));
    invertSceneRoundTrip(scene, patchOf({ op: "insertBody", name: "carol", body: structuredClone(scene.bodies.alice) }));
    invertSceneRoundTrip(
      scene,
      patchOf({ op: "addRelation", relation: { kind: "wields", from: "bob/right-hand", to: "bob/right-hand/torch" } })
    );
    invertSceneRoundTrip(
      scene,
      patchOf(
        { op: "removeRelation", relation: { kind: "holding-hands", from: "alice/right-hand", to: "bob/left-hand" } },
        { op: "removeRelation", relation: { kind: "wields", from: "alice/left-hand", to: "alice/left-hand/steel-dagger" } },
        { op: "deleteKind", kindId: "wields", declaration: { fromMax: 1, toMax: 1 } },
        { op: "deleteBody", name: "bob", body: structuredClone(scene.bodies.bob) }
      )
    );
  });

  it("inverts kernel entries inside bodies and through paths", () => {
    const scene = sampleScene();
    invertSceneRoundTrip(
      scene,
      patchOf(
        {
          op: "insertElement",
          body: "bob",
          vesselId: "head",
          element: { kind: "item", type: "head", id: "crown" },
          index: 1
        },
        {
          op: "removeElement",
          body: "alice",
          path: "back/field-pack",
          vesselId: "side-pocket",
          index: 0,
          element: { kind: "item", type: "tool", id: "flint" }
        }
      )
    );
  });

  it("stamps body and path onto multi-entry kernel inverses", () => {
    const document = patchOf({
      op: "moveElement",
      body: "alice",
      path: "back/field-pack",
      from: "main-pocket",
      index: 0,
      to: "side-pocket",
      element: { kind: "item", type: "tool", id: "rope" },
      toIndex: 1
    });
    const inverse = invertScenePatch(document);
    expect(inverse.patch).toHaveLength(2);
    for (const entry of inverse.patch) {
      expect((entry as { body: string }).body).toBe("alice");
      expect((entry as { path: string }).path).toBe("back/field-pack");
    }
  });
});

describe("composeScenePatches (law 2)", () => {
  it("concatenates and applying equals applying in sequence", () => {
    const scene = sampleScene();
    const first = patchOf({ op: "declareKind", kindId: "guards", declaration: {} });
    const second = patchOf({
      op: "addRelation",
      relation: { kind: "guards", from: "bob/right-hand", to: "alice/head" }
    });
    const sequential = expectOk(applyScenePatch(expectOk(applyScenePatch(scene, first)), second));
    const composed = expectOk(applyScenePatch(scene, composeScenePatches(first, second)));
    expect(composed).toEqual(sequential);
  });
});

describe("diffScenes (law 1)", () => {
  it("diffs the identity to an empty patch", () => {
    const scene = sampleScene();
    const patch = expectOk(diffScenes(scene, structuredClone(scene)));
    expect(patch.patch).toEqual([]);
  });

  it("round-trips relation churn", () => {
    const a = sampleScene();
    const b = sampleScene();
    b.relations = [
      { kind: "wields", from: "bob/right-hand", to: "bob/right-hand/torch" },
      { kind: "holding-hands", from: "alice/right-hand", to: "bob/left-hand" }
    ];
    sceneRoundTrip(a, b);
  });

  it("round-trips body addition and removal with their relations", () => {
    const a = sampleScene();
    const b = sampleScene();
    delete b.bodies.bob;
    b.relations = b.relations.filter((relation) => !relation.from.startsWith("bob/") && !relation.to.startsWith("bob/"));
    b.bodies.carol = structuredClone(a.bodies.bob);
    const patch = sceneRoundTrip(a, b);
    expect(patch.patch.some((entry) => entry.op === "deleteBody")).toBe(true);
    expect(patch.patch.some((entry) => entry.op === "insertBody")).toBe(true);
    // The dangling holding-hands relation was removed before bob was deleted.
    expect(patch.patch[0].op).toBe("removeRelation");
  });

  it("reifies a kind re-declaration as delete + declare, cycling surviving relations", () => {
    const a = sampleScene();
    const b = sampleScene();
    // Flip holding-hands to asymmetric with a budget; its relation survives textually.
    b.kinds["holding-hands"] = { irreflexive: true, fromMax: 2 };
    const patch = sceneRoundTrip(a, b);
    const ops = patch.patch.map((entry) => entry.op);
    expect(ops).toContain("deleteKind");
    expect(ops).toContain("declareKind");
    // The textually-identical relation is removed and re-added around the re-declaration.
    expect(ops.filter((op) => op === "removeRelation")).toHaveLength(1);
    expect(ops.filter((op) => op === "addRelation")).toHaveLength(1);
  });

  it("round-trips kept-body structural edits alongside scene churn", () => {
    const a = sampleScene();
    const b = sampleScene();
    // Structural edit in a kept body: bob loses his hands-worn vessel.
    delete b.bodies.bob.vessels["hands-worn"];
    delete b.bodies.bob.vessels["left-hand"].ports!.left;
    // Scene churn on top.
    b.kinds.guards = { fromMax: 1 };
    b.relations.push({ kind: "guards", from: "bob/right-hand", to: "alice/head" });
    const patch = sceneRoundTrip(a, b);
    expect(patch.patch.some((entry) => entry.op === "deleteVessel" && (entry as { body?: string }).body === "bob")).toBe(
      true
    );
    invertSceneRoundTrip(a, patch);
  });

  it("re-roots kept-body diff errors under the body name", () => {
    const a = sampleScene();
    const b = sampleScene();
    b.bodies.bob = { ...structuredClone(b.bodies.bob), root: "head" };
    const errors = expectErrors(diffScenes(a, b));
    expect(errors[0].path.startsWith("$.bodies.bob")).toBe(true);
  });

  it("the marquee: diffing a severed wield emits cleanup in the same patch", () => {
    const a = sampleScene();
    const b = sampleScene();
    // In b, alice no longer holds the dagger and the wields relation is gone.
    b.bodies.alice.vessels["left-hand"].contains = [];
    b.relations = b.relations.filter((relation) => relation.kind !== "wields");
    const patch = sceneRoundTrip(a, b);
    const ops = patch.patch.map((entry) => entry.op);
    expect(ops[0]).toBe("removeRelation");
    expect(ops).toContain("removeElement");
    invertSceneRoundTrip(a, patch);
  });
});
