import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { CHARACTERS, getCharacter } from '$lib/characters.js';
import { getLevel } from '$lib/levels.js';
import { GoogleGenAI } from '@google/genai';
import { geminiChatRequestSchema, validateOrThrow } from '$lib/validation/schemas.js';
import { createClient } from '@supabase/supabase-js';

const VALID_CHAR_IDS = Object.keys(CHARACTERS);
const VALID_LEVELS = ['beginner', 'intermediate', 'advanced'];
const MODEL_CANDIDATES = ['gemini-2.5-flash', 'gemini-1.5-flash'];
const DAILY_REQUEST_LIMIT = 30;

const RATE_LIMIT_WINDOW_MS = Number.parseInt(env.GEMINI_RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX_REQUESTS = Number.parseInt(env.GEMINI_RATE_LIMIT_MAX || '20', 10);
const rateState = new Map();
const dailyUsage = new Map();

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

async function authenticateUser(request) {
	const authHeader = request.headers.get('authorization');
	if (!authHeader?.startsWith('Bearer ')) return null;

	const token = authHeader.slice(7);
	const supabase = createClient(
		publicEnv.PUBLIC_SUPABASE_URL || '',
		publicEnv.PUBLIC_SUPABASE_ANON_KEY || '',
		{ global: { headers: { Authorization: `Bearer ${token}` } } }
	);

	const {
		data: { user },
		error
	} = await supabase.auth.getUser(token);
	if (error || !user) return null;
	return user.id;
}

function hasDailyQuota(userId) {
	const today = new Date().toISOString().split('T')[0];
	const key = `${userId}:${today}`;
	const count = dailyUsage.get(key) || 0;

	return count < DAILY_REQUEST_LIMIT;
}

function incrementDailyQuota(userId) {
	const today = new Date().toISOString().split('T')[0];
	const key = `${userId}:${today}`;
	const count = dailyUsage.get(key) || 0;
	dailyUsage.set(key, count + 1);

	// Clean up old entries
	for (const [k] of dailyUsage) {
		if (!k.endsWith(today)) dailyUsage.delete(k);
	}
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

function summarizeGeminiError(err) {
	if (!err) return '다시 시도하거나 네트워크 연결을 확인해주세요.';

	const msg = (err.message || '').toLowerCase();
	if (msg.includes('api key') || msg.includes('api_key') || msg.includes('apikey')) {
		return 'API 키 설정 오류입니다. GEMINI_API_KEY 또는 GOOGLE_API_KEY를 다시 확인하세요.';
	}

	if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('billing')) {
		return '현재 Gemini 사용 한도에 도달했거나 결제 상태를 확인해야 합니다.';
	}

	if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('unauthorized')) {
		return 'Gemini API 권한이 없습니다. API 키 권한 및 도메인/IP 제한을 확인하세요.';
	}

	if (msg.includes('model') || msg.includes('not found') || msg.includes('404')) {
		return '지원되지 않는 Gemini 모델입니다. 모델 버전을 확인해주세요.';
	}

	if (msg.includes('network') || msg.includes('failed to fetch')) {
		return '네트워크 연결을 확인하고 잠시 후 다시 시도해주세요.';
	}

	return err.message || '다시 시도하거나 네트워크 연결을 확인해주세요.';
}

async function generateGeminiContent(ai, payload) {
	let lastError = null;
	for (const model of MODEL_CANDIDATES) {
		try {
			return await ai.models.generateContent({
				...payload,
				model
			});
		} catch (err) {
			lastError = err;
			const errorMessage = (err?.message || '').toLowerCase();
			console.warn('[Gemini Chat API] model attempt failed', {
				model,
				message: err?.message
			});

			if (
				!errorMessage.includes('not found') &&
				!errorMessage.includes('404') &&
				!errorMessage.includes('model')
			) {
				throw err;
			}
		}
	}

	throw lastError;
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
	// 1. 인증 체크 - 로그인 필수
	const userId = await authenticateUser(request);
	if (!userId) {
		return new Response(
			JSON.stringify({
				error: 'Authentication required',
				message: '로그인이 필요합니다.'
			}),
			{ status: 401, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// 2. 일일 사용량 체크
	if (!hasDailyQuota(userId)) {
		return new Response(
			JSON.stringify({
				error: 'Daily limit exceeded',
				message: `일일 사용 한도(${DAILY_REQUEST_LIMIT}회)를 초과했습니다. 내일 다시 이용해주세요.`
			}),
			{ status: 429, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// 3. IP 기반 속도 제한
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

	if (filteredMessages.length === 0) {
		filteredMessages.push({
			role: 'user',
			parts: [{ text: 'Start our conversation with a short English warm-up question.' }]
		});
	}

	const instruction = `${buildBaseInstructions()}\n\nYou are ${character.label}, a friendly English conversation teacher. ${character.personality}${levelInstructions}${scenarioInstructions}`;

	try {
		const ai = new GoogleGenAI({ apiKey });
		const response = await generateGeminiContent(ai, {
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

		incrementDailyQuota(userId);

		return new Response(
			JSON.stringify({
				text: responseText,
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
				message: summarizeGeminiError(e)
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
