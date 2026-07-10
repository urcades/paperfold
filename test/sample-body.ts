import type { Body } from "paperdoll";

// The kernel's sample figure: a rooted body with an embedded body (the
// field-pack), free vessels, and a missile chain hanging off the feet.
// Already in canonical form (no empty ports or contains).
export const SAMPLE_BODY: Body = {
  root: "body",
  vessels: {
    face: {
      accepts: [{ kind: "item", type: "face" }],
      contains: [{ kind: "item", type: "face", id: "goggles" }],
      ports: { bottom: { vessel: "head", side: "top" } }
    },
    head: {
      accepts: [{ kind: "item", type: "head" }],
      contains: [{ kind: "item", type: "head", id: "salve-hood" }],
      ports: {
        top: { vessel: "face", side: "bottom" },
        bottom: { vessel: "body", side: "top" }
      }
    },
    "hands-worn": {
      accepts: [{ kind: "item", type: "hands" }],
      ports: { right: { vessel: "left-hand", side: "left" } }
    },
    "left-hand": {
      accepts: [{ kind: "item", type: "weapon" }, { kind: "item", type: "tool" }],
      contains: [{ kind: "item", type: "weapon", id: "steel-dagger" }],
      ports: {
        left: { vessel: "hands-worn", side: "right" },
        right: { vessel: "left-arm", side: "left" }
      }
    },
    "left-arm": {
      accepts: [{ kind: "item", type: "arm" }],
      ports: {
        left: { vessel: "left-hand", side: "right" },
        right: { vessel: "body", side: "left" }
      }
    },
    body: {
      accepts: [{ kind: "item", type: "body" }],
      contains: [{ kind: "item", type: "body", id: "wet-recycling-suit" }],
      ports: {
        top: { vessel: "head", side: "bottom" },
        left: { vessel: "left-arm", side: "right" },
        right: { vessel: "right-arm", side: "left" },
        bottom: { vessel: "back", side: "top" }
      }
    },
    "right-arm": {
      accepts: [{ kind: "item", type: "arm" }],
      ports: {
        left: { vessel: "body", side: "right" },
        right: { vessel: "right-hand", side: "left" }
      }
    },
    "right-hand": {
      accepts: [{ kind: "item", type: "weapon" }, { kind: "item", type: "tool" }],
      contains: [{ kind: "item", type: "tool", id: "torch" }],
      ports: { left: { vessel: "right-arm", side: "right" } }
    },
    back: {
      accepts: [{ kind: "item", type: "back" }],
      contains: [
        {
          kind: "item",
          type: "back",
          id: "field-pack",
          body: {
            root: "main-pocket",
            vessels: {
              "main-pocket": {
                accepts: [{ kind: "item" }],
                contains: [{ kind: "item", type: "tool", id: "rope" }],
                ports: { bottom: { vessel: "side-pocket", side: "top" } }
              },
              "side-pocket": {
                contains: [{ kind: "item", type: "tool", id: "flint" }],
                ports: { top: { vessel: "main-pocket", side: "bottom" } }
              }
            }
          }
        }
      ],
      ports: {
        top: { vessel: "body", side: "bottom" },
        bottom: { vessel: "feet", side: "top" }
      }
    },
    feet: {
      accepts: [{ kind: "item", type: "feet" }],
      contains: [{ kind: "item", type: "feet", id: "leather-moccasins" }],
      ports: {
        top: { vessel: "back", side: "bottom" },
        right: { vessel: "missile-left", side: "left" }
      }
    },
    "missile-left": {
      accepts: [{ kind: "item", type: "missile" }],
      contains: [{ kind: "item", type: "missile", id: "short-bow" }],
      ports: {
        left: { vessel: "feet", side: "right" },
        right: { vessel: "missile-right", side: "left" }
      }
    },
    "missile-right": {
      accepts: [{ kind: "item", type: "missile" }],
      contains: [{ kind: "item", type: "missile", id: "quiver" }],
      ports: { left: { vessel: "missile-left", side: "right" } }
    },
    floating: {
      accepts: [{ kind: "item", type: "floating" }],
      contains: [{ kind: "item", type: "floating", id: "glowsphere" }]
    },
    thrown: {
      accepts: [{ kind: "item", type: "thrown" }]
    }
  }
};

// The pre-RFC's severed-arm scene: alice's left lower arm holds a rope; the
// severing is a single deleteVessel transaction, and its inversion restores
// the arm, rope and all.
export const ALICE_BODY: Body = {
  root: "torso",
  vessels: {
    torso: {
      accepts: [{ kind: "item", type: "body" }],
      ports: { left: { vessel: "left-upper-arm", side: "right" } }
    },
    "left-upper-arm": {
      accepts: [{ kind: "item", type: "arm" }],
      ports: {
        right: { vessel: "torso", side: "left" },
        left: { vessel: "left-lower-arm", side: "right" }
      }
    },
    "left-lower-arm": {
      accepts: [{ kind: "item", type: "held" }],
      contains: [{ kind: "item", type: "held", id: "rope" }],
      ports: { right: { vessel: "left-upper-arm", side: "left" } }
    }
  }
};
