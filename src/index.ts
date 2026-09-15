export {
  PAPERFOLD_PROTOCOL,
  applyPatch,
  assertPatch,
  canonicalizeBody,
  composePatches,
  diffBodies,
  invertPatch,
  parsePatch,
  validatePatch
} from "./paperfold.js";

export type {
  ConnectEntry,
  DeleteVesselEntry,
  DisconnectEntry,
  InsertElementEntry,
  InsertVesselEntry,
  MoveElementEntry,
  PaperfoldDocument,
  PatchEntry,
  RemoveElementEntry,
  VesselShape
} from "./paperfold.js";

export {
  PAPERFOLD_SCENE_PROTOCOL,
  applyScenePatch,
  assertScenePatch,
  canonicalizeScene,
  composeScenePatches,
  diffScenes,
  invertScenePatch,
  parseScenePatch,
  validateScenePatch
} from "./scenes.js";

export type {
  AddRelationEntry,
  DeclareKindEntry,
  DeleteBodyEntry,
  DeleteKindEntry,
  InsertBodyEntry,
  RemoveRelationEntry,
  SceneEntry,
  SceneKernelEntry,
  ScenePatchDocument,
  ScenePatchEntry
} from "./scenes.js";

export type { BodyName, KindDeclaration, KindId, Relation, Scene, SceneAddress } from "paperchain";

export { MAX_PORTABLE_INTEGER, formatProtocolErrors, validatePortableJson } from "paperdoll";

export type {
  Body,
  Connection,
  ContainedElement,
  Endpoint,
  ProtocolError,
  Result,
  Side,
  Vessel,
  VesselId
} from "paperdoll";
