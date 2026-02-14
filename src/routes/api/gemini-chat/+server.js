import { env } from '$env/dynamic/private';
import { CHARACTERS, getCharacter, getVoiceForCharacter } from '$lib/characters.js';
import { getLevel } from '$lib/levels.js';
import { GoogleGenAI } from '@google/genai';
import { geminiChatRequestSchema, validateOrThrow } from '$lib/validation/schemas.js';

const VALID_CHAR_IDS = Object.keys(CHARACTERS);
const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];
const VALID_MODEL = 'gemini-2.5-flash';

const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.GEMINI_RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX_REQUESTS = Number.parseInt(env.GEMINI_RATE_LIMIT_MAX || '20', 10);
const rateState = new Map();

function getClientKey(request) {
	const forwardedFor = request.headers.get('x-forwarded-for');
	if (forwardedFor) {
		return forwardedFor.split(',')[0].trim() || 'unknown';
	}

	const cfIp = request.headers.get('cf-connecting-ip');
	if (cfIp) return cfIp;

	const realIp = request.headers.get('x-real-ip');
	if (realIp) return realIp;

	return 'anonymous';
}

function hasRemainingQuota(clientKey) {
	if (!Number.isFinite(RATE_LIMIT_WINDOW_MS) || !Number.isFinite(RATE_LIMIT_MAX_REQUESTS)) {
		return true;
	}

	const now = Date.now();
	const current = rateState.get(clientKey);

	if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
		rateState.set(clientKey, {
			windowStart: now,
			count: 1
		});
		return true;
	}

	if (current.count < RATE_LIMIT_MAX_REQUESTS) {
		current.count += 1;
		rateState.set(clientKey, current);
		return true;
	}

	return false;
}

function buildBaseInstructions() {
	return `You are a friendly English conversation teacher.

CRITICAL - You MUST follow this format EVERY time the student speaks:

STEP 1 - Grammar correction (if needed):
- If there are mistakes, say: "Just a small fix: [corrected sentence]"
- If perfect, say "Perfect grammar!"

STEP 2 - Natural paraphrase variations (ALWAYS do this):
- Give 2-3 more natural ways to say it
- Format exactly like this:
  "You could also say: [variation 1]"
  "Or more naturally: [variation 2]"
  "Another way: [variation 3]"

STEP 3 - Your response to continue the conversation.

You must keep the response natural, encouraging, and concise.
`;
}

function extractResponseText(data) {
	if (!data) return '';

	const topText = data?.text;
	if (typeof topText === 'string' && topText.trim()) return topText.trim();

	const firstCandidate = data?.candidates?.[0];
	if (!firstCandidate) return '';

	const parts = firstCandidate?.content?.parts;
	if (Array.isArray(parts) && parts.length > 0) {
		return parts
			.map((p) => (typeof p === 'string' ? p : p?.text || ''))
			.join(' ')
			.trim();
	}
	if (typeof firstCandidate?.content?.text === 'string') return firstCandidate.content.text.trim();
	if (typeof firstCandidate?.text === 'string') return firstCandidate.text.trim();

	return '';
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	const clientKey = getClientKey(request);
	if (!hasRemainingQuota(clientKey)) {
		const windowMs =
			Number.isFinite(RATE_LIMIT_WINDOW_MS) && RATE_LIMIT_WINDOW_MS > 0
				? RATE_LIMIT_WINDOW_MS
				: 60000;
		return new Response(
			JSON.stringify({
				error: 'Rate limit exceeded',
				message: `요청이 너무 빈번합니다. ${Math.ceil(windowMs / 1000)}초 후에 다시 시도해주세요.`
			}),
			{
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': String(Math.ceil(windowMs / 1000))
				}
			}
		);
	}

	const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
	if (!apiKey) {
		return new Response(
			JSON.stringify({ error: 'GEMINI_API_KEY is not set. Please check your .env file.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	let characterId = 'alloy';
	let levelId = 'intermediate';
	let scenarioInstructions = '';
	let messages = [];

	try {
		const body = await request.json();
		const validated = validateOrThrow(geminiChatRequestSchema, body);

		const requested = validated.character || validated.voice;
		if (requested && VALID_CHAR_IDS.includes(requested)) {
			characterId = requested;
		}
		if (validated.level && VALID_LEVELS.includes(validated.level)) {
			levelId = validated.level;
		}
		if (validated.scenario) {
			scenarioInstructions = `\n\nScenario focus: ${validated.scenario}`;
		}
		messages = validated.messages || [];
	} catch (e) {
		console.warn('[Gemini Chat API] Invalid request body, using defaults:', e.message);
	}

	const character = getCharacter(characterId);
	const voice = getVoiceForCharacter(characterId);
	const level = getLevel(levelId);
	const levelInstructions = `\n\n${level.instructions}`;
	const filteredMessages = messages
		.filter((m) => m?.role === 'user' || m?.role === 'assistant')
		.filter((m) => typeof m.text === 'string' && m.text.trim())
		.slice(-50)
		.map((m) => ({
			role: m.role,
			parts: [{ text: m.text }]
		}));

	const instruction = `${buildBaseInstructions()}\n\nYou are ${character.label}, a friendly English conversation teacher. ${character.personality}${levelInstructions}${scenarioInstructions}`;

	try {
		const ai = new GoogleGenAI({ apiKey });
		const response = await ai.models.generateContent({
			model: VALID_MODEL,
			contents: filteredMessages,
			config: {
				systemInstruction: instruction,
				temperature: 0.8
			}
		});

		const responseText = extractResponseText(response);
		if (!responseText) {
			return new Response(JSON.stringify({ error: 'No response generated' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		return new Response(
			JSON.stringify({
				text: responseText,
				voice,
				character: {
					name: character.label,
					emoji: character.emoji,
					mbti: character.mbti
				}
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (e) {
		console.error('[Gemini Chat API] Failed to generate response:', e);
		return new Response(
			JSON.stringify({
				error: 'Gemini request failed',
				message: e?.message ?? '다시 시도하거나 네트워크 연결을 확인해주세요.'
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
