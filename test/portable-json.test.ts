import { describe, expect, it } from "vitest";

import {
  PAPERFOLD_PROTOCOL,
  PAPERFOLD_SCENE_PROTOCOL,
  validatePatch,
  validatePortableJson,
  validateScenePatch,
  type PaperfoldDocument,
  type ScenePatchDocument
} from "../src/index";

describe("paper-json-portable/v1 through paperfold", () => {
  it("rejects unsafe patch indices without changing v1 dialect validity", () => {
    const patch: PaperfoldDocument = {
      protocol: PAPERFOLD_PROTOCOL,
      patch: [
        {
          op: "moveElement",
          from: "source",
          index: 9_007_199_254_740_992,
          to: "target",
          element: { kind: "item", data: { count: 9_007_199_254_740_992 } },
          toIndex: 9_007_199_254_740_991
        }
      ]
    };

    expect(validatePatch(patch)).toEqual([]);
    expect(validatePortableJson(patch).map((error) => error.path)).toEqual([
      "$.patch.0.index",
      "$.patch.0.element.data.count"
    ]);
  });

  it("rejects unsafe scene-patch declaration budgets without changing v2 validity", () => {
    const patch: ScenePatchDocument = {
      protocol: PAPERFOLD_SCENE_PROTOCOL,
      patch: [
        {
          op: "declareKind",
          kindId: "linked",
          declaration: { fromMax: 9_007_199_254_740_992 }
        }
      ]
    };

    expect(validateScenePatch(patch)).toEqual([]);
    expect(validatePortableJson(patch).map((error) => error.path)).toEqual([
      "$.patch.0.declaration.fromMax"
    ]);
  });
});
