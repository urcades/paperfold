// Seeded interoperability checks: neither implementation is the golden oracle.
// Each generated patch must reach the independently specified target in both
// runtimes, and each inverse must restore the source. Run after `npm run build`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fold from '../dist/index.js';

let seed = 0x50415045;
const random = max => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) % max;
};
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result.errors)); return result.value; };
const clone = value => structuredClone(value);
const bare = () => ({ root: 'root', vessels: { root: {} } });
const pairs = [];
for (let sample = 0; sample < 100; sample++) {
  const contains = Array.from({ length: random(12) }, (_, i) => ({
    kind: 'item', id: `item-${i}`, data: { hp: random(100), enabled: !!random(2), labels: ['kept', `v-${random(4)}`] },
    ...(random(4) === 0 ? { body: { root: 'inner', vessels: { inner: { contains: [], ports: {} } } } } : {})
  }));
  const a = { root: 'root', vessels: { root: { contains, ports: {} }, free: {} } };
  const b = clone(a), desired = b.vessels.root.contains;
  for (let edit = 0, count = 1 + random(6); edit < count; edit++) {
    const position = random(desired.length + 1);
    switch (random(5)) {
      case 0: if (desired.length) desired.splice(position % desired.length, 1); break;
      case 1: desired.splice(position, 0, { kind: 'item', id: `new-${sample}-${edit}`, data: { hp: random(100) } }); break;
      case 2: if (desired.length) desired[position % desired.length].data.hp = random(100); break;
      case 3: desired.reverse(); break;
      case 4: if (desired.length > 1) desired.push(desired.shift()); break;
    }
  }
  // Exercise graph edits and canonical omission alongside ordered contents.
  if (sample % 3 === 0) {
    b.vessels.root.ports = { right: { vessel: 'free', side: 'left' } };
    b.vessels.free.ports = { left: { vessel: 'root', side: 'right' } };
  } else if (sample % 3 === 1) {
    delete b.vessels.free;
    b.vessels.added = { contains: [{ kind: 'part', data: { ratio: 0.5 } }] };
    delete b.vessels.root.ports;
  }
  pairs.push({ kind: 'body', a, b });
  const sa = { protocol: 'paperchain/v1', bodies: { actor: clone(a), observer: bare(), retired: bare() },
    kinds: { watches: { symmetric: true }, old: {} },
    relations: [{ kind: 'watches', from: 'observer/root', to: 'actor/root' }] };
  const sb = { protocol: 'paperchain/v1', bodies: { actor: clone(b), observer: bare(), newcomer: bare() },
    kinds: { watches: { symmetric: true }, fresh: { fromMax: 1 } },
    relations: [{ kind: 'watches', from: 'actor/root', to: 'observer/root' },
      { kind: 'fresh', from: 'newcomer/root', to: 'actor/root' }] };
  pairs.push({ kind: 'scene', a: sa, b: sb });
}
const pristine = clone(pairs);
const requests = pairs.map(pair => {
  const scene = pair.kind === 'scene';
  const patch = unwrap((scene ? fold.diffScenes : fold.diffBodies)(pair.a, pair.b));
  return { ...pair, patch, inverse: (scene ? fold.invertScenePatch : fold.invertPatch)(patch) };
});
const run = spawnSync(process.env.PYTHON ?? 'python3', [fileURLToPath(new URL('./cross-language.py', import.meta.url))], {
  input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
assert.ifError(run.error);
assert.equal(run.status, 0, run.stderr);
const responses = JSON.parse(run.stdout);
assert.equal(responses.length, pairs.length);
let applications = 0;
for (const [index, response] of responses.entries()) {
  const { a, b, kind } = pairs[index], scene = kind === 'scene';
  const canonical = scene ? fold.canonicalizeScene : fold.canonicalizeBody;
  const apply = scene ? fold.applyScenePatch : fold.applyPatch;
  const compose = scene ? fold.composeScenePatches : fold.composePatches;
  assert.deepEqual(response.tsApplied, canonical(b), `TS -> Python ${index}`);
  assert.deepEqual(response.tsRestored, canonical(a), `TS inverse -> Python ${index}`);
  assert.deepEqual(response.tsComposed, canonical(a), `TS composition -> Python ${index}`);
  const applied = unwrap(apply(a, response.patch));
  assert.deepEqual(applied, canonical(b), `Python -> TS ${index}`);
  assert.deepEqual(unwrap(apply(applied, response.inverse)), canonical(a), `Python inverse -> TS ${index}`);
  assert.deepEqual(unwrap(apply(a, compose(response.patch, response.inverse))), canonical(a), `Python composition -> TS ${index}`);
  applications += 6;
}
assert.deepEqual(pairs, pristine, 'TypeScript inputs remain unchanged');
console.log(JSON.stringify({ seed: '0x50415045', bodyPairs: 100, scenePairs: 100, crossLanguageApplications: applications, passed: true }));
