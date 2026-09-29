import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractBriefSkills } from "../modules/ai/skills";
import type { AiProvider } from "../modules/ai/provider";

const TAXONOMY = [
  { id: "seo", name: "SEO" },
  { id: "brand", name: "Branding" },
  { id: "gads", name: "Google Ads" },
];
const fake = (answer: string | Error): AiProvider => ({
  name: "fake",
  completeWithUsage: async () => {
    if (answer instanceof Error) throw answer;
    return { text: answer, model: "fake", inputTokens: 0, outputTokens: 0 };
  },
  complete: async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  },
});

describe("reading skills from a brief", () => {
  it("keeps only skills from the taxonomy, matched by name", async () => {
    const r = await extractBriefSkills(fake('Here you go: ["seo", "Google Ads", "Quantum Marketing"]'), "Rank us and run search ads", TAXONOMY);
    assert.deepEqual(r.skills.map((s) => s.id), ["seo", "gads"]);
    assert.equal(r.used, true);
  });

  it("is off without a provider or a brief — the deterministic path", async () => {
    assert.deepEqual(await extractBriefSkills(null, "brief", TAXONOMY), { skills: [], used: false, error: null });
    assert.deepEqual(await extractBriefSkills(fake('["SEO"]'), "   ", TAXONOMY), { skills: [], used: false, error: null });
  });

  it("never fails the caller: bad JSON or a provider error yields no skills", async () => {
    assert.deepEqual((await extractBriefSkills(fake("not json ["), "x", TAXONOMY)).skills, []);
    const err = await extractBriefSkills(fake(new Error("timeout")), "x", TAXONOMY);
    assert.deepEqual(err.skills, []);
    assert.equal(err.error, "timeout");
  });

  it("caps at five and removes duplicates", async () => {
    const r = await extractBriefSkills(fake('["SEO","seo","SEO"]'), "x", TAXONOMY);
    assert.equal(r.skills.length, 1);
  });
});
