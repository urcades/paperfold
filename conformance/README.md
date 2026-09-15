# Paperfold conformance

These hand-authored `paper-family-conformance/v2` corpora bind the normative
paperfold specifications to public API behavior. They are shared by the
TypeScript adapter in `typescript/extended_conformance.ts` and the independent
standard-library Python reference shipped by `paperchain`.

The TypeScript adapter and its Vitest test are source-checkout tooling. The
published package omits `src/` and `test/`; the adapter remains an
instructional example for other implementations. From a source checkout, run:

```sh
npx vitest run test/conformance.test.ts
```

The published package includes the corpus JSON and standard-library Python
cross-language scripts. From a source checkout after installing dependencies,
run the packaged workflow against the same JSON with:

```sh
npm run test:conformance:python
```

The npm command invokes `scripts/cross-language.py`, which resolves the
installed `paperchain` conformance modules and dispatches Fold cases to its
independent `paperfold.py` reference. Local pre-release integration may instead
resolve a sibling paperchain checkout. `npm run test:cross-language`
additionally cross-applies patches produced by TypeScript and Python.
Build once with `npm run build` when running cross-language checks from a
source checkout; published artifacts are already built.

The 28 cases cover all seven v1 kernel entry types and all six v2 scene entry
types, structural validation, nested paths, stale records, atomic refusal,
canonical empty forms, explicit inversion and composition, symmetric stored
orientation, and body/scene diff laws. `diffLaws` and `diffSceneLaws` compare
the applied canonical target and restored canonical source; they deliberately
do not require independent diff algorithms to emit identical patch entries.
