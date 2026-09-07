import type { Person } from "../types/person";
import type { TestimonyLine } from "../types/knowledge";
import type { Evidence } from "../types/evidence";

/**
 * Boundary between the deterministic engine and any future natural-language
 * layer. A NarrativeProvider only ever *rephrases* facts the engine has
 * already decided — the emotional state, the stance (truthful/lie/omission/
 * vague/refusal/contradiction), and the statement content all come from
 * TestimonyLine/KnowledgeFact. It must never be given the power to decide
 * what happened, who is guilty, or what a character knows.
 */
export interface NarrativeProvider {
  generateWitnessDialogue(person: Person, testimony: TestimonyLine, emotionalState: EmotionalState): string;
  generateReport(kind: "autopsy" | "lab_analysis" | "incident", facts: Record<string, unknown>): string;
  generateDescription(evidence: Evidence): string;
  generateInterrogationResponse(person: Person, testimony: TestimonyLine, question: string): string;
}

export interface EmotionalState {
  stress: number;
  fear: number;
  defensiveness: number;
}

/** Deterministic, template-based implementation — no external calls, no
 * variance run to run beyond what the engine itself already produced. This
 * is the only implementation used today; an LLM-backed provider can be
 * added later behind the same interface without touching engine code. */
export class TemplateNarrativeProvider implements NarrativeProvider {
  generateWitnessDialogue(person: Person, testimony: TestimonyLine): string {
    switch (testimony.stance) {
      case "lie":
        return `${person.firstName} déclare : « ${testimony.statement} »`;
      case "omission":
        return `${person.firstName} n'aborde pas ce sujet.`;
      case "vague":
        return `${person.firstName} reste évasif·ve : « ${testimony.statement} »`;
      case "refusal":
        return `${person.firstName} refuse de répondre.`;
      case "contradiction":
        return `${person.firstName} se contredit : « ${testimony.statement} »`;
      case "truthful":
      default:
        return `${person.firstName} déclare : « ${testimony.statement} »`;
    }
  }

  generateReport(kind: "autopsy" | "lab_analysis" | "incident", facts: Record<string, unknown>): string {
    const lines = Object.entries(facts).map(([key, value]) => `${key}: ${String(value)}`);
    return `[Rapport ${kind}]\n${lines.join("\n")}`;
  }

  generateDescription(evidence: Evidence): string {
    return evidence.description;
  }

  generateInterrogationResponse(person: Person, testimony: TestimonyLine, question: string): string {
    return `(en réponse à « ${question} ») ${this.generateWitnessDialogue(person, testimony)}`;
  }
}
