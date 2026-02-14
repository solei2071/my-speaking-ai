<script>
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolveRoute } from '$app/paths';
	import { user, authLoading, signOut, onboardingComplete, onboardingLoading } from '$lib/auth.js';
	import { saveMessage, fetchSessions, fetchSessionMessages } from '$lib/conversation.js';
	import { saveSentence, fetchSavedSentences, deleteSavedSentence } from '$lib/savedSentences.js';
	import { getCharacter, getTtsParams, voiceOptionsSorted } from '$lib/characters.js';
	import { supabase } from '$lib/supabase.js';
	import { getScenario, scenarioOptions } from '$lib/scenarios.js';
	import { levelOptions } from '$lib/levels.js';
	import { analyzeSpeech } from '$lib/pronunciation.js';
	import OnboardingModal from '$lib/OnboardingModal.svelte';
	import { checkOnboardingStatus } from '$lib/profile.js';
	import { withTimeout } from '$lib/utils/timeout.js';
	let status = $state('idle');
	let currentSessionId = $state(null);
	let error = $state(null);
	let session = $state(null);
	let currentCharacterName = $state('Tutor');
	let currentCharacterEmoji = $state('');
	let currentCharacterMbti = $state('');
	let currentVoiceId = $state(null);
	let conversationLog = $state([]);
	let selectedScenario = $state(null);
	let showScenarioSelector = $state(false);
	let selectedLevel = $state('intermediate');

	// Mobile tab navigation
	let mobileTab = $state('controls'); // 'controls' | 'chat'

	// Pronunciation feedback (only available with Web Speech API)
	let pronunciationEnabled = $state(true);
	let currentPronunciation = $state(null);
	let pronunciationHistory = $state([]);
	let speechStartTime = $state(0);
	let logContainer = $state(null);
	let sessionStartedAt = $state(0);
	let sessionEndedAt = $state(0);
	let textInput = $state('');
	let inputMode = $state('voice');
	let speechRecognitionSupported = $state(true);

	// Speech recognition for live transcription
	let recognition = $state(null);
	let liveTranscript = $state('');
	let finalTranscript = $state('');
	let isListening = $state(false);
	let isFirefox = $state(false);

	// AI speaking state
	let isSpeaking = $state(false);

	// Word-by-word reveal (syncs text display with speaking pace)
	const CHAR_REVEAL_MS = 25;
	let isRevealing = $state(false);
	let displayedText = $state('');
	let revealTargetText = '';
	let revealInterval = null;
	let revealedCharCount = 0;

	// Auto-send timer
	let autoSendTimer = $state(null);

	// Auto-send mode: 말이 끝나면 자동 전송
	let autoSendEnabled = $state(false);
	let autoSendDelay = 1500; // 침묵 후 자동 전송까지 대기 시간 (ms)
	let autoSendFillerDelay = 3000; // 필러로 끝날 때 더 긴 대기 시간 (ms)
	let autoSendCountdown = $state(0); // 카운트다운 표시용
	let autoSendCountdownInterval = null;

	// 영어 필러(추임새) 패턴
	const FILLER_PATTERNS = [
		/\b(um+|uh+|er+|ah+|hm+|hmm+|umm+|uhh+)\s*\.?$/i,
		/\b(like|you know|i mean|so|well|basically|actually|literally|right)\s*\.?$/i,
		/\b(let me think|let me see|how do i say|what's the word)\s*\.?$/i,
		/\b(it's like|kind of|sort of|i guess|i think)\s*\.?$/i
	];

	function endsWithFiller(text) {
		const trimmed = text.trim();
		return FILLER_PATTERNS.some((pattern) => pattern.test(trimmed));
	}

	let speechSynthesisSupported = $state(true);

	// History view
	let historySessions = $state([]);
	let historyView = $state(null);
	let selectedSession = $state(null);
	let historyMessages = $state([]);
	let historyLoading = $state(false);

	// Saved sentences
	let savedView = $state(false);
	let savedSentences = $state([]);
	let savedLoading = $state(false);
	let savedToast = $state(false);
	let savedMessageIds = $state(new Set());

	// Track which assistant messages we've already saved to DB to prevent duplicates
	let savedToDbSet = new SvelteSet();

	// Cleanup on component unmount
	onDestroy(() => {
		cancelAutoSendCountdown();
		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}
		if (revealInterval) {
			clearInterval(revealInterval);
			revealInterval = null;
		}

		if (recognition) {
			try {
				recognition.stop();
				recognition.onresult = null;
				recognition.onerror = null;
				recognition.onend = null;
			} catch {
				/* ignore */
			}
			recognition = null;
		}

		if (session) {
			try {
				session.close();
			} catch {
				/* ignore */
			}
			session = null;
		}
	});

	// --- Character-by-character reveal ---
	function startReveal(text) {
		revealTargetText = text;
		// If already revealing, just update target — timer picks up new chars
		if (isRevealing && revealInterval) return;

		isRevealing = true;
		revealedCharCount = 0;
		displayedText = '';

		if (revealInterval) clearInterval(revealInterval);
		revealInterval = setInterval(() => {
			if (revealedCharCount < revealTargetText.length) {
				revealedCharCount++;
				displayedText = revealTargetText.slice(0, revealedCharCount);
				requestAnimationFrame(() => {
					if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
				});
			} else if (!isSpeaking) {
				// All chars shown and AI finished — stop
				stopReveal();
			}
			// If isSpeaking, keep timer alive for more chars
		}, CHAR_REVEAL_MS);
	}

	function stopReveal() {
		if (revealInterval) {
			clearInterval(revealInterval);
			revealInterval = null;
		}
		if (revealTargetText) {
			displayedText = revealTargetText;
		}
		isRevealing = false;
		revealedCharCount = 0;
	}

	// Save assistant message to DB, but only once per unique text
	function saveAssistantToDb(text) {
		if (!$user || !currentSessionId || !text?.trim()) return;
		const key = `${currentSessionId}:${text}`;
		if (savedToDbSet.has(key)) return;
		savedToDbSet.add(key);
		saveMessage(
			$user.id,
			currentSessionId,
			currentCharacterName,
			'assistant',
			text,
			currentVoiceId
		).catch((e) => console.warn('[DB] Save failed:', e.message));
	}

	let isRequestingReply = false;
	let activeRequestController = null;

	function buildHistoryForGemini() {
		return conversationLog
			.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isStreaming)
			.map((m) => ({
				role: m.role,
				text: normalizeSessionText(m.text)
			}))
			.filter((m) => m.text)
			.slice(-50);
	}

	function clearActiveUtterance() {
		if (!speechSynthesisSupported || typeof window === 'undefined') return;
		try {
			window.speechSynthesis.cancel();
		} catch {
			/* ignore */
		}
		isSpeaking = false;
	}

	function clampTtsValue(value, min, max, fallback) {
		const num = Number(value);
		if (!Number.isFinite(num)) return fallback;
		return Math.min(max, Math.max(min, num));
	}

	function getPreferredEnglishVoice() {
		if (!speechSynthesisSupported || typeof window === 'undefined') return null;

		const voices = window.speechSynthesis.getVoices() || [];
		if (!voices.length) return null;

		const englishVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
		const candidates = [
			'Google US English',
			'Samantha',
			'Google UK English Female',
			'Google UK English Male'
		];

		for (const preferred of candidates) {
			const exact = englishVoices.find(
				(v) => v.name.toLowerCase() === preferred.toLowerCase() || v.name.includes(preferred)
			);
			if (exact) return exact;
		}

		return (
			englishVoices.find((v) => v.lang === 'en-US') ||
			englishVoices.find((v) => v.lang?.toLowerCase().startsWith('en-')) ||
			englishVoices[0] ||
			null
		);
	}

	async function resolveVoicePreferences() {
		if (!speechSynthesisSupported || typeof window === 'undefined') return null;

		const immediate = getPreferredEnglishVoice();
		if (immediate) return immediate;

		return new Promise((resolve) => {
			const onvoiceschanged = () => {
				window.speechSynthesis.removeEventListener('voiceschanged', onvoiceschanged);
				resolve(getPreferredEnglishVoice());
			};

			window.speechSynthesis.addEventListener('voiceschanged', onvoiceschanged);

			setTimeout(() => {
				window.speechSynthesis.removeEventListener('voiceschanged', onvoiceschanged);
				resolve(getPreferredEnglishVoice());
			}, 300);
		});
	}

	function speakAssistantText(text) {
		return new Promise((resolve) => {
			if (!speechSynthesisSupported || typeof window === 'undefined' || !text) {
				resolve();
				return;
			}

			clearActiveUtterance();

			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = 'en-US';
			const tts = getTtsParams(currentVoiceId);
			utterance.rate = clampTtsValue(tts.rate, 0.5, 2, 1);
			utterance.pitch = clampTtsValue(tts.pitch, 0.5, 2, 1);
			utterance.onstart = () => {
				isSpeaking = true;
			};
			utterance.onend = () => {
				isSpeaking = false;
				resolve();
			};
			utterance.onerror = () => {
				isSpeaking = false;
				resolve();
			};

			try {
				resolveVoicePreferences().then((voice) => {
					if (voice) utterance.voice = voice;
					window.speechSynthesis.speak(utterance);
				});
			} catch {
				isSpeaking = false;
				resolve();
			}
		});
	}

	async function requestGeminiResponse(messageOverride) {
		if (!session || isRequestingReply) return;
		const currentText = normalizeSessionText(messageOverride || getLastUserText());
		if (!currentText) return;

		isRequestingReply = true;
		isSpeaking = true;
		status = 'connected';

		const payload = {
			character: currentVoiceId,
			level: selectedLevel,
			scenario: selectedScenario?.instructions || selectedScenario?.label || '',
			messages: buildHistoryForGemini()
		};

		let controller = new AbortController();
		activeRequestController = controller;
		let authHeader;

		try {
			const {
				data: { session: authSession }
			} = await supabase.auth.getSession();
			authHeader = authSession?.access_token ? `Bearer ${authSession.access_token}` : undefined;
		} catch {
			authHeader = undefined;
		}

		try {
			const headers = {
				'Content-Type': 'application/json',
				...(authHeader ? { Authorization: authHeader } : {})
			};

			const res = await withTimeout(
				fetch('/api/gemini-chat', {
					method: 'POST',
					headers,
					body: JSON.stringify(payload),
					signal: controller.signal
				}),
				15000,
				'AI response'
			);
			activeRequestController = null;

			let data = {};
			try {
				data = await res.json();
			} catch {
				data = {};
			}

			if (!res.ok) {
				if (res.status === 401) {
					throw new Error('로그인이 필요합니다');
				}
				if (res.status === 429) {
					throw new Error('일일 한도 초과');
				}
				throw new Error(data?.error || data?.message || '응답 실패');
			}

			const reply = normalizeSessionText(data?.text);
			if (!reply) {
				throw new Error('AI 응답이 비었습니다');
			}

			// Remove temporary states and persist assistant reply
			isRevealing = false;
			revealTargetText = '';
			const last = conversationLog[conversationLog.length - 1];
			if (last?.isStreaming) {
				conversationLog = [
					...conversationLog.slice(0, -1),
					nowLogMessage({ role: 'assistant', text: reply })
				];
			} else {
				conversationLog = [...conversationLog, nowLogMessage({ role: 'assistant', text: reply })];
			}
			saveAssistantToDb(reply);
			revealTargetText = reply;
			startReveal(reply);
			requestAnimationFrame(() => {
				if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
			});

			await speakAssistantText(reply);
		} catch (e) {
			if (e?.name === 'AbortError') return;
			error = e?.message || 'AI 응답 처리 중 문제가 발생했습니다.';
			status = 'error';
			console.error('Gemini request error:', e);
		} finally {
			isRequestingReply = false;
			activeRequestController = null;
			isSpeaking = false;
		}
	}

	function getLastUserText() {
		for (let i = conversationLog.length - 1; i >= 0; i--) {
			if (conversationLog[i]?.role === 'user' && conversationLog[i]?.text?.trim()) {
				return conversationLog[i].text.trim();
			}
		}
		return '';
	}

	function closeGeminiSession() {
		if (activeRequestController) {
			activeRequestController.abort();
			activeRequestController = null;
		}
		clearActiveUtterance();
		isRequestingReply = false;
	}

	async function connect(voice) {
		status = 'connecting';
		error = null;
		conversationLog = [];
		savedToDbSet = new SvelteSet();
		savedMessageIds = new Set();
		sessionStartedAt = Date.now();
		sessionEndedAt = 0;
		currentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		currentVoiceId = voice;

		try {
			const character = getCharacter(voice);
			currentCharacterName = character.label;
			currentCharacterEmoji = character.emoji;
			currentCharacterMbti = character.mbti ?? '';

			const speechSupported = initSpeechRecognition();
			inputMode = speechSupported ? 'voice' : 'text';
			speechSynthesisSupported =
				typeof window !== 'undefined' &&
				typeof window.speechSynthesis !== 'undefined' &&
				typeof window.SpeechSynthesisUtterance !== 'undefined';

			session = {
				muted: !speechSupported,
				mute: (value) => {
					session = { ...session, muted: Boolean(value) };
				},
				sendMessage: async (message) => {
					await requestGeminiResponse(message);
				},
				close: () => {
					closeGeminiSession();
				}
			};
			status = 'connected';
			mobileTab = 'chat';
		} catch (e) {
			status = 'error';
			const errorMsg = e?.message || '연결에 실패했습니다. 다시 시도해주세요.';
			if (errorMsg.includes('timed out')) {
				error = '연결이 너무 오래 걸립니다. 인터넷 연결을 확인해주세요.';
			} else if (errorMsg.includes('API key') || errorMsg.includes('Unauthorized')) {
				error = 'API 키 오류입니다. 설정을 확인해주세요.';
			} else if (errorMsg.includes('quota') || errorMsg.includes('limit')) {
				error = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
			} else {
				error = errorMsg;
			}
			console.error('Connection error:', e);
		}
	}

	let disconnectMessage = $state('');
	let sessionSummary = $state(null);
	const SCORE_RING_RADIUS = 56;
	const SCORE_RING_CIRCUMFERENCE = 2 * Math.PI * SCORE_RING_RADIUS;
	const TARGET_WPM = 130;
	const MIN_ENGAGEMENT_RATIO = 0.5;
	const MAX_ENGAGEMENT_RATIO = 1.35;

	function nowLogMessage(entry) {
		return {
			createdAt: Date.now(),
			...entry
		};
	}

	function normalizeSessionText(text) {
		return (text || '').trim();
	}

	function formatSessionDuration(seconds) {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}분 ${String(secs).padStart(2, '0')}초`;
	}

	function normalize01(value, min, max) {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(1, (value - min) / (max - min)));
	}

	function scoreFromSpeed(avgWordsPerMinute) {
		if (!Number.isFinite(avgWordsPerMinute) || avgWordsPerMinute <= 0) return 65;
		const ratio = avgWordsPerMinute / TARGET_WPM;
		const idealRangeScore = 100 - Math.abs(1 - ratio) * 100;
		return Math.round(Math.max(25, Math.min(100, idealRangeScore)));
	}

	function scoreFromRatio(count, base) {
		if (base <= 0) {
			return count <= 0 ? 20 : 45;
		}
		const ratio = count / base;
		let score = ratio >= MAX_ENGAGEMENT_RATIO ? 0 : Math.round(100 - (ratio - 1) * 45);
		if (ratio <= MIN_ENGAGEMENT_RATIO) {
			score = Math.round(100 * normalize01(ratio, 0, MIN_ENGAGEMENT_RATIO));
		}
		return Math.max(0, Math.min(100, score));
	}

	function scoreBand(score) {
		if (score >= 90) {
			return {
				label: 'Excellent',
				level: 'excellent',
				gradient: 'from-emerald-300 via-emerald-400 to-emerald-500'
			};
		}
		if (score >= 75) {
			return {
				label: 'Great',
				level: 'great',
				gradient: 'from-sky-300 via-cyan-400 to-blue-500'
			};
		}
		if (score >= 60) {
			return {
				label: 'Good',
				level: 'good',
				gradient: 'from-amber-300 via-yellow-400 to-orange-500'
			};
		}
		return {
			label: 'Focus',
			level: 'focus',
			gradient: 'from-rose-300 via-red-400 to-pink-500'
		};
	}

	function getScoreSummaryInsights({
		questionCount,
		answerCount,
		avgWordsPerMinute,
		avgClarity,
		interactionScore
	}) {
		const strengths = [];
		const improvements = [];

		if (questionCount >= 1 && answerCount >= questionCount) {
			strengths.push('대화 흐름이 안정적입니다. 질문에 꾸준히 답했고요.');
		}
		if (avgClarity >= 85) {
			strengths.push('발음 명확도가 높아 AI가 잘 이해한 구간이 많았습니다.');
		}
		if (avgWordsPerMinute >= 90 && avgWordsPerMinute <= 150) {
			strengths.push('발화 속도가 자연스러워요. 과도하게 빠르거나 느리지 않습니다.');
		}

		if (questionCount === 0) {
			improvements.push('AI의 질문이 오지 않았더라도 직접 질문을 1~2개 던져보세요.');
		}
		if (avgWordsPerMinute < 70) {
			improvements.push('발화 속도가 느린 편이라 표현이 짧게 끊겨 들릴 수 있어요.');
		}
		if (avgWordsPerMinute > 170) {
			improvements.push('호흡을 조금 늦춰 말하면 더 또렷하게 전달돼요.');
		}
		if (interactionScore <= 65) {
			improvements.push('문장 하나당 더 완결된 답변으로 응답해보면 점수가 더 좋아집니다.');
		}
		if (avgClarity < 70) {
			improvements.push('발음/명확도 피드백을 보고 약한 발음부터 개선해보세요.');
		}

		return {
			strengths,
			improvements
		};
	}

	function buildSessionSummary() {
		const userMsgs = conversationLog.filter((m) => m.role === 'user');
		const aiMsgs = conversationLog.filter((m) => m.role === 'assistant');
		const totalMessages = conversationLog.length;
		const userWordCount = userMsgs.reduce(
			(sum, m) => sum + (normalizeSessionText(m.text).split(/\s+/).filter(Boolean).length || 0),
			0
		);

		const questionCount = aiMsgs.reduce(
			(sum, msg) => sum + ((msg.text || '').match(/\?/g)?.length || 0),
			0
		);
		const answerCount = userMsgs.length;
		const durationMs = Math.max(
			1,
			(sessionEndedAt || Date.now()) - (sessionStartedAt || Date.now())
		);
		const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
		const avgWordsPerMinute = Math.round((userWordCount / durationMs) * 60000);
		const speedScore = scoreFromSpeed(avgWordsPerMinute);

		const interactionScore = scoreFromRatio(answerCount, questionCount);

		// Extract useful expressions from AI messages (sentences with quotes or "could also say")
		const expressions = [];
		for (const msg of aiMsgs) {
			const text = msg.text || '';
			// Match paraphrase suggestions
			const matches = text.match(
				/(?:could also say|more naturally|another way|you could say)[:\s]*["']?([^"'\n.!?]+[.!?]?)/gi
			);
			if (matches) {
				for (const m of matches.slice(0, 3)) {
					const clean = m
						.replace(/^(?:could also say|more naturally|another way|you could say)[:\s]*["']?/i, '')
						.replace(/["']$/, '')
						.trim();
					if (clean.length > 5 && clean.length < 120) expressions.push(clean);
				}
			}
		}

		// Deduplicate
		const uniqueExpressions = [...new Set(expressions)].slice(0, 5);

		// Pronunciation average
		const pronScores = conversationLog
			.filter((m) => m.pronunciation?.clarityScore)
			.map((m) => m.pronunciation.clarityScore);
		const avgClarity =
			pronScores.length > 0
				? Math.round(pronScores.reduce((a, b) => a + b, 0) / pronScores.length)
				: 75;
		const clarityScore = pronScores.length > 0 ? avgClarity : 75;
		const { strengths, improvements } = getScoreSummaryInsights({
			questionCount,
			answerCount,
			avgWordsPerMinute,
			avgClarity: clarityScore,
			interactionScore
		});

		const scoreItems = [
			totalMessages ? clarityScore : 0,
			totalMessages ? speedScore : 45,
			totalMessages ? interactionScore : 30,
			totalMessages
				? questionCount > 0
					? Math.min(100, Math.round((answerCount / questionCount) * 100))
					: 90
				: 0
		];
		const overallScore = Math.max(
			0,
			Math.round(scoreItems.reduce((a, b) => a + b, 0) / scoreItems.length)
		);
		const scoreMeta = scoreBand(overallScore);
		const scoreStrokeOffset = SCORE_RING_CIRCUMFERENCE * (1 - overallScore / 100);

		return {
			totalMessages,
			userMessages: userMsgs.length,
			aiMessages: aiMsgs.length,
			userWordCount,
			questionCount,
			answerCount,
			durationSeconds,
			avgWordsPerMinute,
			overallScore,
			speedScore,
			interactionScore,
			clarityScore,
			scoreMeta,
			scoreStrokeOffset,
			strengths,
			improvements,
			expressions: uniqueExpressions,
			character: currentCharacterName,
			characterEmoji: currentCharacterEmoji,
			characterMbti: currentCharacterMbti,
			level: selectedLevel
		};
	}

	function disconnect() {
		stopListening();
		cancelAutoSendCountdown();

		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}

		sessionEndedAt = Date.now();

		// Build summary before clearing state
		sessionSummary = buildSessionSummary();

		liveTranscript = '';
		finalTranscript = '';
		isSpeaking = false;
		stopReveal();

		if (session) {
			try {
				session.close();
			} catch {
				/* ignore */
			}
			session = null;
		}

		currentSessionId = null;
		currentVoiceId = null;

		status = 'disconnected';
		disconnectMessage = 'Connection closed. No more API calls.';
	}

	function dismissSummary() {
		sessionSummary = null;
		status = 'idle';
		sessionStartedAt = 0;
		sessionEndedAt = 0;
		disconnectMessage = '';
		error = null;
	}

	async function safeSendMessage(msg) {
		if (!session) return false;
		try {
			await session.sendMessage(msg);
			return true;
		} catch (e) {
			error = e?.message ?? 'Failed to send message.';
			status = 'error';
			session = null;
			return false;
		}
	}

	async function sendText() {
		const text = textInput.trim();
		if (!text || !session) return;

		stopReveal();
		conversationLog = [...conversationLog, nowLogMessage({ role: 'user', text })];
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});

		if ($user && currentSessionId) {
			saveMessage(
				$user.id,
				currentSessionId,
				currentCharacterName,
				'user',
				text,
				currentVoiceId
			).catch((e) => console.warn('[DB] Save failed:', e.message));
		}

		const sent = await safeSendMessage(text);
		if (sent) textInput = '';
	}

	function setInputMode(mode) {
		inputMode = mode;

		if (mode === 'voice') {
			if (session?.muted !== null) {
				session.mute(true);
			}
		} else if (mode === 'text') {
			if (session?.muted !== null) session.mute(true);
			stopListening();
			liveTranscript = '';
			finalTranscript = '';
		}
	}

	function toggleMic() {
		if (!speechRecognitionSupported) {
			error = '음성 인식이 지원되지 않아 자동 음성 입력을 사용할 수 없습니다.';
			return;
		}

		if (isListening) {
			stopListening();
		} else {
			startListening();
		}
	}

	function hasUserMessage() {
		return conversationLog.some((m) => m.role === 'user');
	}

	async function sendHelperMessage(text, label) {
		if (!session) return;
		conversationLog = [...conversationLog, nowLogMessage({ role: 'user', text: `[${label}]` })];
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});
		if ($user && currentSessionId) {
			saveMessage(
				$user.id,
				currentSessionId,
				currentCharacterName,
				'user',
				`[${label}]`,
				currentVoiceId
			).catch((e) => console.warn('[DB] Save failed:', e.message));
		}
		await safeSendMessage(text);
	}

	function requestGrammarCorrection() {
		sendHelperMessage(
			'Please correct the grammar and spelling in my previous message. Give me the corrected version and briefly explain any mistakes.',
			'Adjust grammar'
		);
	}

	function requestParaphrase() {
		sendHelperMessage(
			'Please paraphrase my previous message into more natural English. Give me a few alternative versions if possible.',
			'Paraphrase'
		);
	}

	function requestRandomQuestion() {
		sendHelperMessage(
			'Please ask me a random question to practice English conversation. Pick a fun, interesting topic (e.g. hobbies, travel, food, opinions, hypotheticals). Just ask the question directly—no grammar correction or paraphrase needed.',
			'Random question'
		);
	}

	function initSpeechRecognition() {
		if (typeof window === 'undefined') return false;

		// Detect Firefox
		isFirefox =
			typeof window !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');

		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SpeechRecognition) {
			// Auto-switch to text mode if speech recognition is not supported
			speechRecognitionSupported = false;
			inputMode = 'text';
			console.warn('Speech recognition not available. Switched to text mode.');
			return false;
		}

		speechRecognitionSupported = true;

		recognition = new SpeechRecognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = 'en-US';

		recognition.onresult = (event) => {
			let interim = '';
			let final = finalTranscript;
			let confidenceSum = 0;
			let confidenceCount = 0;
			const wordResults = [];

			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i][0];
				const transcript = result.transcript;
				const confidence = result.confidence || 0;

				if (event.results[i].isFinal) {
					final += transcript + ' ';
					confidenceSum += confidence;
					confidenceCount++;

					// Store word-level results for pronunciation analysis
					const words = transcript.trim().split(/\s+/);
					words.forEach((word) => {
						wordResults.push({ word, confidence });
					});
				} else {
					interim += transcript;
				}
			}
			finalTranscript = final;
			liveTranscript = final + interim;

			// Analyze pronunciation if enabled and we have final results
			if (pronunciationEnabled && confidenceCount > 0 && final.trim()) {
				try {
					const avgConfidence = confidenceSum / confidenceCount;
					const duration = Date.now() - speechStartTime;
					const analysis = analyzeSpeech(final.trim(), avgConfidence, duration, wordResults);
					currentPronunciation = analysis;
				} catch (e) {
					console.warn('Pronunciation analysis failed:', e);
					currentPronunciation = null;
				}
			}

			// "send it" 음성 명령 감지
			const lowerText = liveTranscript.toLowerCase().trim();
			if (lowerText.endsWith('send it') || lowerText.endsWith('send it.')) {
				cancelAutoSendCountdown();
				if (autoSendTimer) clearTimeout(autoSendTimer);
				autoSendTimer = setTimeout(() => {
					if (liveTranscript.trim()) {
						const cleanText = liveTranscript.replace(/send it\.?$/i, '').trim();
						if (cleanText) {
							liveTranscript = cleanText;
							finalTranscript = cleanText;
							sendVoiceMessage();
						}
					}
				}, 2000);
			} else {
				if (autoSendTimer) {
					clearTimeout(autoSendTimer);
					autoSendTimer = null;
				}
				// Auto Send 모드: 말이 들어올 때마다 타이머 리셋
				if (autoSendEnabled && liveTranscript.trim()) {
					startAutoSendCountdown();
				}
			}
		};

		recognition.onerror = (event) => {
			const err = event.error;
			if (err === 'not-allowed' || err === 'service-not-allowed') {
				error = 'Microphone access denied. Please allow microphone access and refresh the page.';
				isListening = false;
			} else if (err === 'network') {
				error = 'Network error. Please check your internet connection.';
				isListening = false;
			} else if (err !== 'no-speech' && err !== 'aborted') {
				console.error('Speech recognition error:', err);
			}
		};

		recognition.onend = () => {
			if (isListening && recognition) {
				try {
					recognition.start();
				} catch {
					/* ignore */
				}
			}
		};

		return true;
	}

	function startListening() {
		if (!speechRecognitionSupported) {
			error = '음성 인식이 지원되지 않아 마이크 입력을 사용할 수 없습니다.';
			return;
		}

		// For browsers with Web Speech API
		if (!recognition) {
			const supported = initSpeechRecognition();
			if (!supported) {
				console.warn('Cannot start listening: Speech recognition not supported');
				return;
			}
		}
		if (!recognition) return;

		finalTranscript = '';
		liveTranscript = '';
		speechStartTime = Date.now();
		currentPronunciation = null;

		try {
			recognition.stop();
		} catch {
			/* ignore */
		}

		setTimeout(() => {
			isListening = true;
			try {
				recognition.start();
			} catch {
				/* ignore */
			}
		}, 50);
	}

	function stopListening() {
		isListening = false;
		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}

		if (recognition) {
			try {
				recognition.stop();
			} catch {
				/* ignore */
			}
		}
	}

	async function sendVoiceMessage() {
		const text = liveTranscript.trim();
		if (!text || !session) return;

		stopReveal();
		const wasListening = isListening;
		if (recognition) {
			try {
				recognition.stop();
			} catch {
				/* ignore */
			}
		}
		isListening = false;

		liveTranscript = '';
		finalTranscript = '';

		// Include pronunciation data in message
		const messageData = nowLogMessage({ role: 'user', text });
		if (pronunciationEnabled && currentPronunciation) {
			messageData.pronunciation = currentPronunciation;
			pronunciationHistory = [...pronunciationHistory, currentPronunciation];
		}

		conversationLog = [...conversationLog, messageData];
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});

		if ($user && currentSessionId) {
			saveMessage(
				$user.id,
				currentSessionId,
				currentCharacterName,
				'user',
				text,
				currentVoiceId
			).catch((e) => console.warn('[DB] Save failed:', e.message));
		}

		await safeSendMessage(text);

		if (wasListening) {
			setTimeout(() => startListening(), 100);
		}
	}

	function clearTranscript() {
		liveTranscript = '';
		finalTranscript = '';
		cancelAutoSendCountdown();
	}

	/** Auto Send 카운트다운 시작/리셋 */
	function startAutoSendCountdown() {
		// AI가 말하는 중에는 자동 전송하지 않음
		if (isSpeaking) return;

		cancelAutoSendCountdown();

		// 필러(추임새)로 끝나면 더 긴 딜레이 적용
		const hasFiller = endsWithFiller(liveTranscript);
		const delay = hasFiller ? autoSendFillerDelay : autoSendDelay;
		autoSendCountdown = Math.ceil(delay / 1000);

		autoSendCountdownInterval = setInterval(() => {
			autoSendCountdown -= 1;
			if (autoSendCountdown <= 0) {
				// 카운트다운 UI만 정리 (전송 타이머는 건드리지 않음)
				if (autoSendCountdownInterval) {
					clearInterval(autoSendCountdownInterval);
					autoSendCountdownInterval = null;
				}
				autoSendCountdown = 0;
			}
		}, 1000);

		autoSendTimer = setTimeout(() => {
			// 카운트다운 UI 정리
			if (autoSendCountdownInterval) {
				clearInterval(autoSendCountdownInterval);
				autoSendCountdownInterval = null;
			}
			autoSendCountdown = 0;
			autoSendTimer = null;
			if (liveTranscript.trim() && autoSendEnabled && !isSpeaking) {
				sendVoiceMessage();
			}
		}, delay);
	}

	/** Auto Send 카운트다운 취소 (사용자가 직접 취소하거나 새 입력이 들어올 때) */
	function cancelAutoSendCountdown() {
		if (autoSendCountdownInterval) {
			clearInterval(autoSendCountdownInterval);
			autoSendCountdownInterval = null;
		}
		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}
		autoSendCountdown = 0;
	}

	/** Auto Send 토글 */
	function toggleAutoSend() {
		autoSendEnabled = !autoSendEnabled;
		if (!autoSendEnabled) {
			cancelAutoSendCountdown();
		}
	}

	async function loadHistory() {
		if (!$user) return;
		historyLoading = true;
		historyView = 'list';
		historySessions = await fetchSessions($user.id);
		historyLoading = false;
	}

	async function viewSession(sess) {
		if (!$user) return;
		historyLoading = true;
		selectedSession = sess;
		historyMessages = await fetchSessionMessages($user.id, sess.session_id);
		historyView = 'detail';
		historyLoading = false;
	}

	function backToHistoryList() {
		selectedSession = null;
		historyView = 'list';
	}

	function backToMain() {
		historyView = null;
		savedView = false;
		historySessions = [];
		selectedSession = null;
		historyMessages = [];
	}

	async function handleSaveSentence(msg, index) {
		if (!$user || msg.isStreaming || savedMessageIds.has(index)) return;
		try {
			await saveSentence(
				$user.id,
				msg.text,
				currentCharacterName,
				currentVoiceId,
				currentSessionId
			);
			savedMessageIds = new Set([...savedMessageIds, index]);
			savedToast = true;
			setTimeout(() => (savedToast = false), 2000);
		} catch (e) {
			console.error('[SavedSentences] Failed to save:', e);
		}
	}

	async function loadSaved() {
		if (!$user) return;
		savedLoading = true;
		savedView = true;
		historyView = null;
		savedSentences = await fetchSavedSentences($user.id);
		savedLoading = false;
	}

	async function handleDeleteSaved(sentenceId) {
		if (!$user) return;
		try {
			await deleteSavedSentence($user.id, sentenceId);
			savedSentences = savedSentences.filter((s) => s.id !== sentenceId);
		} catch (e) {
			console.error('[SavedSentences] Failed to delete:', e);
		}
	}
</script>

<div class="app-shell h-screen overflow-hidden flex flex-col lg:flex-row">
	<!-- Mobile Tab Bar (visible only on small screens) -->
	{#if status === 'connected'}
		<div class="flex lg:hidden border-b border-stone-200 bg-white shrink-0">
			<button
				onclick={() => (mobileTab = 'controls')}
				class="flex-1 py-3 text-sm font-medium text-center transition-colors border-b-2
					{mobileTab === 'controls'
					? 'border-emerald-500 text-emerald-700 bg-emerald-50/50'
					: 'border-transparent text-stone-500 hover:text-stone-700'}"
			>
				Controls
			</button>
			<button
				onclick={() => (mobileTab = 'chat')}
				class="flex-1 py-3 text-sm font-medium text-center transition-colors border-b-2
					{mobileTab === 'chat'
					? 'border-emerald-500 text-emerald-700 bg-emerald-50/50'
					: 'border-transparent text-stone-500 hover:text-stone-700'}"
			>
				Chat
				{#if conversationLog.length > 0}
					<span class="ml-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] rounded-full">
						{conversationLog.length}
					</span>
				{/if}
			</button>
		</div>
	{/if}

	<!-- Left: Controls + Input -->
	<aside
		class="h-full flex flex-col bg-white border-r border-stone-200 p-6 sm:p-10 lg:p-12 overflow-y-auto shrink-0 market-panel market-enter
				lg:w-[520px] lg:block
				{status === 'connected' && mobileTab !== 'controls' ? 'hidden lg:flex' : 'flex-1 lg:flex-none'}"
	>
		<div class="flex-1">
			<!-- User Auth Section -->
			{#if $authLoading}
				<div class="mb-6 flex items-center gap-2 text-stone-400 text-sm">
					<div
						class="w-4 h-4 border-2 border-stone-300 border-t-transparent rounded-full animate-spin"
					></div>
					Loading...
				</div>
			{:else if $user}
				<div class="mb-8 p-4 bg-stone-50 rounded-xl border border-stone-100">
					<div class="flex items-center gap-3 mb-3">
						<div class="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center">
							<span class="text-pink-600 text-base font-medium">
								{($user.user_metadata?.name || $user.email)?.[0]?.toUpperCase() || '?'}
							</span>
						</div>
						<div>
							<p class="font-medium text-stone-700">{$user.user_metadata?.name || 'User'}</p>
							<p class="text-xs text-stone-400">{$user.email}</p>
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							onclick={() => (historyView || savedView ? backToMain() : loadHistory())}
							class="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors border border-stone-200"
						>
							{historyView || savedView ? '← Back' : 'History'}
						</button>
						{#if !savedView}
							<button
								onclick={loadSaved}
								class="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors border border-stone-200"
							>
								Saved
							</button>
						{/if}
						<a
							href={resolveRoute('/analytics')}
							class="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors border border-stone-200"
						>
							Analytics
						</a>
						<button
							onclick={() => signOut()}
							class="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors border border-stone-200"
						>
							Logout
						</button>
					</div>
				</div>
			{:else}
				<div class="mb-3">
					<div class="flex gap-2">
						<a
							href={resolveRoute('/login')}
							class="flex-1 py-2.5 text-center rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm font-medium transition-colors"
						>
							Log in
						</a>
						<a
							href={resolveRoute('/signup')}
							class="flex-1 py-2.5 text-center rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium transition-colors"
						>
							Sign up
						</a>
					</div>
					<p class="text-center text-xs text-stone-400 mt-2">
						Login to save your progress, track analytics, and access all features
					</p>
				</div>
			{/if}

			<h1 class="text-3xl font-bold text-stone-900 tracking-tight mb-3 mt-4">
				Your personal English tutor
			</h1>
			<p class="text-stone-500 text-base leading-relaxed mb-12">
				Practice with a tutor who corrects your grammar, suggests better expressions, and keeps the
				conversation flowing naturally.
			</p>

			{#if error}
				<div class="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">
					{error}
				</div>
			{/if}

			{#if status === 'idle'}
				<!-- Difficulty Level Selector -->
				<div class="mb-6">
					<p class="text-stone-600 text-base mb-3">Your level</p>
					<div class="flex gap-2">
						{#each levelOptions as level (level.id)}
							<button
								onclick={() => (selectedLevel = level.id)}
								class="flex-1 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all text-center
									{selectedLevel === level.id
									? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm'
									: 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50'}"
							>
								<span class="text-base">{level.emoji}</span>
								<span class="block text-xs mt-0.5">{level.label}</span>
								<span class="block text-[10px] text-stone-400">{level.sublabel}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Scenario Selector -->
				<div class="mb-6">
					<p class="text-stone-600 text-base mb-3">Choose a scenario (optional)</p>
					<div class="flex items-center gap-2">
						<button
							onclick={() => (showScenarioSelector = !showScenarioSelector)}
							class="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm font-medium transition-all
								{selectedScenario
								? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
								: 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}"
						>
							<span class="text-base">{selectedScenario?.emoji || '🎯'}</span>
							<span class="truncate flex-1 text-left"
								>{selectedScenario ? selectedScenario.label : 'Choose scenario'}</span
							>
							<svg
								class="w-4 h-4 transition-transform {showScenarioSelector ? 'rotate-180' : ''}"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 9l-7 7-7-7"
								/>
							</svg>
						</button>
						{#if selectedScenario}
							<button
								onclick={() => (selectedScenario = null)}
								class="p-2.5 rounded-lg border border-stone-200 text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-all"
								title="Clear scenario"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						{/if}
					</div>

					{#if showScenarioSelector}
						<div
							class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200"
						>
							{#each scenarioOptions as scenario (scenario.id)}
								<button
									onclick={() => {
										selectedScenario = getScenario(scenario.id);
										showScenarioSelector = false;
									}}
									class="py-2 px-3 rounded-lg border transition-all text-sm font-medium text-left
										{selectedScenario?.id === scenario.id
										? 'border-emerald-500 bg-emerald-100 text-emerald-700'
										: 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-100'}"
								>
									<span class="mr-1.5">{scenario.emoji}</span>
									{scenario.label}
								</button>
							{/each}
						</div>
					{/if}

					{#if selectedScenario}
						<div class="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
							<p class="text-emerald-900 font-medium text-sm mb-1">
								{selectedScenario.emoji}
								{selectedScenario.label}
							</p>
							<p class="text-emerald-700 text-xs">{selectedScenario.description}</p>
						</div>
					{/if}
				</div>

				<!-- Animated header -->
				<div class="mb-4 overflow-hidden">
					<p class="text-stone-600 text-base animate-slide-in-left">Let's start with...</p>
				</div>

				<!-- Character grid - I on left, E on right -->
				<div class="grid grid-cols-2 gap-4">
					<!-- Left column - Introverts (I) -->
					<div class="space-y-2">
						<p class="text-xs font-medium text-stone-500 mb-2 text-center">Introverts (I)</p>
						{#each voiceOptionsSorted[0].chars as char (char.id)}
							<button
								onclick={() => connect(char.id)}
								class="w-full py-3 rounded-xl {char.btn} text-white font-medium text-sm transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-1.5"
							>
								{char.label}
								{char.emoji} ({char.mbti})
							</button>
						{/each}
					</div>

					<!-- Right column - Extroverts (E) -->
					<div class="space-y-2">
						<p class="text-xs font-medium text-stone-500 mb-2 text-center">Extroverts (E)</p>
						{#each voiceOptionsSorted[1].chars as char (char.id)}
							<button
								onclick={() => connect(char.id)}
								class="w-full py-3 rounded-xl {char.btn} text-white font-medium text-sm transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-1.5"
							>
								{char.label}
								{char.emoji} ({char.mbti})
							</button>
						{/each}
					</div>
				</div>
				<p class="text-stone-400 text-xs mt-4 text-center">
					Allow mic access and you're good to go!
				</p>
			{:else if status === 'connecting'}
				<div class="flex flex-col items-center gap-4 py-12">
					<div
						class="w-10 h-10 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"
					></div>
					<p class="text-stone-500 text-sm">Connecting...</p>
				</div>
			{:else if status === 'disconnected'}
				<div class="flex flex-col items-center gap-4 py-12">
					<div class="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center">
						<svg
							class="w-8 h-8 text-stone-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							/>
						</svg>
					</div>
					<div class="text-center">
						<p class="text-stone-700 font-medium text-sm">
							{sessionSummary ? '세션이 종료되어 요약이 준비되었습니다.' : 'Disconnected'}
						</p>
						<p class="text-stone-500 text-xs mt-1">{disconnectMessage}</p>
					</div>
					<button
						onclick={dismissSummary}
						class="px-6 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 text-sm font-medium transition-colors"
					>
						Back to home
					</button>
				</div>
			{:else if status === 'error'}
				<div class="space-y-4">
					<p class="text-stone-600 text-sm mb-3">
						Connection was lost or an error occurred. Choose a voice to start a new conversation.
					</p>

					<!-- Character grid - I on left, E on right -->
					<div class="grid grid-cols-2 gap-3 max-h-[420px] overflow-y-auto">
						<!-- Left column - Introverts (I) -->
						<div class="space-y-1.5">
							<p
								class="text-xs font-medium text-stone-400 mb-1.5 text-center sticky top-0 bg-white py-1"
							>
								I
							</p>
							{#each voiceOptionsSorted[0].chars as char (char.id)}
								<button
									onclick={() => connect(char.id)}
									class="w-full py-2 rounded-lg {char.btn} text-white font-medium text-xs transition-all flex items-center justify-center gap-1"
								>
									{char.label}
									{char.emoji}
								</button>
							{/each}
						</div>

						<!-- Right column - Extroverts (E) -->
						<div class="space-y-1.5">
							<p
								class="text-xs font-medium text-stone-400 mb-1.5 text-center sticky top-0 bg-white py-1"
							>
								E
							</p>
							{#each voiceOptionsSorted[1].chars as char (char.id)}
								<button
									onclick={() => connect(char.id)}
									class="w-full py-2 rounded-lg {char.btn} text-white font-medium text-xs transition-all flex items-center justify-center gap-1"
								>
									{char.label}
									{char.emoji}
								</button>
							{/each}
						</div>
					</div>
				</div>
			{:else if status === 'connected'}
				<div class="space-y-6">
					<!-- Browser compatibility notice -->
					{#if !speechRecognitionSupported && isFirefox}
						<div class="p-3 rounded-lg bg-blue-50 border border-blue-200">
							<p class="text-blue-800 text-sm font-medium mb-1">🦊 Firefox Voice Mode</p>
							<p class="text-blue-700 text-xs">
								Voice chat works in Firefox! Note: Live transcription and pronunciation analysis are
								only available in Chrome, Edge, or Safari.
							</p>
						</div>
					{:else if !speechRecognitionSupported}
						<div class="p-3 rounded-lg bg-amber-50 border border-amber-200">
							<p class="text-amber-800 text-sm font-medium mb-1">🎤 Limited voice support</p>
							<p class="text-amber-700 text-xs">
								Voice chat is available, but live transcription requires Chrome, Edge, or Safari.
								Text mode recommended for this browser.
							</p>
						</div>
					{/if}

					<!-- Voice / Text mode toggle -->
					<div class="flex rounded-xl bg-stone-100 p-1">
						<button
							onclick={() => setInputMode('voice')}
							class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
								{inputMode === 'voice'
								? 'bg-white text-stone-900 shadow-sm'
								: 'text-stone-500 hover:text-stone-700'}"
							title={!speechRecognitionSupported
								? 'Voice works, but without live transcription'
								: ''}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z"
								/>
							</svg>
							Voice
						</button>
						<button
							onclick={() => setInputMode('text')}
							class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
								{inputMode === 'text'
								? 'bg-white text-stone-900 shadow-sm'
								: 'text-stone-500 hover:text-stone-700'}"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
								/>
							</svg>
							Text
						</button>
					</div>

					<!-- Scenario Selector (Connected State) -->
					<div class="flex items-center gap-2">
						<button
							onclick={() => (showScenarioSelector = !showScenarioSelector)}
							class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-all
								{selectedScenario
								? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
								: 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}"
						>
							<span class="text-base">{selectedScenario?.emoji || '🎯'}</span>
							<span class="truncate"
								>{selectedScenario ? selectedScenario.label : 'Choose scenario'}</span
							>
							<svg
								class="w-4 h-4 transition-transform {showScenarioSelector ? 'rotate-180' : ''}"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 9l-7 7-7-7"
								/>
							</svg>
						</button>
						{#if selectedScenario}
							<button
								onclick={() => (selectedScenario = null)}
								class="p-2 rounded-lg border border-stone-200 text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-all"
								title="Clear scenario"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						{/if}
					</div>

					{#if showScenarioSelector}
						<div
							class="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200"
						>
							{#each scenarioOptions as scenario (scenario.id)}
								<button
									onclick={() => {
										selectedScenario = getScenario(scenario.id);
										showScenarioSelector = false;
									}}
									class="py-2 px-3 rounded-lg border transition-all text-sm font-medium text-left
										{selectedScenario?.id === scenario.id
										? 'border-emerald-500 bg-emerald-100 text-emerald-700'
										: 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-100'}"
								>
									<span class="mr-1.5">{scenario.emoji}</span>
									{scenario.label}
								</button>
							{/each}
						</div>
					{/if}

					{#if inputMode === 'voice'}
						<div
							class="rounded-2xl border p-5 flex flex-col gap-4 {isListening
								? 'bg-emerald-50 border-emerald-100'
								: 'bg-stone-50 border-stone-200'}"
						>
							<div class="flex items-center gap-3">
								{#if isListening}
									<div class="relative">
										<div
											class="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center animate-pulse"
										>
											<svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
												<path
													d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"
												/>
												<path
													d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
												/>
											</svg>
										</div>
									</div>
									<div>
										<div class="flex items-center justify-between w-full">
											<p class="text-emerald-700 font-medium text-sm">Listening...</p>
											{#if pronunciationEnabled && currentPronunciation}
												<div class="flex items-center gap-1.5">
													<div
														class="w-12 h-12 rounded-full flex items-center justify-center text-xs font-bold
													{currentPronunciation.clarityScore >= 80
															? 'bg-emerald-100 text-emerald-700'
															: currentPronunciation.clarityScore >= 60
																? 'bg-yellow-100 text-yellow-700'
																: 'bg-rose-100 text-rose-700'}"
													>
														{currentPronunciation.clarityScore}
													</div>
													<span class="text-xs text-emerald-600/70">clarity</span>
												</div>
											{/if}
										</div>
										<p class="text-emerald-600/70 text-xs">
											{autoSendEnabled
												? 'Speak naturally. Auto-sending when you pause.'
												: 'Speak naturally. Click send when done.'}
										</p>
									</div>
								{:else}
									<div class="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center">
										<svg
											class="w-5 h-5 text-stone-500"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="1.5"
												d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z"
											/>
										</svg>
									</div>
									<div>
										<p class="text-stone-600 font-medium text-sm">Mic is off</p>
										<p class="text-stone-500 text-xs">Click "Start mic" to begin speaking.</p>
									</div>
								{/if}
							</div>

							{#if speechRecognitionSupported && (liveTranscript || isListening)}
								<div class="bg-white rounded-xl border border-stone-200 p-4 min-h-[80px]">
									{#if liveTranscript}
										<p class="text-stone-800 text-sm leading-relaxed">{liveTranscript}</p>
									{:else}
										<p class="text-stone-400 text-sm italic">Start speaking...</p>
									{/if}
								</div>
							{:else if !speechRecognitionSupported && isListening}
								<div
									class="bg-blue-50 rounded-xl border border-blue-200 p-4 min-h-[80px] flex items-center justify-center"
								>
									<div class="text-center">
										<div class="w-8 h-8 mx-auto mb-2 rounded-full bg-blue-500 animate-pulse"></div>
										<p class="text-blue-700 text-sm font-medium">🎤 Listening...</p>
										<p class="text-blue-600 text-xs mt-1">Speak naturally to the AI</p>
									</div>
								</div>
							{/if}

							<!-- Auto Send 토글 (Only for browsers with Web Speech API) -->
							{#if speechRecognitionSupported}
								<div class="flex items-center justify-between px-1">
									<label class="flex items-center gap-2 cursor-pointer select-none">
										<button
											onclick={toggleAutoSend}
											aria-label="자동 전송 토글"
											class="relative w-10 h-5 rounded-full transition-colors duration-200 {autoSendEnabled
												? 'bg-emerald-500'
												: 'bg-stone-300'}"
											role="switch"
											aria-checked={autoSendEnabled}
										>
											<span
												class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 {autoSendEnabled
													? 'translate-x-5'
													: 'translate-x-0'}"
											></span>
										</button>
										<span
											class="text-xs font-medium {autoSendEnabled
												? 'text-emerald-700'
												: 'text-stone-500'}"
										>
											Auto Send
										</span>
									</label>
								</div>

								<!-- 카운트다운 표시 -->
								{#if autoSendCountdown > 0 && autoSendEnabled}
									<div
										class="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl"
									>
										<div
											class="w-5 h-5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin"
										></div>
										<span class="text-xs font-medium text-amber-700">
											{autoSendCountdown}초 후 자동 전송...
										</span>
										<button
											onclick={cancelAutoSendCountdown}
											class="ml-auto text-xs text-amber-600 hover:text-amber-800 font-medium"
										>
											취소
										</button>
									</div>
								{/if}
							{/if}

							<div class="flex gap-2">
								<button
									onclick={toggleMic}
									class="flex-1 py-3 rounded-xl font-medium text-sm transition-colors {isListening
										? 'bg-stone-200 hover:bg-stone-300 text-stone-700'
										: 'bg-emerald-500 hover:bg-emerald-600 text-white'}"
								>
									{isListening ? 'Stop mic' : 'Start mic'}
								</button>

								{#if speechRecognitionSupported && liveTranscript.trim() && !autoSendEnabled}
									<button
										onclick={sendVoiceMessage}
										class="flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2"
									>
										Send to {currentCharacterName}
										{currentCharacterEmoji}{currentCharacterMbti
											? ` (${currentCharacterMbti})`
											: ''}
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M14 5l7 7m0 0l-7 7m7-7H3"
											/>
										</svg>
									</button>
								{/if}
							</div>

							{#if speechRecognitionSupported && liveTranscript.trim()}
								<button
									onclick={clearTranscript}
									class="text-xs text-stone-500 hover:text-stone-700 transition-colors"
								>
									Clear transcript
								</button>
							{/if}
						</div>
					{:else}
						<div class="space-y-3">
							<label for="text-input" class="block text-sm font-medium text-stone-600"
								>Type your message</label
							>
							<div class="flex gap-2">
								<input
									id="text-input"
									type="text"
									bind:value={textInput}
									onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && sendText()}
									placeholder="Ask anything in English..."
									class="flex-1 px-4 py-3 rounded-xl border border-stone-200 bg-white text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-300 transition-all"
								/>
								<button
									onclick={sendText}
									disabled={!textInput.trim()}
									class="px-5 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
								>
									Send
								</button>
							</div>
						</div>
					{/if}

					<button
						onclick={disconnect}
						class="w-full py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-medium transition-colors flex items-center justify-center gap-2"
						title="Closes API connection completely"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							/>
						</svg>
						End & disconnect
					</button>
				</div>
			{/if}
		</div>
	</aside>

	<!-- Right: Conversation or History -->
	<main
		class="flex-1 flex flex-col min-h-0 overflow-hidden market-main
			{status === 'connected' && mobileTab !== 'chat' ? 'hidden lg:flex' : ''}"
	>
		<div class="flex-1 flex flex-col min-h-0 p-8 lg:p-12">
			{#if savedView}
				<div
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden market-card"
				>
					<div class="shrink-0 px-8 py-5 border-b border-stone-100 bg-stone-50/50">
						<h2 class="text-base font-semibold text-stone-700">Saved Sentences</h2>
					</div>
					<div class="flex-1 min-h-0 overflow-y-auto p-6">
						{#if savedLoading}
							<div class="flex justify-center py-12">
								<div
									class="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"
								></div>
							</div>
						{:else if savedSentences.length === 0}
							<div class="text-center py-12 text-stone-500 text-sm">
								<p>No saved sentences yet.</p>
								<p class="mt-2">Click the Save button on an AI response to save it.</p>
							</div>
						{:else}
							<div class="space-y-3">
								{#each savedSentences as sentence (sentence.id)}
									{@const char = sentence.character_voice_id
										? getCharacter(sentence.character_voice_id)
										: { label: sentence.character_name, emoji: '' }}
									<div
										class="p-4 rounded-xl border border-stone-200 hover:border-stone-300 transition-colors"
									>
										<div class="flex justify-between items-start gap-3">
											<div class="flex-1 min-w-0">
												<span class="text-xs font-medium text-stone-500"
													>{char.label}{char.emoji ? ` ${char.emoji}` : ''}</span
												>
												<p
													class="text-sm text-stone-800 mt-1 whitespace-pre-wrap break-words leading-relaxed"
												>
													{sentence.content}
												</p>
												<span class="text-xs text-stone-400 mt-2 block"
													>{new Date(sentence.created_at).toLocaleString()}</span
												>
											</div>
											<button
												onclick={() => handleDeleteSaved(sentence.id)}
												class="shrink-0 p-1.5 rounded-lg text-stone-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
												title="Delete"
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/>
												</svg>
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{:else if historyView === 'list'}
				<div
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden market-card"
				>
					<div class="shrink-0 px-6 py-4 border-b border-stone-100 bg-stone-50/50">
						<h2 class="text-base font-semibold text-stone-700">Past Conversations</h2>
					</div>
					<div class="flex-1 min-h-0 overflow-y-auto p-6">
						{#if historyLoading}
							<div class="flex justify-center py-12">
								<div
									class="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"
								></div>
							</div>
						{:else if historySessions.length === 0}
							<div class="text-center py-12 text-stone-500 text-sm">
								<p>No conversations yet.</p>
								<p class="mt-2">Start a conversation to see your history here.</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each historySessions as sess (sess.session_id)}
									{@const char = sess.character_voice_id
										? getCharacter(sess.character_voice_id)
										: { label: sess.character_name, emoji: '', personality: '' }}
									<button
										onclick={() => viewSession(sess)}
										class="w-full text-left p-4 rounded-xl border border-stone-200 hover:bg-stone-50 hover:border-stone-300 transition-colors"
									>
										<div class="flex justify-between items-start">
											<div>
												<span class="font-medium text-stone-700"
													>{char.label}{char.emoji ? ` ${char.emoji}` : ''}{char.mbti
														? ` (${char.mbti})`
														: ''}</span
												>
												<span class="text-stone-400 text-xs ml-2"
													>{sess.message_count} messages</span
												>
												{#if char.mbtiDescription}
													<p
														class="text-stone-500 text-xs mt-1 truncate max-w-[200px]"
														title={char.mbtiDescription}
													>
														{char.mbtiDescription}
													</p>
												{:else if char.personality}
													<p
														class="text-stone-500 text-xs mt-1 truncate max-w-[200px]"
														title={char.personality}
													>
														{char.personality}
													</p>
												{/if}
											</div>
											<span class="text-xs text-stone-500"
												>{new Date(sess.started_at).toLocaleString()}</span
											>
										</div>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{:else if historyView === 'detail'}
				{@const detailChar = selectedSession?.character_voice_id
					? getCharacter(selectedSession.character_voice_id)
					: {
							label: selectedSession?.character_name ?? 'Tutor',
							emoji: '',
							mbti: '',
							personality: '',
							mbtiDescription: ''
						}}
				<div
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden market-card"
				>
					<div
						class="shrink-0 px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex flex-col gap-1"
					>
						<div class="flex items-center justify-between">
							<button
								onclick={backToHistoryList}
								class="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M15 19l-7-7 7-7"
									/></svg
								>
								Back
							</button>
							<h2 class="text-base font-semibold text-stone-700">
								{detailChar.label}{detailChar.emoji ? ` ${detailChar.emoji}` : ''}{detailChar.mbti
									? ` (${detailChar.mbti})`
									: ''} · {new Date(selectedSession?.started_at).toLocaleString()}
							</h2>
							<div></div>
						</div>
						{#if detailChar.mbtiDescription}
							<p class="text-stone-500 text-xs" title={detailChar.mbtiDescription}>
								MBTI: {detailChar.mbtiDescription}
							</p>
						{:else if detailChar.personality}
							<p class="text-stone-500 text-xs" title={detailChar.personality}>
								AI personality: {detailChar.personality}
							</p>
						{/if}
					</div>
					<div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
						{#if historyLoading}
							<div class="flex justify-center py-12">
								<div
									class="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"
								></div>
							</div>
						{:else}
							{#each historyMessages as msg, idx (idx)}
								<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
									<div
										class="max-w-[85%] rounded-2xl px-4 py-3 text-sm {msg.role === 'user'
											? 'bg-rose-50 text-stone-900 border border-rose-100'
											: 'bg-stone-50 text-stone-800 border border-stone-100'}"
									>
										<span class="text-xs font-medium text-stone-600 block mb-1.5"
											>{msg.role === 'user'
												? 'You'
												: `${detailChar.label}${detailChar.emoji ? ` ${detailChar.emoji}` : ''}${detailChar.mbti ? ` (${detailChar.mbti})` : ''}`}</span
										>
										<p class="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			{:else}
				<div
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden market-card"
				>
					<div
						class="shrink-0 px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between gap-4 flex-wrap"
					>
						<div class="flex items-center gap-2">
							<h2 class="text-base font-semibold text-stone-700">Conversation</h2>
							{#if status === 'connected'}
								<span
									class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
									title="API Connected"
								></span>
							{:else if status === 'disconnected' || status === 'error'}
								<span class="w-2 h-2 rounded-full bg-red-500" title="Disconnected"></span>
							{:else}
								<span class="w-2 h-2 rounded-full bg-stone-300" title="Not connected"></span>
							{/if}
						</div>
						{#if status === 'connected'}
							<div class="flex gap-2 flex-wrap">
								<button
									onclick={requestRandomQuestion}
									title="Get a random question to practice"
									class="px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-medium transition-colors"
								>
									Random Q
								</button>
								<button
									onclick={requestGrammarCorrection}
									disabled={!hasUserMessage()}
									title={hasUserMessage()
										? 'Correct grammar of your last message'
										: 'Send a message first'}
									class="px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
								>
									Adjust grammar
								</button>
								<button
									onclick={requestParaphrase}
									disabled={!hasUserMessage()}
									title={hasUserMessage() ? 'Paraphrase your last message' : 'Send a message first'}
									class="px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
								>
									Paraphrase
								</button>
							</div>
						{/if}
					</div>
					<div
						bind:this={logContainer}
						class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 space-y-4"
						role="log"
						aria-label="Conversation history"
					>
						{#if conversationLog.length === 0}
							<div
								class="flex flex-col items-center justify-center h-full min-h-[280px] text-center"
							>
								<div
									class="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mb-4"
								>
									<svg
										class="w-8 h-8 text-stone-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="1.5"
											d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
										/>
									</svg>
								</div>
								<p class="text-stone-500 text-sm max-w-[240px]">
									Your conversation will show up here once you start!
								</p>
							</div>
						{:else}
							{#each conversationLog as msg, i (i)}
								{@const isLastAssistant =
									msg.role === 'assistant' && i === conversationLog.length - 1}
								{@const isThisRevealing = isLastAssistant && isRevealing}
								{@const showSpeaking =
									isLastAssistant && (isRevealing || msg.isStreaming || isSpeaking)}
								{@const canSave =
									msg.role === 'assistant' && !msg.isStreaming && !isThisRevealing && $user}
								<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
									<div
										class="max-w-[85%] rounded-2xl px-5 py-4 text-base {msg.role === 'user'
											? 'bg-rose-50 text-stone-900 border border-rose-100'
											: 'bg-stone-50 text-stone-800 border border-stone-100'}"
									>
										<span class="text-sm font-medium text-stone-600 mb-2 flex items-center gap-1.5">
											{msg.role === 'user' ? 'You' : currentCharacterName}
											{msg.role === 'assistant'
												? `${currentCharacterEmoji}${currentCharacterMbti ? ` (${currentCharacterMbti})` : ''}`
												: ''}
											{#if showSpeaking}
												<span class="speaking-animation inline-flex items-center gap-0.5">
													<span
														class="w-1 h-1 bg-emerald-500 rounded-full animate-bounce"
														style="animation-delay: 0ms"
													></span>
													<span
														class="w-1 h-1 bg-emerald-500 rounded-full animate-bounce"
														style="animation-delay: 150ms"
													></span>
													<span
														class="w-1 h-1 bg-emerald-500 rounded-full animate-bounce"
														style="animation-delay: 300ms"
													></span>
												</span>
											{/if}
										</span>
										<p class="whitespace-pre-wrap break-words leading-relaxed">
											{isThisRevealing ? displayedText : msg.text}{#if showSpeaking}<span
													class="typing-cursor"
												></span>{/if}
										</p>

										<!-- Pronunciation Feedback -->
										{#if msg.role === 'user' && msg.pronunciation && pronunciationEnabled}
											{@const p = msg.pronunciation}
											<div class="mt-3 p-3 rounded-lg bg-white border border-stone-200 space-y-2">
												<div class="flex items-center justify-between">
													<span class="text-xs font-medium text-stone-600">Pronunciation</span>
													<div class="flex items-center gap-2">
														<span class="text-xs text-stone-500">{p.speakingPace} WPM</span>
														<div
															class="px-2 py-0.5 rounded text-xs font-bold
															{p.clarityScore >= 80
																? 'bg-emerald-100 text-emerald-700'
																: p.clarityScore >= 60
																	? 'bg-yellow-100 text-yellow-700'
																	: 'bg-rose-100 text-rose-700'}"
														>
															{p.clarityScore}% clear
														</div>
													</div>
												</div>
												<p class="text-xs text-stone-600">{p.feedback}</p>
												{#if p.problematicWords && p.problematicWords.length > 0}
													<div class="flex flex-wrap gap-1.5 mt-2">
														{#each p.problematicWords.slice(0, 3) as word (word.word)}
															<span
																class="px-2 py-0.5 bg-rose-50 text-rose-700 rounded text-xs"
																title={word.suggestion}
															>
																"{word.word}" ({word.confidence}%)
															</span>
														{/each}
													</div>
												{/if}
											</div>
										{/if}

										{#if canSave}
											{#if savedMessageIds.has(i)}
												<span
													class="mt-2 px-2.5 py-1 text-xs font-medium text-emerald-500 flex items-center gap-1"
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M5 13l4 4L19 7"
														/>
													</svg>
													Saved
												</span>
											{:else}
												<button
													onclick={() => handleSaveSentence(msg, i)}
													class="mt-2 px-2.5 py-1 text-xs font-medium text-stone-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors flex items-center gap-1"
													title="Save this sentence"
												>
													<svg
														class="w-3.5 h-3.5"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
														/>
													</svg>
													Save
												</button>
											{/if}
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</main>
</div>

{#if sessionSummary}
	<div
		class="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 backdrop-blur-md p-4"
		role="dialog"
		aria-modal="true"
		aria-labelledby="session-summary-title"
	>
		<div
			class="w-full max-w-2xl market-card market-enter border border-stone-200/80 relative overflow-hidden"
		>
			<div
				class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-400 via-sky-400 to-indigo-400"
			></div>
			<div class="relative px-6 py-6 md:px-7 md:py-7">
				<div class="flex flex-col lg:flex-row lg:items-center gap-5">
					<div class="flex-1">
						<p class="market-chip mb-2.5">Session Completed</p>
						<h2
							id="session-summary-title"
							class="text-2xl market-shell-title text-stone-900 mb-1.5"
						>
							최종 세션 리포트
						</h2>
						<p class="text-stone-600 text-sm">
							{sessionSummary.characterEmoji || '✅'}
							{sessionSummary.character}{sessionSummary.characterMbti
								? ` (${sessionSummary.characterMbti})`
								: ''}
							와의 대화 결과입니다.
						</p>
						<p class="text-stone-400 text-xs mt-2">
							지속 시간: {formatSessionDuration(sessionSummary.durationSeconds)} · 레벨: {sessionSummary.level}
						</p>

						<div class="mt-5 flex flex-wrap gap-2">
							<span
								class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border border-emerald-100 bg-emerald-50"
							>
								<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
								상호작용 점수 {sessionSummary.interactionScore}
							</span>
							<span
								class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
							>
								<span class="w-2 h-2 rounded-full bg-sky-500"></span>
								속도 점수 {sessionSummary.speedScore}
							</span>
							<span
								class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
							>
								<span class="w-2 h-2 rounded-full bg-amber-500"></span>
								명확도 {sessionSummary.clarityScore}
							</span>
						</div>
					</div>

					<div class="shrink-0">
						<div class="relative w-28 h-28 rounded-full">
							<svg
								class="w-full h-full"
								viewBox="0 0 132 132"
								role="img"
								aria-label="Session score"
							>
								<circle
									cx="66"
									cy="66"
									r={SCORE_RING_RADIUS}
									fill="none"
									stroke="rgba(15,23,42,0.12)"
									stroke-width="10"
									stroke-linecap="round"
								></circle>
								<circle
									cx="66"
									cy="66"
									r={SCORE_RING_RADIUS}
									fill="none"
									stroke-width="10"
									stroke-linecap="round"
									stroke="url(#summaryRingGradient)"
									class="session-ring-progress"
									style={`stroke-dasharray: ${SCORE_RING_CIRCUMFERENCE}; stroke-dashoffset: ${sessionSummary.scoreStrokeOffset};`}
									stroke-dashoffset="0"
									transform="rotate(-90 66 66)"
								></circle>
								<defs>
									<linearGradient id="summaryRingGradient" x1="0%" y1="0%" x2="100%" y2="0%">
										<stop offset="0%" stop-color="#34d399" />
										<stop offset="50%" stop-color="#0ea5e9" />
										<stop offset="100%" stop-color="#6366f1" />
									</linearGradient>
								</defs>
							</svg>
							<div
								class="absolute inset-0 grid place-items-center rounded-full bg-white/70 backdrop-blur-sm"
							>
								<div class="text-center">
									<div class="text-3xl font-black tracking-tight text-stone-900">
										{sessionSummary.overallScore}
									</div>
									<div class="text-[11px] text-stone-500">종합점수</div>
								</div>
							</div>
						</div>
						<p class="text-center mt-2 text-xs font-semibold tracking-wide">
							<span class="market-chip">{sessionSummary.scoreMeta.label}</span>
						</p>
					</div>
				</div>

				<div class="mt-6 grid grid-cols-2 md:grid-cols-4 gap-2.5">
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">총 메시지</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.totalMessages}</p>
						<p class="text-[11px] text-stone-400 mt-0.5">Messages</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">질문 수</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.questionCount}</p>
						<p class="text-[11px] text-stone-400 mt-0.5">Questions</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">답변 수</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.answerCount}</p>
						<p class="text-[11px] text-stone-400 mt-0.5">Answers</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">발화 단어</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.userWordCount}</p>
						<p class="text-[11px] text-stone-400 mt-0.5">Words</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">대화 속도</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.avgWordsPerMinute} WPM</p>
						<p class="text-[11px] text-stone-400 mt-0.5">목표 ±30WPM</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">명확도</p>
						<p
							class="text-2xl font-black {sessionSummary.clarityScore >= 80
								? 'text-emerald-700'
								: sessionSummary.clarityScore >= 60
									? 'text-amber-700'
									: 'text-rose-700'}"
						>
							{sessionSummary.clarityScore}
							<span class="text-xl font-semibold">%</span>
						</p>
						<p class="text-[11px] text-stone-400 mt-0.5">Accuracy</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">상호작용 점수</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.interactionScore}</p>
						<p class="text-[11px] text-stone-400 mt-0.5">Questions/Answers balance</p>
					</div>
					<div class="market-surface rounded-xl p-3.5 border">
						<p class="text-stone-500 text-[11px]">속도 점수</p>
						<p class="text-2xl font-black text-stone-900">{sessionSummary.speedScore}</p>
						<p class="text-[11px] text-stone-400 mt-0.5">speech pace fit</p>
					</div>
				</div>

				{#if sessionSummary.strengths.length > 0 || sessionSummary.improvements.length > 0}
					<div class="mt-5 grid sm:grid-cols-2 gap-2.5">
						{#if sessionSummary.strengths.length > 0}
							<div class="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
								<div class="text-sm font-semibold text-emerald-900 mb-2">Strong Points</div>
								<ul class="space-y-1.5">
									{#each sessionSummary.strengths as strength, idx (idx)}
										<li class="text-emerald-900 text-sm flex items-start gap-2">
											<span class="text-emerald-500 mt-0.5 shrink-0">✓</span>
											<span>{strength}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if sessionSummary.improvements.length > 0}
							<div class="rounded-xl border border-rose-100 bg-rose-50/70 p-4">
								<div class="text-sm font-semibold text-rose-900 mb-2">Next Focus</div>
								<ul class="space-y-1.5">
									{#each sessionSummary.improvements as improvement, idx (idx)}
										<li class="text-rose-900 text-sm flex items-start gap-2">
											<span class="text-rose-500 mt-0.5 shrink-0">•</span>
											<span>{improvement}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}

				{#if sessionSummary.expressions.length > 0}
					<div class="mt-5 p-4 rounded-xl border border-stone-200 bg-stone-50/80">
						<div class="text-sm font-medium text-stone-900 mb-2">Expressions</div>
						<ul class="space-y-1.5">
							{#each sessionSummary.expressions as expr, idx (idx)}
								<li class="text-stone-800 text-sm flex items-start gap-2">
									<span class="text-stone-400 mt-0.5 shrink-0">•</span>
									<span class="italic">"{expr}"</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<div class="px-6 py-4 md:px-7 md:py-4 border-t border-stone-100 bg-stone-50/80 flex gap-2">
				<button
					onclick={dismissSummary}
					class="flex-1 py-3 rounded-xl bg-stone-900 text-white font-semibold text-sm transition-colors hover:bg-stone-700"
				>
					다시 시작
				</button>
				<button
					onclick={dismissSummary}
					class="flex-1 py-3 rounded-xl bg-white border border-stone-200 text-stone-600 font-semibold text-sm transition-colors hover:bg-stone-50"
				>
					대화로 돌아가기
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Toast notification for saved sentence -->
{#if savedToast}
	<div
		class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 text-sm font-medium rounded-xl shadow-lg market-toast"
	>
		Sentence saved!
	</div>
{/if}

<!-- 온보딩 모달 -->
{#if $user && !$authLoading && !$onboardingLoading && !$onboardingComplete}
	<OnboardingModal userId={$user.id} onComplete={() => checkOnboardingStatus($user.id)} />
{/if}

<style>
	@keyframes slideInLeft {
		from {
			opacity: 0;
			transform: translateX(-20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	:global(.animate-slide-in-left) {
		animation: slideInLeft 0.6s ease-out;
	}

	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	.typing-cursor {
		display: inline-block;
		width: 2px;
		height: 1em;
		background-color: currentColor;
		margin-left: 1px;
		vertical-align: text-bottom;
		animation: blink 0.8s step-end infinite;
	}

	.session-ring-progress {
		transition: stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1);
	}
</style>
