import { generateConcepts, type GeneratedConcept } from "./generate-concepts";

export interface TopicAgentPlan {
  concepts: GeneratedConcept[];
  rationale: string;
}

/**
 * Topic agent: builds the initial concept path for a topic node.
 */
export async function runTopicAgent(
  topicTitle: string,
  topicDesc?: string | null,
  documentContents?: string | null,
): Promise<TopicAgentPlan> {
  const concepts = await generateConcepts(topicTitle, topicDesc, documentContents);

  return {
    concepts,
    rationale:
      "Initial concept path generated from foundational to advanced progression.",
  };
}
