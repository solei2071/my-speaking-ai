/**
 * Conversation scenario configurations for context-specific English practice
 */

export const SCENARIOS = {
	// Travel scenarios
	airport: {
		id: 'airport',
		label: '공항',
		emoji: '✈️',
		category: 'travel',
		description: '체크인, 보안검색, 탑승 등 공항 상황',
		instructions:
			'Focus on airport vocabulary and situations: check-in, security screening, boarding, baggage claim, flight delays. Use common airport phrases and help practice realistic airport conversations. Include vocabulary like "boarding pass", "gate", "terminal", "customs", "departure".'
	},
	hotel: {
		id: 'hotel',
		label: '호텔',
		emoji: '🏨',
		category: 'travel',
		description: '호텔 체크인, 문의, 서비스 요청',
		instructions:
			'Focus on hotel situations: checking in/out, room service, amenities, complaints, requests. Practice making reservations, asking about facilities, reporting issues. Include vocabulary like "reservation", "check-in", "room key", "amenities", "housekeeping".'
	},
	tourist: {
		id: 'tourist',
		label: '관광',
		emoji: '🗺️',
		category: 'travel',
		description: '관광지 방문, 길 찾기, 티켓 구매',
		instructions:
			'Focus on tourist activities: asking for directions, buying tickets, visiting attractions, taking tours. Practice questions about locations, prices, opening hours. Include vocabulary like "attraction", "landmark", "guided tour", "admission fee", "directions".'
	},

	// Business scenarios
	interview: {
		id: 'interview',
		label: '면접',
		emoji: '💼',
		category: 'business',
		description: '직무 면접, 자기소개, 질문 답변',
		instructions:
			'Focus on job interview situations: self-introduction, answering behavioral questions, discussing experience and skills, asking about the role. Practice professional language and common interview questions. Include vocabulary like "qualifications", "responsibilities", "teamwork", "achievement", "career goals".'
	},
	meeting: {
		id: 'meeting',
		label: '회의',
		emoji: '📊',
		category: 'business',
		description: '업무 회의, 의견 제시, 토론',
		instructions:
			'Focus on business meeting situations: presenting ideas, agreeing/disagreeing professionally, making suggestions, asking for clarification. Practice formal business communication. Include vocabulary like "agenda", "proposal", "deadline", "strategy", "follow-up".'
	},
	presentation: {
		id: 'presentation',
		label: '프레젠테이션',
		emoji: '📈',
		category: 'business',
		description: '발표 연습, 질의응답',
		instructions:
			'Focus on presentation skills: introducing topics, transitioning between points, emphasizing key information, handling Q&A. Practice clear, confident delivery. Include vocabulary like "overview", "highlight", "data shows", "in conclusion", "any questions".'
	},
	networking: {
		id: 'networking',
		label: '네트워킹',
		emoji: '🤝',
		category: 'business',
		description: '비즈니스 교류, 명함 교환, 스몰토크',
		instructions:
			'Focus on professional networking: introducing yourself, exchanging business cards, making small talk, following up. Practice polite, professional conversation starters. Include vocabulary like "industry", "background", "connect", "opportunity", "collaboration".'
	},

	// Daily life scenarios
	restaurant: {
		id: 'restaurant',
		label: '레스토랑',
		emoji: '🍽️',
		category: 'daily',
		description: '주문, 메뉴 문의, 계산',
		instructions:
			'Focus on restaurant situations: making reservations, ordering food, asking about menu items, requesting changes, paying the bill. Practice polite requests and food vocabulary. Include vocabulary like "appetizer", "main course", "allergy", "bill", "tip".'
	},
	shopping: {
		id: 'shopping',
		label: '쇼핑',
		emoji: '🛍️',
		category: 'daily',
		description: '물건 구매, 가격 협상, 교환/환불',
		instructions:
			'Focus on shopping situations: asking about products, trying things on, comparing prices, returns/exchanges. Practice making purchases and handling issues. Include vocabulary like "size", "color", "discount", "receipt", "refund", "exchange".'
	},
	medical: {
		id: 'medical',
		label: '병원',
		emoji: '🏥',
		category: 'daily',
		description: '증상 설명, 진료 예약, 약 처방',
		instructions:
			'Focus on medical situations: describing symptoms, making appointments, understanding prescriptions, asking about treatment. Practice health-related vocabulary clearly. Include vocabulary like "symptoms", "appointment", "prescription", "medication", "insurance".'
	},
	bank: {
		id: 'bank',
		label: '은행',
		emoji: '🏦',
		category: 'daily',
		description: '계좌 개설, 송금, 금융 문의',
		instructions:
			'Focus on banking situations: opening accounts, making transactions, asking about services, resolving issues. Practice financial vocabulary. Include vocabulary like "account", "transfer", "balance", "deposit", "withdrawal", "interest rate".'
	},

	// Social scenarios
	introduction: {
		id: 'introduction',
		label: '소개/인사',
		emoji: '👋',
		category: 'social',
		description: '자기소개, 첫 만남, 인사',
		instructions:
			'Focus on introductions and greetings: meeting new people, introducing yourself and others, starting conversations. Practice friendly, natural introductions. Include vocabulary like "nice to meet you", "background", "interests", "where are you from", "what do you do".'
	},
	hobbies: {
		id: 'hobbies',
		label: '취미',
		emoji: '🎸',
		category: 'social',
		description: '취미 활동, 여가 시간 대화',
		instructions:
			'Focus on talking about hobbies and interests: discussing activities you enjoy, sharing experiences, making plans. Practice expressing preferences and enthusiasm. Include vocabulary like "passionate about", "in my free time", "I enjoy", "recently started", "favorite activity".'
	},
	opinions: {
		id: 'opinions',
		label: '의견 나누기',
		emoji: '💭',
		category: 'social',
		description: '의견 교환, 찬반 토론',
		instructions:
			'Focus on expressing and discussing opinions: stating your views, agreeing/disagreeing politely, giving reasons, asking for others\' opinions. Practice persuasive yet respectful communication. Include vocabulary like "I think", "in my opinion", "I agree/disagree", "on the other hand", "that\'s a good point".'
	},
	smalltalk: {
		id: 'smalltalk',
		label: '일상 대화',
		emoji: '☕',
		category: 'social',
		description: '날씨, 주말 계획 등 가벼운 대화',
		instructions:
			'Focus on casual small talk: weather, weekend plans, recent events, current activities. Practice natural, friendly conversation. Include vocabulary like "how was your weekend", "the weather", "plans for", "recently", "by the way".'
	}
};

export const SCENARIO_CATEGORIES = {
	travel: { label: '여행', emoji: '✈️', color: 'sky' },
	business: { label: '비즈니스', emoji: '💼', color: 'indigo' },
	daily: { label: '일상', emoji: '🏪', color: 'emerald' },
	social: { label: '사교', emoji: '👥', color: 'rose' }
};

/** Get scenario by id */
export function getScenario(scenarioId) {
	return SCENARIOS[scenarioId] ?? null;
}

/** Get all scenarios as array */
export function getAllScenarios() {
	return Object.values(SCENARIOS);
}

/** Get scenarios grouped by category */
export function getScenariosByCategory() {
	const grouped = {};
	for (const category of Object.keys(SCENARIO_CATEGORIES)) {
		grouped[category] = Object.values(SCENARIOS).filter((s) => s.category === category);
	}
	return grouped;
}

/** Scenario options for UI (similar to voiceOptions) */
export const scenarioOptions = Object.values(SCENARIOS).map((s) => ({
	id: s.id,
	label: s.label,
	emoji: s.emoji,
	category: s.category,
	description: s.description
}));
