/// <reference path="../conformance/typescript/node-shims.d.ts" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCaseMatches,
  assertRuleAnchorsExist,
  loadCorpusFiles,
  runCase
} from "paperchain/conformance/v2";
import { dispatchPaperfoldCase } from "../conformance/typescript/extended_conformance";

describe("paperfold corpus v2", () => {
  const corpus = loadCorpusFiles([
    new URL("../conformance/cases/paperfold-v1.json", import.meta.url),
    new URL("../conformance/cases/paperfold-v2.json", import.meta.url)
  ]);

  it("links every rule to an explicit normative anchor", () => {
    const specification = readFileSync(new URL("../docs/spec.md", import.meta.url), "utf8");
    assertRuleAnchorsExist(corpus, {
      "paperfold/v1": specification,
      "paperfold/v2": specification
    });
  });

  for (const testCase of corpus.cases) {
    it(`${testCase.id}: ${testCase.rule}`, () => {
      const before = structuredClone(testCase.input.args);
      const actual = runCase(testCase, dispatchPaperfoldCase);
      assertCaseMatches(testCase, actual);
      expect(testCase.input.args).toEqual(before);
    });
  }
});
