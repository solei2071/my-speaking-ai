<script>
	import { onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolveRoute } from '$app/paths';
	import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';
	import { user, authLoading, signOut, onboardingComplete, onboardingLoading } from '$lib/auth.js';
	import { saveMessage, fetchSessions, fetchSessionMessages } from '$lib/conversation.js';
	import { saveSentence, fetchSavedSentences, deleteSavedSentence } from '$lib/savedSentences.js';
	import { getCharacter, voiceOptionsSorted } from '$lib/characters.js';
	import { getScenario, scenarioOptions } from '$lib/scenarios.js';
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

	// Pronunciation feedback (only available with Web Speech API)
	let pronunciationEnabled = $state(true);
	let currentPronunciation = $state(null);
	let pronunciationHistory = $state([]);
	let speechStartTime = $state(0);
	let logContainer = $state(null);
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
	let streamingText = $state('');

	// Auto-send timer
	let autoSendTimer = $state(null);

	// Auto-send mode: 말이 끝나면 자동 전송
	let autoSendEnabled = $state(false);
	let autoSendDelay = 1000; // 침묵 후 자동 전송까지 대기 시간 (ms)
	let autoSendCountdown = $state(0); // 카운트다운 표시용
	let autoSendCountdownInterval = null;

	// Cleanup tracking
	let cleanupFns = [];

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

		cleanupFns.forEach((fn) => {
			try {
				fn();
			} catch {
				/* ignore */
			}
		});
		cleanupFns = [];
	});

	function addCleanableListener(target, event, handler) {
		if (target?.on) {
			target.on(event, handler);
			cleanupFns.push(() => {
				try {
					target.off?.(event, handler);
				} catch {
					/* ignore */
				}
			});
		}
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

	function handleServerEvent(event) {
		if (!event?.type) return;

		// Audio transcript delta - real-time text as AI speaks
		if (event.type === 'response.audio_transcript.delta') {
			const delta = event.delta || '';
			if (delta) {
				isSpeaking = true;
				streamingText += delta;
				updateStreamingMessage(streamingText);
			}
		}

		// Response started
		if (event.type === 'response.created' || event.type === 'response.output_item.added') {
			isSpeaking = true;
			streamingText = '';
		}

		// Response done - finalize the message
		if (event.type === 'response.audio_transcript.done') {
			isSpeaking = false;
			finalizeStreamingMessage();
		}
	}

	function finalizeStreamingMessage() {
		const lastMsg = conversationLog[conversationLog.length - 1];
		const text = streamingText || lastMsg?.text;
		if (lastMsg?.isStreaming && text) {
			conversationLog = [...conversationLog.slice(0, -1), { role: 'assistant', text }];
			saveAssistantToDb(text);
		}
		streamingText = '';
	}

	function getMessageText(item) {
		if (item.type !== 'message' || !item.content) return null;
		for (const c of item.content) {
			if (c.type === 'input_text' && c.text) return c.text;
			if (c.type === 'input_audio' && c.transcript) return c.transcript;
			if (c.type === 'output_text' && c.text) return c.text;
			if (c.type === 'output_audio' && c.transcript) return c.transcript;
		}
		return null;
	}

	function updateStreamingMessage(text) {
		if (!text) return;

		const lastIndex = conversationLog.length - 1;
		const lastMsg = conversationLog[lastIndex];

		if (lastMsg?.role === 'user' || (!lastMsg && conversationLog.length === 0)) {
			conversationLog = [...conversationLog, { role: 'assistant', text, isStreaming: true }];
		} else if (lastMsg?.isStreaming) {
			conversationLog = [
				...conversationLog.slice(0, -1),
				{ role: 'assistant', text, isStreaming: true }
			];
		} else if (!lastMsg || lastMsg.role === 'assistant') {
			const userCount = conversationLog.filter((m) => m.role === 'user').length;
			const assistantCount = conversationLog.filter((m) => m.role === 'assistant').length;
			if (userCount > assistantCount) {
				conversationLog = [...conversationLog, { role: 'assistant', text, isStreaming: true }];
			}
		}

		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});
	}

	function updateConversationLog(history) {
		let latestCompletedText = null;

		for (const item of history) {
			if (item.type !== 'message') continue;
			if (item.role === 'user') continue;
			if (item.status && item.status !== 'completed') continue;
			const text = getMessageText(item);
			if (text?.trim()) {
				latestCompletedText = text;
			}
		}

		if (latestCompletedText) {
			const lastMsg = conversationLog[conversationLog.length - 1];

			if (lastMsg?.isStreaming) {
				conversationLog = [
					...conversationLog.slice(0, -1),
					{ role: 'assistant', text: latestCompletedText }
				];
				isSpeaking = false;
				saveAssistantToDb(latestCompletedText);
			} else if (lastMsg?.role === 'user') {
				conversationLog = [...conversationLog, { role: 'assistant', text: latestCompletedText }];
				saveAssistantToDb(latestCompletedText);
			} else if (lastMsg?.role === 'assistant' && lastMsg.text !== latestCompletedText) {
				conversationLog = [
					...conversationLog.slice(0, -1),
					{ role: 'assistant', text: latestCompletedText }
				];
				saveAssistantToDb(latestCompletedText);
			}
		}

		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});
	}

	async function connect(voice) {
		status = 'connecting';
		error = null;
		conversationLog = [];
		savedToDbSet = new SvelteSet();
		savedMessageIds = new Set();
		currentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

		try {
			const res = await withTimeout(
				fetch('/api/realtime-token', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ voice })
				}),
				10000,
				'토큰 요청'
			);
			const data = await res.json();

			if (!res.ok) {
				let msg = data.details
					? `${data.error || 'Failed to get token'}: ${data.details}`
					: data.error || data.details || 'Failed to get token.';
				if (data.hint) msg += ` ${data.hint}`;
				throw new Error(msg);
			}

			const ephemeralKey = data.value;
			if (!ephemeralKey) {
				throw new Error("Couldn't get token.");
			}

			const character = getCharacter(voice);
			const scenarioInstructions = selectedScenario
				? `\n\nScenario focus: ${selectedScenario.instructions}`
				: '';
			const agent = new RealtimeAgent({
				name: character.label,
				instructions: `You are ${character.label}, a friendly English conversation teacher for intermediate learners. ${character.personality}${scenarioInstructions}`
			});

			const realtimeSession = new RealtimeSession(agent);

			// Only use SDK events — no raw WebSocket hook to avoid duplicate processing
			addCleanableListener(realtimeSession, 'history_updated', (history) =>
				updateConversationLog(history)
			);

			addCleanableListener(realtimeSession, 'error', (e) => {
				error = e?.error?.message ?? String(e?.error ?? e);
				status = 'error';
				session = null;
				isSpeaking = false;
			});

			addCleanableListener(realtimeSession, 'audio_done', () => {
				isSpeaking = false;
				finalizeStreamingMessage();
			});

			addCleanableListener(realtimeSession, 'server_event', (event) => handleServerEvent(event));

			addCleanableListener(realtimeSession, 'transcript', (data) => {
				if (data?.text || data?.delta) {
					isSpeaking = true;
					streamingText += data.delta || '';
					if (data.text) streamingText = data.text;
					updateStreamingMessage(streamingText);
				}
			});

			await realtimeSession.connect({ apiKey: ephemeralKey });

			session = realtimeSession;
			const char = getCharacter(voice);
			currentCharacterName = char.label;
			currentCharacterEmoji = char.emoji;
			currentCharacterMbti = char.mbti ?? '';
			currentVoiceId = voice;
			status = 'connected';

			// Try to initialize speech recognition, fallback to text mode if not supported
			const speechSupported = initSpeechRecognition();
			inputMode = speechSupported ? 'voice' : 'text';

			// For browsers without Web Speech API (e.g., Firefox), use RealtimeSession's native voice input
			// For browsers with Web Speech API (Chrome, Edge, Safari), mute RealtimeSession and use Web Speech
			if (realtimeSession.muted !== null) {
				if (speechSupported) {
					realtimeSession.mute(true); // Use Web Speech API for transcription
				} else {
					realtimeSession.mute(false); // Use RealtimeSession's native voice input
					inputMode = 'voice'; // Enable voice mode even without Web Speech API
				}
			}
		} catch (e) {
			status = 'error';
			const errorMsg = e?.message || '';
			if (errorMsg.includes('timed out')) {
				error = '연결이 너무 오래 걸립니다. 인터넷 연결을 확인해주세요.';
			} else if (errorMsg.includes('API key') || errorMsg.includes('Unauthorized')) {
				error = 'API 키 오류입니다. 설정을 확인해주세요.';
			} else if (errorMsg.includes('quota') || errorMsg.includes('limit')) {
				error = 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
			} else {
				error = errorMsg || '연결에 실패했습니다. 다시 시도해주세요.';
			}
			console.error('Connection error:', e);
		}
	}

	let disconnectMessage = $state('');

	function disconnect() {
		stopListening();
		cancelAutoSendCountdown();

		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}

		liveTranscript = '';
		finalTranscript = '';
		isSpeaking = false;
		streamingText = '';

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

		setTimeout(() => {
			if (status === 'disconnected') {
				status = 'idle';
				disconnectMessage = '';
				error = null;
			}
		}, 2000);
	}

	function safeSendMessage(msg) {
		if (!session) return false;
		try {
			session.sendMessage(msg);
			return true;
		} catch (e) {
			error = e?.message ?? 'Failed to send message.';
			status = 'error';
			session = null;
			return false;
		}
	}

	function sendText() {
		const text = textInput.trim();
		if (!text || !session) return;

		conversationLog = [...conversationLog, { role: 'user', text }];
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

		if (safeSendMessage(text)) textInput = '';
	}

	function setInputMode(mode) {
		inputMode = mode;

		if (mode === 'voice') {
			// If Web Speech API is supported, use it (Chrome, Edge, Safari)
			if (speechRecognitionSupported) {
				if (session?.muted !== null) session.mute(true);
			} else {
				// If not supported (Firefox), use RealtimeSession's native voice input
				if (session?.muted !== null) session.mute(false);
			}
		} else if (mode === 'text') {
			if (session?.muted !== null) session.mute(true);
			stopListening();
			liveTranscript = '';
			finalTranscript = '';
		}
	}

	function toggleMic() {
		// For browsers without Web Speech API (Firefox), control RealtimeSession mute
		if (!speechRecognitionSupported) {
			if (session?.muted !== null) {
				const newMutedState = !session.muted;
				session.mute(newMutedState);
				isListening = !newMutedState;
			}
			return;
		}

		// For browsers with Web Speech API
		if (isListening) {
			stopListening();
		} else {
			startListening();
		}
	}

	function hasUserMessage() {
		return conversationLog.some((m) => m.role === 'user');
	}

	function sendHelperMessage(text, label) {
		if (!session) return;
		conversationLog = [...conversationLog, { role: 'user', text: `[${label}]` }];
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
		safeSendMessage(text);
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
		// For browsers without Web Speech API (Firefox), unmute RealtimeSession
		if (!speechRecognitionSupported) {
			if (session?.muted !== null) {
				session.mute(false);
				isListening = true;
			}
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

		// For browsers without Web Speech API (Firefox), mute RealtimeSession
		if (!speechRecognitionSupported) {
			if (session?.muted !== null) {
				session.mute(true);
			}
			return;
		}

		// For browsers with Web Speech API
		if (recognition) {
			try {
				recognition.stop();
			} catch {
				/* ignore */
			}
		}
	}

	function sendVoiceMessage() {
		const text = liveTranscript.trim();
		if (!text || !session) return;

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
		const messageData = { role: 'user', text };
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

		safeSendMessage(text);

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
		autoSendCountdown = Math.ceil(autoSendDelay / 1000);

		autoSendCountdownInterval = setInterval(() => {
			autoSendCountdown -= 1;
			if (autoSendCountdown <= 0) {
				cancelAutoSendCountdown();
			}
		}, 1000);

		autoSendTimer = setTimeout(() => {
			cancelAutoSendCountdown();
			if (liveTranscript.trim() && autoSendEnabled && !isSpeaking) {
				sendVoiceMessage();
			}
		}, autoSendDelay);
	}

	/** Auto Send 카운트다운 취소 */
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

<div class="h-screen overflow-hidden bg-stone-50 flex">
	<!-- Left: Controls + Input -->
	<aside
		class="w-full lg:w-[520px] h-screen flex flex-col bg-white border-r border-stone-200 p-10 lg:p-12 overflow-y-auto shrink-0"
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
				<!-- Scenario Selector -->
				<div class="mb-6">
					<p class="text-stone-600 text-base mb-3">Choose a scenario (optional)</p>
					<div class="flex items-center gap-2">
						<button
							onclick={() => (showScenarioSelector = !showScenarioSelector)}
							class="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm font-medium transition-all
								{selectedScenario
								? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
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
										? 'border-rose-500 bg-rose-100 text-rose-700'
										: 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-100'}"
								>
									<span class="mr-1.5">{scenario.emoji}</span>
									{scenario.label}
								</button>
							{/each}
						</div>
					{/if}

					{#if selectedScenario}
						<div class="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-100">
							<p class="text-rose-900 font-medium text-sm mb-1">
								{selectedScenario.emoji}
								{selectedScenario.label}
							</p>
							<p class="text-rose-700 text-xs">{selectedScenario.description}</p>
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
					<div class="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
						<svg
							class="w-8 h-8 text-emerald-600"
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
						<p class="text-emerald-700 font-medium text-sm">Disconnected</p>
						<p class="text-stone-500 text-xs mt-1">{disconnectMessage}</p>
					</div>
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
								? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
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
										? 'border-rose-500 bg-rose-100 text-rose-700'
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
	<main class="flex-1 flex flex-col min-h-0 overflow-hidden">
		<div class="flex-1 flex flex-col min-h-0 p-8 lg:p-12">
			{#if savedView}
				<div
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden"
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
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden"
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
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden"
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
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden"
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
								{@const showSpeaking = isLastAssistant && (msg.isStreaming || isSpeaking)}
								{@const canSave = msg.role === 'assistant' && !msg.isStreaming && $user}
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
										<p class="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>

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

<!-- Toast notification for saved sentence -->
{#if savedToast}
	<div
		class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-stone-800 text-white text-sm font-medium rounded-xl shadow-lg"
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
</style>
