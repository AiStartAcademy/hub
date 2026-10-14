import { describe, expect, it } from "bun:test";
import {
  letterToIndex,
  parseCorrectIndex,
  stripOptionPrefix,
} from "@/lib/quizUtils";
import type { N8nQuizQuestion } from "@/types/n8n";

describe("letterToIndex", () => {
  it("maps A-D to 0-3", () => {
    expect(letterToIndex("A")).toBe(0);
    expect(letterToIndex("D")).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(letterToIndex("c")).toBe(2);
  });
});

describe("stripOptionPrefix", () => {
  it("removes an 'A) ' style prefix", () => {
    expect(stripOptionPrefix("A) Paris")).toBe("Paris");
  });

  it("is case-insensitive on the letter", () => {
    expect(stripOptionPrefix("b) London")).toBe("London");
  });

  it("leaves un-prefixed text untouched (aside from trim)", () => {
    expect(stripOptionPrefix("  Berlin ")).toBe("Berlin");
  });
});

function makeQuestion(correct: string, options: string[]): N8nQuizQuestion {
  return {
    question: "Q?",
    options,
    correct_answer: correct,
  } as N8nQuizQuestion;
}

describe("parseCorrectIndex", () => {
  const stripped = ["Paris", "London", "Berlin", "Madrid"];

  it("resolves a single-letter answer", () => {
    expect(parseCorrectIndex(makeQuestion("C", []), stripped)).toBe(2);
  });

  it("resolves a lowercase letter answer", () => {
    expect(parseCorrectIndex(makeQuestion("a", []), stripped)).toBe(0);
  });

  it("falls back to full-text match, case-insensitively", () => {
    expect(parseCorrectIndex(makeQuestion("berlin", []), stripped)).toBe(2);
  });

  it("returns -1 when nothing matches", () => {
    expect(parseCorrectIndex(makeQuestion("Rome", []), stripped)).toBe(-1);
  });
});
