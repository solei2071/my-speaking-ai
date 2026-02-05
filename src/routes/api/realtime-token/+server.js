import { env } from '$env/dynamic/private';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		return new Response(
			JSON.stringify({ error: 'OPENAI_API_KEY is not set. Please check your .env file.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const VALID_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
	let voice = 'alloy';
	try {
		const body = await request.json();
		const requested = body?.voice;
		if (requested && VALID_VOICES.includes(requested)) voice = requested;
	} catch (_) {}

	const sessionConfig = {
		session: {
			type: 'realtime',
			model: 'gpt-realtime',
			audio: {
				output: { voice }
			},
			instructions: `You are a friendly English conversation teacher for intermediate learners.

CRITICAL - You MUST follow this order EVERY time the student speaks (voice or text):

STEP 1 - Grammar & spelling correction (ALWAYS do this first):
- Point out any grammar or spelling mistakes. Give the corrected version.
- If their English was perfect, say "Great job, no corrections needed!"
- Be gentle and encouraging.

STEP 2 - Paraphrase (ALWAYS do this second):
- Rephrase their sentence into more natural/polished English.
- Say: "A more natural way to say that would be: [improved version]"
- This helps them learn better expressions.

STEP 3 - Respond to the conversation (only after steps 1 and 2):
- Answer their question, ask a follow-up, or comment naturally.

Never skip steps 1 and 2. Do them at the start of every response, before continuing the conversation.
Speak clearly at a moderate pace. Use B1-B2 vocabulary. Be encouraging.`
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
			return new Response(
				JSON.stringify({ error: 'Failed to get token', details: err }),
				{ status: response.status, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const data = await response.json();
		return new Response(JSON.stringify({ value: data.value }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		return new Response(
			JSON.stringify({ error: 'Server error', details: e?.message }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
