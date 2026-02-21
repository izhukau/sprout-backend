/**
 * Extracts and parses JSON from Claude's response text.
 * Handles cases where Claude wraps JSON in markdown code fences.
 */
export function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  return JSON.parse(cleaned) as T;
}
