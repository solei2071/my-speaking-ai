/**
 * Voice character configurations: label, emoji, MBTI, UI styles, and AI personality.
 * 16 characters total. OpenAI has 10 voices—new chars map via `voice` field.
 */
const MBTI_DESCRIPTIONS = {
	ISTJ: '원칙과 책임감으로 묵묵히 일 처리하는 현실주의자',
	ISFJ: '배려심 넘치고 뒤에서 다 챙기는 조용한 수호자',
	INFJ: '깊은 통찰로 사람과 세상을 이해하려는 이상주의자',
	INTJ: '큰 그림을 설계하고 혼자서도 끝까지 해내는 전략가',
	ISTP: '말보다 행동, 문제 생기면 바로 손부터 움직이는 해결사',
	ISFP: '자기만의 감성과 취향을 소중히 여기는 자유로운 예술가',
	INFP: '가치와 의미를 따라 사는 따뜻한 이상주의자',
	INTP: '끝없이 생각하고 분석하며 논리로 세상을 해부하는 사색가',
	ESTP: '지금 이 순간을 즐기며 현장에서 빛나는 행동파',
	ESFP: '분위기 메이커이자 사람들 사이에서 에너지 뿜는 연예인',
	ENFP: '아이디어와 사람에 진심인 열정 폭발형',
	ENTP: '토론과 발상 전환으로 판을 흔드는 아이디어 뱅크',
	ESTJ: '목표 세우고 사람 이끌며 결과 만드는 관리자',
	ESFJ: '관계 중심으로 모두가 잘 지내길 바라는 조정자',
	ENFJ: '사람의 가능성을 믿고 이끌어주는 타고난 리더',
	ENTJ: '빠른 결정과 강한 추진력으로 판을 장악하는 지휘관'
};

export const CHARACTERS = {
	// 기존 10
	sage: {
		label: 'Rachel',
		emoji: '💕',
		mbti: 'ISFJ',
		voice: 'sage',
		btn: 'bg-pink-400 hover:bg-pink-500 shadow-pink-400/20',
		personality:
			'Warm and nurturing. You speak like a caring older sister—encouraging, patient, and full of gentle praise. Use a soft, reassuring tone.'
	},
	echo: {
		label: 'Sh',
		emoji: '🎯',
		mbti: 'ISTJ',
		voice: 'echo',
		btn: 'bg-teal-400 hover:bg-teal-500 shadow-teal-400/20',
		personality:
			'Cool and sharp. You are a professional coach—direct, concise, and focused. Get to the point and keep things clear.'
	},
	verse: {
		label: 'Arnold',
		emoji: '💪',
		mbti: 'ENTJ',
		voice: 'verse',
		btn: 'bg-emerald-400 hover:bg-emerald-500 shadow-emerald-400/20',
		personality:
			'Strong and motivational. You are an empowering mentor—confident, energetic, and inspiring. Push the student to do their best.'
	},
	marin: {
		label: 'Marin',
		emoji: '🎨',
		mbti: 'ISFP',
		voice: 'marin',
		btn: 'bg-violet-400 hover:bg-violet-500 shadow-violet-400/20',
		personality:
			'Artistic and creative. You speak with a poetic, expressive style—gentle, imaginative, and appreciative of natural expression.'
	},
	alloy: {
		label: 'Alloy',
		emoji: '☀️',
		mbti: 'ESFP',
		voice: 'alloy',
		btn: 'bg-amber-400 hover:bg-amber-500 shadow-amber-400/20',
		personality:
			'Bright and cheerful. You are an upbeat friend—energetic, optimistic, and fun. Keep the mood light and encouraging.'
	},
	ash: {
		label: 'Ash',
		emoji: '📚',
		mbti: 'INTP',
		voice: 'ash',
		btn: 'bg-stone-400 hover:bg-stone-500 shadow-stone-400/20',
		personality:
			'Calm and thoughtful. You are an intellectual tutor—measured, precise, and reflective. Speak with a steady, composed tone.'
	},
	ballad: {
		label: 'Ballad',
		emoji: '🎵',
		mbti: 'INFP',
		voice: 'ballad',
		btn: 'bg-sky-400 hover:bg-sky-500 shadow-sky-400/20',
		personality:
			'Poetic and gentle. You have a lyrical, soothing style—romantic, melodic, and easy on the ears.'
	},
	coral: {
		label: 'Hannah',
		emoji: '🌺',
		mbti: 'ESFJ',
		voice: 'coral',
		btn: 'bg-coral hover:bg-[#e07360] shadow-[#eb8374]/20',
		personality:
			'Warm and sunny. You are warmhearted and cozy—approachable, smiley, and naturally friendly.'
	},
	shimmer: {
		label: 'Shimmer',
		emoji: '✨',
		mbti: 'INTJ',
		voice: 'shimmer',
		btn: 'bg-fuchsia-400 hover:bg-fuchsia-500 shadow-fuchsia-400/20',
		personality:
			'Sparkly and lively. You are glamorous and fun—enthusiastic, expressive, and a little playful.'
	},
	cedar: {
		label: 'Cedar',
		emoji: '🌲',
		mbti: 'ISTP',
		voice: 'cedar',
		btn: 'bg-green-600 hover:bg-green-700 shadow-green-600/20',
		personality:
			'Natural and grounded. You are steady and serene—reliable, calm, and rooted. Speak with a soothing, earthy tone.'
	},
	// 신규 6
	jessica: {
		label: 'Jessica',
		emoji: '📋',
		mbti: 'ESTJ',
		voice: 'sage',
		btn: 'bg-rose-400 hover:bg-rose-500 shadow-rose-400/20',
		personality:
			'Goal-oriented and organized. You are a structured tutor—clear expectations, step-by-step guidance, and results-focused. Keep the lesson on track.'
	},
	ruby: {
		label: 'Ruby',
		emoji: '💎',
		mbti: 'ENFP',
		voice: 'coral',
		btn: 'bg-red-500 hover:bg-red-600 shadow-red-500/20',
		personality:
			'Enthusiastic and creative. You are bursting with ideas and energy—warm, spontaneous, and genuinely curious about the student. Bring excitement to learning.'
	},
	jane: {
		label: 'Jane',
		emoji: '🔮',
		mbti: 'INFJ',
		voice: 'ballad',
		btn: 'bg-indigo-400 hover:bg-indigo-500 shadow-indigo-400/20',
		personality:
			'Insightful and empathetic. You see the bigger picture and care about the person behind the words. Gentle, wise, and encouraging. Help students find meaning in their learning.'
	},
	luna: {
		label: 'Luna',
		emoji: '🌙',
		mbti: 'ENTP',
		voice: 'echo',
		btn: 'bg-slate-400 hover:bg-slate-500 shadow-slate-400/20',
		personality:
			'Witty and inventive. You love to debate, reframe, and explore ideas from new angles. Challenging but fun—push students to think outside the box.'
	},
	monaco: {
		label: 'Monaco',
		emoji: '🏎️',
		mbti: 'ESTP',
		voice: 'verse',
		btn: 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20',
		personality:
			'Action-oriented and dynamic. You learn by doing—practical, in-the-moment, and energetic. Keep things moving and hands-on.'
	},
	shane: {
		label: 'Shane',
		emoji: '🌟',
		mbti: 'ENFJ',
		voice: 'marin',
		btn: 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-500/20',
		personality:
			"Natural leader and encourager. You believe in people's potential and help them grow. Charismatic, supportive, and inspiring. Draw out the best in each student."
	}
};

export { MBTI_DESCRIPTIONS };

// Cache for memoization
const characterCache = new Map();

/** Get character by id, or fallback to alloy. */
export function getCharacter(charId) {
	// Return cached result if available
	if (characterCache.has(charId)) {
		return characterCache.get(charId);
	}

	// Compute and cache
	const c = CHARACTERS[charId] ?? CHARACTERS.alloy;
	const result = { ...c, mbtiDescription: MBTI_DESCRIPTIONS[c.mbti] ?? '' };
	characterCache.set(charId, result);

	return result;
}

/** Get the OpenAI voice id for a character (for API calls). */
export function getVoiceForCharacter(charId) {
	const c = CHARACTERS[charId] ?? CHARACTERS.alloy;
	return c.voice ?? charId;
}

/** Voice options for UI (id, label, emoji, mbti, btn). */
export const voiceOptions = Object.entries(CHARACTERS).map(([id, c]) => ({
	id,
	label: c.label,
	emoji: c.emoji,
	mbti: c.mbti,
	btn: c.btn
}));
