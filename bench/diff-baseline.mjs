import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { insertElement, removeElement } from "paperdoll";
import { applyPatch, canonicalizeBody, diffBodies, invertPatch } from "../dist/index.js";

const WARMUP_ITERATIONS = 10;
const SAMPLE_COUNT = 21;
const CASES = [
  { elements: 10, iterationsPerSample: 10 },
  { elements: 100, iterationsPerSample: 5 },
  { elements: 500, iterationsPerSample: 2 }
];

function unwrap(result) {
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.value;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function fixture(elements) {
  const source = {
    root: "root",
    vessels: {
      root: {
        contains: Array.from({ length: elements }, (_, index) => ({
          kind: "item",
          id: `item-${index}`,
          data: { value: "same" }
        }))
      }
    }
  };
  const target = structuredClone(source);
  target.vessels.root.contains[Math.floor(elements / 2)].data.value = "edit";
  return { source, target };
}

function timeCase(source, target, iterationsPerSample) {
  const run = () => {
    const diffStarted = performance.now();
    const patch = unwrap(diffBodies(source, target));
    const diffMs = performance.now() - diffStarted;

    const applyStarted = performance.now();
    const applied = unwrap(applyPatch(source, patch));
    const applyMs = performance.now() - applyStarted;
    return { patch, applied, diffMs, applyMs };
  };

  for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) run();

  const diffSamplesMs = [];
  const applySamplesMs = [];
  let last;
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    let diffTotalMs = 0;
    let applyTotalMs = 0;
    for (let iteration = 0; iteration < iterationsPerSample; iteration += 1) {
      last = run();
      diffTotalMs += last.diffMs;
      applyTotalMs += last.applyMs;
    }
    diffSamplesMs.push(diffTotalMs / iterationsPerSample);
    applySamplesMs.push(applyTotalMs / iterationsPerSample);
  }

  return { last, diffSamplesMs, applySamplesMs };
}

// Paperdoll 0.8.3 deep-clones the complete input body once per containment
// operation. Replay the patch to count those calls and sum serialized
// input-body bytes as a copy-work proxy at each clone boundary. This is not a
// heap-allocation measurement, and it deliberately excludes
// Paperfold canonicalization and small structuredClone calls for patch records.
function measureContainmentKernelClones(source, patch) {
  let current = structuredClone(source);
  let calls = 0;
  let inputBytes = 0;

  for (const entry of patch.patch) {
    if (entry.op !== "removeElement" && entry.op !== "insertElement") continue;
    calls += 1;
    inputBytes += Buffer.byteLength(JSON.stringify(current));
    if (entry.op === "removeElement") {
      current = removeElement(current, entry.vesselId, entry.index).body;
    } else {
      current = insertElement(current, entry.vesselId, entry.element, entry.index);
    }
  }

  return { calls, inputBytes };
}

async function main() {
  const cases = [];
  for (const { elements, iterationsPerSample } of CASES) {
    const { source, target } = fixture(elements);
    const sourceBefore = structuredClone(source);
    const targetBefore = structuredClone(target);
    const { last, diffSamplesMs, applySamplesMs } = timeCase(source, target, iterationsPerSample);
    const patch = last.patch;

    assert.deepEqual(last.applied, canonicalizeBody(target));
    const restored = unwrap(applyPatch(last.applied, invertPatch(patch)));
    assert.deepEqual(restored, canonicalizeBody(source));
    assert.deepEqual(source, sourceBefore);
    assert.deepEqual(target, targetBefore);

    const cloneWork = measureContainmentKernelClones(source, patch);
    cases.push({
      elements,
      changed: 1,
      iterationsPerSample,
      medianDiffMs: median(diffSamplesMs),
      medianApplyMs: median(applySamplesMs),
      entries: patch.patch.length,
      bytes: Buffer.byteLength(JSON.stringify(patch)),
      sound: true,
      inverseSound: true,
      inputsUnchanged: true,
      cloneMeasurement: {
        scope: "paperdoll containment kernel full-body clone calls and serialized input-byte copy-work proxy during diff; apply repeats equivalent work for this fixture; not a heap-allocation measurement",
        diffBodyCloneCalls: cloneWork.calls,
        diffBodyCloneInputBytes: cloneWork.inputBytes,
        applyBodyCloneCalls: cloneWork.calls,
        applyBodyCloneInputBytes: cloneWork.inputBytes
      }
    });
  }

  const report = {
    schema: "paperfold-diff-benchmark/v1",
    measuredAt: new Date().toISOString(),
    node: process.version,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    platform: process.platform,
    arch: process.arch,
    warmupIterations: WARMUP_ITERATIONS,
    sampleCount: SAMPLE_COUNT,
    statistic: "median per-operation wall time across samples after warmup",
    cases
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json.trimEnd());
  const outputFlag = process.argv.indexOf("--output");
  if (outputFlag !== -1) {
    const output = process.argv[outputFlag + 1];
    assert.ok(output, "--output requires a path");
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const outputPath = resolve(repositoryRoot, output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json);
  }
}

await main();
