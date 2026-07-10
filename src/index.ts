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

export { formatProtocolErrors } from "paperdoll";

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
