export function validateSecurityPreset(preset) {
  if (
    !preset ||
    typeof preset.question !== "string" ||
    !preset.question.trim() ||
    preset.question.length > 40 ||
    typeof preset.answer !== "string" ||
    !preset.answer.trim() ||
    preset.answer.length > 25
  )
    throw new Error(
      "Enter a question of 1–40 characters and an answer of 1–25 characters.",
    );
  return { question: preset.question, answer: preset.answer };
}
