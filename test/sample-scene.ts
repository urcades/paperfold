import type { Scene } from "paperchain";
import { SAMPLE_BODY } from "./sample-body.js";

// A two-figure scene in paperchain's holding-hands shape: alice wields her
// dagger (an asymmetric relation from her hand vessel to the weapon element),
// and the pair are linked by a symmetric bond. alice's back carries the
// field-pack embedded body, giving nested-path entries something to reach.
export const WIELDING_SCENE: Scene = {
  protocol: "paperchain/v1",
  bodies: {
    alice: structuredClone(SAMPLE_BODY),
    bob: structuredClone(SAMPLE_BODY)
  },
  kinds: {
    wields: { fromMax: 1, toMax: 1 },
    "holding-hands": { symmetric: true, irreflexive: true, fromMax: 1 }
  },
  relations: [
    { kind: "wields", from: "alice/left-hand", to: "alice/left-hand/steel-dagger" },
    { kind: "holding-hands", from: "alice/right-hand", to: "bob/left-hand" }
  ]
};

export function sampleScene(): Scene {
  return structuredClone(WIELDING_SCENE);
}
