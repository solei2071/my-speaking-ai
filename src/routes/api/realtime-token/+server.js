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
			model: 'gpt-4o-mini-realtime-preview',
			audio: {
				output: { voice }
			},
			instructions: `You are a friendly English conversation teacher for intermediate learners.

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
Speak clearly at a moderate pace. Be encouraging and friendly.`
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
		const msg = e?.message ?? 'Unknown error';
		const cause = e?.cause?.message ?? e?.cause;
		const isNetworkError = msg === 'fetch failed' || msg?.includes('timeout') || msg?.includes('Timeout');
		const hint = isNetworkError
			? 'Cannot reach api.openai.com. Check: 1) Internet connection 2) Firewall/VPN blocking OpenAI 3) Try different network 4) Slow network - try again.'
			: null;
		return new Response(
			JSON.stringify({
				error: 'Server error',
				details: cause ? `${msg} (${cause})` : msg,
				hint
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
