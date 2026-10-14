import { describe, expect, it } from "bun:test";
import {
  answerKeyForViewer,
  stripQuizAnswerKey,
} from "@/lib/answerKey";

const lessonQuiz = {
  id: "quiz-1",
  name: "Lesson quiz",
  maxAttempts: 3,
  items: [
    {
      id: "item-1",
      questionText: "Choose one",
      type: "single_choice",
      order: 1,
      options: [
        { id: "option-1", text: "Wrong", isCorrect: false, order: 1 },
        { id: "option-2", text: "Right", isCorrect: true, order: 2 },
      ],
    },
    {
      id: "item-2",
      questionText: "Explain why",
      type: "free_text",
      order: 2,
      options: [],
    },
  ],
  submissions: [
    {
      id: "submission-1",
      answers: [
        {
          itemId: "item-1",
          selectedOptions: [{ optionId: "option-2" }],
          textAnswer: null,
          points: 1,
        },
      ],
    },
  ],
};

const assessment = {
  id: "assessment-1",
  name: "Final assessment",
  items: [
    {
      id: "assessment-item-1",
      questionText: "Select all",
      type: "multiple_choice",
      order: 1,
      points: 2,
      options: [
        { id: "assessment-option-1", text: "A", isCorrect: true, order: 1 },
        { id: "assessment-option-2", text: "B", isCorrect: false, order: 2 },
      ],
    },
  ],
};

describe("answer-key payload filtering", () => {
  it("SC-3a: learner payload has no isCorrect on any option", () => {
    const strippedQuiz = answerKeyForViewer(lessonQuiz, { canManage: false });
    const strippedAssessment = answerKeyForViewer(assessment, { canManage: false });

    expect(JSON.stringify(strippedQuiz)).not.toContain("isCorrect");
    expect(JSON.stringify(strippedAssessment)).not.toContain("isCorrect");
  });

  it("SC-3b: staff payload keeps isCorrect", () => {
    const staffQuiz = answerKeyForViewer(lessonQuiz, { canManage: true });
    const staffAssessment = answerKeyForViewer(assessment, { canManage: true });

    expect(staffQuiz).toEqual(lessonQuiz);
    expect(staffAssessment).toEqual(assessment);
    expect(staffQuiz.items[0].options[1].isCorrect).toBe(true);
    expect(staffAssessment.items[0].options[0].isCorrect).toBe(true);
  });

  it("SC-3c: a submitted learner still gets per-item results", () => {
    const stripped = stripQuizAnswerKey(lessonQuiz);

    expect(stripped.submissions).toEqual(lessonQuiz.submissions);
  });

  it("SC-3d: free_text items unaffected", () => {
    const stripped = stripQuizAnswerKey(lessonQuiz);

    expect(stripped.items[1]).toEqual({
      id: "item-2",
      questionText: "Explain why",
      type: "free_text",
      order: 2,
      options: [],
    });
  });

  it("does not mutate the input and preserves non-option fields", () => {
    const before = structuredClone(assessment);
    const stripped = stripQuizAnswerKey(assessment);

    expect(assessment).toEqual(before);
    expect(stripped.id).toBe(assessment.id);
    expect(stripped.items[0].id).toBe(assessment.items[0].id);
    expect(stripped.items[0].questionText).toBe(assessment.items[0].questionText);
    expect(stripped.items[0].order).toBe(assessment.items[0].order);
    expect(stripped.items[0].options[0]).toEqual({
      id: "assessment-option-1",
      text: "A",
      order: 1,
    });
  });

  it("handles a null quiz", () => {
    expect(stripQuizAnswerKey(null)).toBeNull();
  });
});
