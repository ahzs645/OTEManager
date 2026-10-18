import { expect, test } from "vitest";
import { validateSecurityPreset } from "../extensions/vancity-payment-helper/security-preset.js";

test("validates Vancity question and answer limits without changing the answer", () => {
  const sample = {
    question: "Synthetic question?",
    answer: "Case sensitive answer",
  };
  expect(validateSecurityPreset(sample)).toEqual(sample);
  for (const preset of [
    null,
    { question: " ", answer: "test" },
    { question: "Question?", answer: " " },
    { question: "x".repeat(41), answer: "test" },
    { question: "Question?", answer: "x".repeat(26) },
  ])
    expect(() => validateSecurityPreset(preset)).toThrow("Enter a question");
});
