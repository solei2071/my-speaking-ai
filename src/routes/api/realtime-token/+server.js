import { env } from '$env/dynamic/private';
import { CHARACTERS, getCharacter, getVoiceForCharacter } from '$lib/characters.js';
import { getLevel } from '$lib/levels.js';
import { validateOrThrow, realtimeTokenRequestSchema } from '$lib/validation/schemas.js';

const VALID_CHAR_IDS = Object.keys(CHARACTERS);
const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		return new Response(
			JSON.stringify({ error: 'OPENAI_API_KEY is not set. Please check your .env file.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	let charId = 'alloy';
	let levelId = 'intermediate';
	try {
		const body = await request.json();
		// Validate input
		const validated = validateOrThrow(realtimeTokenRequestSchema, body);
		const requested = validated.voice ?? validated.character;
		if (requested && VALID_CHAR_IDS.includes(requested)) {
			charId = requested;
		}
		if (validated.level && VALID_LEVELS.includes(validated.level)) {
			levelId = validated.level;
		}
	} catch (e) {
		// Log but continue with default (graceful degradation)
		console.warn('[Token API] Invalid request body, using default:', e.message);
	}

	const character = getCharacter(charId);
	const voice = getVoiceForCharacter(charId);
	const level = getLevel(levelId);
	const baseInstructions = `
CRITICAL - You MUST follow this EXACT format EVERY time the student speaks:

STEP 1 - Grammar correction (if needed):
- If there are mistakes, say: "Just a small fix: [corrected sentence]"
- If perfect, skip this or say "Perfect grammar!"

STEP 2 - Natural paraphrase variations (ALWAYS do this):
- Give 2-3 more natural ways to say it
- Format exactly like this:
  "You could also say: [variation 1]"
  "Or more naturally: [variation 2]"
  "Another way: [variation 3]"

STEP 3 - Your response to continue the conversation.

EXAMPLE of your response format:
"Just a small fix: 'I went to the store yesterday.'
You could also say: 'I stopped by the store yesterday.'
Or more naturally: 'I made a quick trip to the store yesterday.'
Another way: 'I popped into the store yesterday.'

[Then your conversational response here]"

ALWAYS do steps 1-2 first, then respond. Never skip the paraphrase variations.
Speak clearly at a moderate pace.
`;

	const sessionConfig = {
		session: {
			type: 'realtime',
			model: 'gpt-4o-mini-realtime-preview',
			audio: {
				output: { voice }
			},
			instructions: `You are ${character.label}, a friendly English conversation teacher. ${character.personality}
${level.instructions}
${baseInstructions}`
		}
	};

	try {
		const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(sessionConfig)
		});

		if (!response.ok) {
			const err = await response.text();
			console.error('[Token API] OpenAI error:', err);
			// Don't expose internal error details to client
			return new Response(JSON.stringify({ error: '토큰 생성 실패' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const data = await response.json();
		return new Response(JSON.stringify({ value: data.value }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		console.error('[Token API] Server error:', e);
		// Don't expose internal error details to client
		return new Response(
			JSON.stringify({
				error: '토큰 생성 실패',
				message: '다시 시도하거나 네트워크 연결을 확인해주세요'
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
