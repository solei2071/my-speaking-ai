/**
 * Difficulty level configurations for English practice.
 * Adjusts AI tutor behavior based on learner's proficiency.
 */

export const LEVELS = {
	beginner: {
		id: 'beginner',
		label: 'Beginner',
		sublabel: 'A1–A2',
		emoji: '🌱',
		description: '기초 단어와 짧은 문장으로 천천히 연습',
		instructions: `DIFFICULTY: Beginner (A1–A2).
- Use simple, everyday vocabulary (max 1,000 common words).
- Speak in short, clear sentences (5–10 words).
- Speak SLOWLY and clearly. Pause between sentences.
- Correct mistakes very gently with simple explanations.
- If the student uses their native language, help translate and teach the English version.
- Give only 1 paraphrase variation (keep it simple).
- Use present tense primarily. Introduce past tense gradually.
- Encourage ANY attempt to speak. Celebrate small wins enthusiastically.
- Ask simple yes/no or choice questions: "Do you like coffee or tea?"
- Avoid idioms, phrasal verbs, and complex grammar.`
	},
	intermediate: {
		id: 'intermediate',
		label: 'Intermediate',
		sublabel: 'B1–B2',
		emoji: '🌿',
		description: '자연스러운 대화와 다양한 표현 연습',
		instructions: `DIFFICULTY: Intermediate (B1–B2).
- Use natural, conversational vocabulary with some advanced words.
- Speak at a normal pace. Use varied sentence structures.
- Correct mistakes clearly and explain the grammar rule briefly.
- Give 2–3 paraphrase variations with different registers (casual/formal).
- Introduce idioms and phrasal verbs naturally, explaining them when used.
- Ask open-ended questions that require 2–3 sentence answers.
- Use all tenses naturally. Point out tense errors specifically.
- Encourage the student to elaborate: "Can you tell me more about that?"
- Introduce linking words: however, therefore, on the other hand.`
	},
	advanced: {
		id: 'advanced',
		label: 'Advanced',
		sublabel: 'C1–C2',
		emoji: '🌳',
		description: '원어민 수준의 표현과 뉘앙스 연습',
		instructions: `DIFFICULTY: Advanced (C1–C2).
- Use sophisticated vocabulary, idioms, and nuanced expressions freely.
- Speak at native speed with natural contractions and reductions.
- Focus corrections on NUANCE: "Grammatically correct, but a native would say..."
- Give 3 paraphrase variations showing register differences (casual/professional/literary).
- Challenge with complex topics: philosophy, current events, abstract concepts.
- Point out subtle differences: connotation, collocation, tone.
- Use advanced grammar: subjunctive, inversion, cleft sentences.
- Ask questions that require argumentation: "What's your take on...?"
- Teach advanced skills: hedging, diplomatic language, humor, sarcasm.
- Treat the student as a near-native speaker. Be intellectually stimulating.`
	}
};

/** Get level config by id */
export function getLevel(levelId) {
	return LEVELS[levelId] ?? LEVELS.intermediate;
}

/** Level options for UI */
export const levelOptions = Object.values(LEVELS);
