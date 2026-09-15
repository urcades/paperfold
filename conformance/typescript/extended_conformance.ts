import {
  applyPatch,
  applyScenePatch,
  canonicalizeBody,
  canonicalizeScene,
  composePatches,
  composeScenePatches,
  diffBodies,
  diffScenes,
  invertPatch,
  invertScenePatch,
  validatePatch,
  validateScenePatch,
  type Body,
  type PaperfoldDocument,
  type Scene,
  type ScenePatchDocument
} from "../../src/index";
import {
  projectResult,
  projectValidation,
  projectValue,
  type CaseDispatcher,
  type InvalidProjection,
  type OkProjection
} from "paperchain/conformance/v2";

export const dispatchPaperfoldCase: CaseDispatcher = (testCase) => {
  const args = testCase.input.args;
  switch (testCase.operation) {
    case "validatePatch":
      return projectValidation(validatePatch(args[0]));
    case "applyPatch":
      return projectResult(applyPatch(args[0] as Body, args[1] as PaperfoldDocument));
    case "invertPatch":
      return projectValue(invertPatch(args[0] as PaperfoldDocument));
    case "composePatches":
      return projectValue(composePatches(args[0] as PaperfoldDocument, args[1] as PaperfoldDocument));
    case "diffLaws":
      return bodyDiffLaws(args[0] as Body, args[1] as Body);
    case "validateScenePatch":
      return projectValidation(validateScenePatch(args[0]));
    case "applyScenePatch":
      return projectResult(applyScenePatch(args[0] as Scene, args[1] as ScenePatchDocument));
    case "invertScenePatch":
      return projectValue(invertScenePatch(args[0] as ScenePatchDocument));
    case "composeScenePatches":
      return projectValue(composeScenePatches(args[0] as ScenePatchDocument, args[1] as ScenePatchDocument));
    case "diffSceneLaws":
      return sceneDiffLaws(args[0] as Scene, args[1] as Scene);
    default:
      throw new Error(`Unsupported paperfold operation ${testCase.operation}`);
  }
};

function bodyDiffLaws(source: Body, target: Body): OkProjection | InvalidProjection {
  const difference = diffBodies(source, target);
  if (!difference.ok) return projectResult(difference);
  const applied = applyPatch(source, difference.value);
  if (!applied.ok) return projectResult(applied);
  const inverse = invertPatch(difference.value);
  const restored = applyPatch(applied.value, inverse);
  if (!restored.ok) return projectResult(restored);
  const composed = applyPatch(source, composePatches(difference.value, inverse));
  if (!composed.ok) return projectResult(composed);

  const canonicalTarget = canonicalizeBody(target);
  const canonicalSource = canonicalizeBody(source);
  if (!jsonEqual(applied.value, canonicalTarget) || !jsonEqual(restored.value, canonicalSource) || !jsonEqual(composed.value, canonicalSource)) {
    throw new Error("paperfold/v1 diff laws failed");
  }
  return projectValue({ applied: applied.value, restored: restored.value });
}

function sceneDiffLaws(source: Scene, target: Scene): OkProjection | InvalidProjection {
  const difference = diffScenes(source, target);
  if (!difference.ok) return projectResult(difference);
  const applied = applyScenePatch(source, difference.value);
  if (!applied.ok) return projectResult(applied);
  const inverse = invertScenePatch(difference.value);
  const restored = applyScenePatch(applied.value, inverse);
  if (!restored.ok) return projectResult(restored);
  const composed = applyScenePatch(source, composeScenePatches(difference.value, inverse));
  if (!composed.ok) return projectResult(composed);

  const canonicalTarget = canonicalizeScene(target);
  const canonicalSource = canonicalizeScene(source);
  if (!jsonEqual(applied.value, canonicalTarget) || !jsonEqual(restored.value, canonicalSource) || !jsonEqual(composed.value, canonicalSource)) {
    throw new Error("paperfold/v2 diff laws failed");
  }
  return projectValue({ applied: applied.value, restored: restored.value });
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") return left === right;
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((v, i) => jsonEqual(v, right[i]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return jsonEqual(aKeys, bKeys) && aKeys.every((key) => jsonEqual(a[key], b[key]));
}
