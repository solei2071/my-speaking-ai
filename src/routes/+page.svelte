<script>
	import { onDestroy } from 'svelte';
	import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';
	import { user, authLoading, signOut, onboardingComplete, onboardingLoading } from '$lib/auth.js';
	import { saveMessage, fetchSessions, fetchSessionMessages } from '$lib/conversation.js';
	import { getCharacter, voiceOptions } from '$lib/characters.js';
	import OnboardingModal from '$lib/OnboardingModal.svelte';
	import { checkOnboardingStatus } from '$lib/profile.js';
	let status = $state('idle');
	let currentSessionId = $state(null);
	let error = $state(null);
	let session = $state(null);
	let currentCharacterName = $state('Tutor');
	let currentCharacterEmoji = $state('');
	let currentCharacterMbti = $state('');
	let currentVoiceId = $state(null);
	let conversationLog = $state([]);
	let logContainer = $state(null);
	let textInput = $state('');
	let inputMode = $state('voice');
	let micOn = $state(false);

	// Speech recognition for live transcription
	let recognition = $state(null);
	let liveTranscript = $state('');
	let finalTranscript = $state('');
	let isListening = $state(false);

	// AI speaking state
	let isSpeaking = $state(false);
	let streamingText = $state('');
	let streamingMessageId = $state(null);

	// Auto-send timer
	let autoSendTimer = $state(null);

	// Cleanup tracking
	let cleanupFns = [];
	let wsMessageHandler = null;

	// History view
	let historySessions = $state([]);
	let historyView = $state(null);
	let selectedSession = $state(null);
	let historyMessages = $state([]);
	let historyLoading = $state(false);

	// Cleanup on component unmount
	onDestroy(() => {
		console.log('[Cleanup] Component unmounting, cleaning up resources...');

		// 1. Clear timer
		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}

		// 2. Stop and cleanup Speech Recognition
		if (recognition) {
			try {
				recognition.stop();
				recognition.onresult = null;
				recognition.onerror = null;
				recognition.onend = null;
			} catch (e) {
				console.warn('[Cleanup] Speech recognition cleanup failed:', e);
			}
			recognition = null;
		}

		// 3. Remove WebSocket listener
		if (session?.transport && wsMessageHandler) {
			const ws = session.transport.ws || session.transport.socket;
			if (ws?.removeEventListener) {
				ws.removeEventListener('message', wsMessageHandler);
				console.log('[Cleanup] WebSocket listener removed');
			}
		}

		// 4. Close session
		if (session) {
			try {
				session.close();
				console.log('[Cleanup] Session closed');
			} catch (e) {
				console.warn('[Cleanup] Session close failed:', e);
			}
			session = null;
		}

		// 5. Run all tracked cleanup functions
		cleanupFns.forEach((fn) => {
			try {
				fn();
			} catch (e) {
				console.warn('[Cleanup] Cleanup function failed:', e);
			}
		});
		cleanupFns = [];

		console.log('[Cleanup] All resources cleaned up');
	});

	// Helper function to add cleanable event listeners
	function addCleanableListener(target, event, handler) {
		if (target?.on) {
			target.on(event, handler);
			cleanupFns.push(() => {
				try {
					target.off?.(event, handler);
				} catch (e) {
					console.warn('[Cleanup] Failed to remove listener:', e);
				}
			});
		}
	}

	function handleServerEvent(event) {
		if (!event?.type) return;

		// Debug: log event types
		if (event.type?.includes('response') || event.type?.includes('transcript')) {
			console.log('[Realtime Event]', event.type, event);
		}

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

		// Response done
		if (event.type === 'response.done' || event.type === 'response.audio_transcript.done') {
			isSpeaking = false;
			// Finalize the message
			const lastMsg = conversationLog[conversationLog.length - 1];
			if (lastMsg?.isStreaming && streamingText) {
				conversationLog = [
					...conversationLog.slice(0, -1),
					{ role: 'assistant', text: streamingText }
				];
				if ($user && currentSessionId)
					saveMessage(
						$user.id,
						currentSessionId,
						currentCharacterName,
						'assistant',
						streamingText,
						currentVoiceId
					);
			}
			streamingText = '';
		}
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

		const lastMsg = conversationLog[conversationLog.length - 1];

		// If last message is from user, add new streaming assistant message
		if (lastMsg?.role === 'user') {
			conversationLog = [...conversationLog, { role: 'assistant', text, isStreaming: true }];
		}
		// If last message is streaming assistant, update it
		else if (lastMsg?.isStreaming) {
			conversationLog = [
				...conversationLog.slice(0, -1),
				{ role: 'assistant', text, isStreaming: true }
			];
		}
		// If no messages or last is completed assistant (shouldn't happen normally)
		else if (!lastMsg || lastMsg.role === 'assistant') {
			// Check if we need to add a new streaming message
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
		// Only process completed messages from history
		// Streaming is handled separately via WebSocket events
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

		// If we have a completed message, update the log
		if (latestCompletedText) {
			const lastMsg = conversationLog[conversationLog.length - 1];

			// Replace streaming message with completed
			if (lastMsg?.isStreaming) {
				conversationLog = [
					...conversationLog.slice(0, -1),
					{ role: 'assistant', text: latestCompletedText }
				];
				isSpeaking = false;
				if ($user && currentSessionId)
					saveMessage(
						$user.id,
						currentSessionId,
						currentCharacterName,
						'assistant',
						latestCompletedText,
						currentVoiceId
					);
			}
			// Or add if there's no assistant message yet
			else if (lastMsg?.role === 'user') {
				conversationLog = [...conversationLog, { role: 'assistant', text: latestCompletedText }];
				if ($user && currentSessionId)
					saveMessage(
						$user.id,
						currentSessionId,
						currentCharacterName,
						'assistant',
						latestCompletedText,
						currentVoiceId
					);
			}
			// Or update if text changed
			else if (lastMsg?.role === 'assistant' && lastMsg.text !== latestCompletedText) {
				conversationLog = [
					...conversationLog.slice(0, -1),
					{ role: 'assistant', text: latestCompletedText }
				];
				if ($user && currentSessionId)
					saveMessage(
						$user.id,
						currentSessionId,
						currentCharacterName,
						'assistant',
						latestCompletedText,
						currentVoiceId
					);
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
		currentSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

		try {
			const res = await fetch('/api/realtime-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ voice })
			});
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
			const agent = new RealtimeAgent({
				name: character.label,
				instructions: `You are ${character.label}, a friendly English conversation teacher for intermediate learners. ${character.personality}`
			});

			const realtimeSession = new RealtimeSession(agent);

			// Use cleanable listeners for proper cleanup
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
				streamingMessageId = null;
				// Mark streaming message as complete
				const lastMsg = conversationLog[conversationLog.length - 1];
				if (lastMsg?.isStreaming) {
					conversationLog = [
						...conversationLog.slice(0, -1),
						{ role: 'assistant', text: lastMsg.text }
					];
					if ($user && currentSessionId)
						saveMessage(
							$user.id,
							currentSessionId,
							currentCharacterName,
							'assistant',
							lastMsg.text,
							currentVoiceId
						);
				}
			});

			if (realtimeSession.transport) {
				addCleanableListener(realtimeSession.transport, 'connection_change', (connStatus) => {
					if (connStatus === 'disconnected') {
						error = 'Connection lost. Please start a new conversation.';
						status = 'error';
						session = null;
						isSpeaking = false;
					}
				});
			}

			// Listen to various events for real-time streaming
			addCleanableListener(realtimeSession, 'server_event', (event) => handleServerEvent(event));
			addCleanableListener(realtimeSession, 'message', (event) => handleServerEvent(event));
			addCleanableListener(realtimeSession, 'response', (event) => handleServerEvent(event));
			addCleanableListener(realtimeSession, 'transcript', (data) => {
				if (data?.text || data?.delta) {
					isSpeaking = true;
					streamingText += data.delta || '';
					if (data.text) streamingText = data.text;
					updateStreamingMessage(streamingText);
				}
			});

			// Also try transport events
			if (realtimeSession.transport) {
				addCleanableListener(realtimeSession.transport, 'message', (event) =>
					handleServerEvent(event)
				);
			}

			await realtimeSession.connect({ apiKey: ephemeralKey });

			// Hook into WebSocket after connection
			setTimeout(() => {
				try {
					const transport = realtimeSession.transport;
					console.log('[Debug] Transport:', transport);
					console.log('[Debug] Transport keys:', transport ? Object.keys(transport) : 'null');
					const ws = transport?.ws || transport?.socket || transport?._ws || transport?.websocket;
					console.log('[Debug] WebSocket found:', !!ws);
					if (ws && ws.addEventListener) {
						// Create trackable message handler
						wsMessageHandler = (event) => {
							try {
								const data = JSON.parse(event.data);
								handleServerEvent(data);
							} catch (e) {
								console.warn('[WebSocket] Parse error:', e);
							}
						};
						ws.addEventListener('message', wsMessageHandler);
						console.log('[Debug] WebSocket message listener added');
					}
				} catch (e) {
					console.log('[Debug] WebSocket hook error:', e);
				}
			}, 100);

			session = realtimeSession;
			const char = getCharacter(voice);
			currentCharacterName = char.label;
			currentCharacterEmoji = char.emoji;
			currentCharacterMbti = char.mbti ?? '';
			currentVoiceId = voice;
			status = 'connected';
			inputMode = 'voice';
			// Keep RealtimeSession mic muted - we use Web Speech API for input
			if (realtimeSession.muted !== null) realtimeSession.mute(true);
			// Initialize speech recognition
			initSpeechRecognition();
		} catch (e) {
			status = 'error';
			error = e?.message || 'Connection failed.';
		}
	}

	let disconnectMessage = $state('');

	function disconnect() {
		console.log('[API] Disconnecting...');

		// Stop speech recognition
		stopListening();

		// Clear timers
		if (autoSendTimer) {
			clearTimeout(autoSendTimer);
			autoSendTimer = null;
		}

		// Reset states
		liveTranscript = '';
		finalTranscript = '';
		isSpeaking = false;
		streamingText = '';
		streamingMessageId = null;

		// Close session and WebSocket
		if (session) {
			try {
				// Try to close WebSocket directly
				const transport = session.transport;
				const ws = transport?.ws || transport?.socket || transport?._ws || transport?.websocket;
				if (ws) {
					console.log('[API] WebSocket state before close:', ws.readyState);
					// 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
					if (ws.readyState === 1) {
						// OPEN
						ws.close(1000, 'User disconnected');
						console.log('[API] WebSocket close() called');
					}
				}

				// Close session
				session.close();
				console.log('[API] Session close() called');
			} catch (e) {
				console.log('[API] Error during disconnect:', e);
			}
			session = null;
		}

		currentSessionId = null;
		currentVoiceId = null;

		// Show disconnection confirmation
		status = 'disconnected';
		disconnectMessage = 'Connection closed. No more API calls.';
		console.log('[API] Disconnected successfully');

		// After 2 seconds, go back to idle
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
		const transport = session.transport;
		if (transport?.status && transport.status !== 'connected') {
			error = 'Connection lost. Please start a new conversation.';
			status = 'error';
			return false;
		}
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

		// Add user message to log immediately
		conversationLog = [...conversationLog, { role: 'user', text }];
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});

		// Save to DB
		if ($user && currentSessionId) {
			saveMessage($user.id, currentSessionId, currentCharacterName, 'user', text, currentVoiceId);
		}

		// Send to tutor
		if (safeSendMessage(text)) textInput = '';
	}

	function setInputMode(mode) {
		inputMode = mode;
		// Always keep RealtimeSession mic muted (we use Web Speech API)
		if (session?.muted !== null) session.mute(true);
		// Stop listening when switching modes
		if (mode === 'text') {
			stopListening();
			liveTranscript = '';
			finalTranscript = '';
		}
	}

	function toggleMic() {
		if (isListening) {
			stopListening();
		} else {
			startListening();
		}
	}

	function hasUserMessage() {
		return conversationLog.some((m) => m.role === 'user');
	}

	function requestGrammarCorrection() {
		safeSendMessage(
			'Please correct the grammar and spelling in my previous message. Give me the corrected version and briefly explain any mistakes.'
		);
	}

	function requestParaphrase() {
		safeSendMessage(
			'Please paraphrase my previous message into more natural English. Give me a few alternative versions if possible.'
		);
	}

	function requestRandomQuestion() {
		safeSendMessage(
			'Please ask me a random question to practice English conversation. Pick a fun, interesting topic (e.g. hobbies, travel, food, opinions, hypotheticals). Just ask the question directly—no grammar correction or paraphrase needed.'
		);
	}

	// Initialize speech recognition
	function initSpeechRecognition() {
		if (typeof window === 'undefined') return;
		const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SpeechRecognition) {
			error = 'Speech recognition not supported in this browser. Please use Chrome.';
			return;
		}

		recognition = new SpeechRecognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = 'en-US';

		recognition.onresult = (event) => {
			let interim = '';
			let final = finalTranscript;
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const transcript = event.results[i][0].transcript;
				if (event.results[i].isFinal) {
					final += transcript + ' ';
				} else {
					interim += transcript;
				}
			}
			finalTranscript = final;
			liveTranscript = final + interim;

			// Check for "send it" trigger phrase
			const lowerText = liveTranscript.toLowerCase().trim();
			if (lowerText.endsWith('send it') || lowerText.endsWith('send it.')) {
				// Clear any existing timer
				if (autoSendTimer) clearTimeout(autoSendTimer);
				// Start 2 second countdown
				autoSendTimer = setTimeout(() => {
					if (liveTranscript.trim()) {
						// Remove "send it" from the message
						const cleanText = liveTranscript.replace(/send it\.?$/i, '').trim();
						if (cleanText) {
							liveTranscript = cleanText;
							finalTranscript = cleanText;
							sendVoiceMessage();
						}
					}
				}, 2000);
			} else {
				// Clear timer if user continues speaking
				if (autoSendTimer) {
					clearTimeout(autoSendTimer);
					autoSendTimer = null;
				}
			}
		};

		recognition.onerror = (event) => {
			if (event.error !== 'no-speech' && event.error !== 'aborted') {
				console.error('Speech recognition error:', event.error);
			}
		};

		recognition.onend = () => {
			// Auto-restart if still listening
			if (isListening && recognition) {
				try {
					recognition.start();
				} catch (e) {
					console.warn('[Speech] Auto-restart failed:', e);
				}
			}
		};
	}

	function startListening() {
		if (!recognition) initSpeechRecognition();
		if (!recognition) return;

		// Clear any existing transcript
		finalTranscript = '';
		liveTranscript = '';

		// Stop any existing recognition first
		try {
			recognition.stop();
		} catch (e) {
			console.warn('[Speech] Stop failed (may already be stopped):', e);
		}

		// Start fresh after a brief delay
		setTimeout(() => {
			isListening = true;
			try {
				recognition.start();
			} catch (e) {
				console.warn('[Speech] Start failed (may already be started):', e);
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
			} catch (e) {
				console.warn('[Speech] Stop failed:', e);
			}
		}
	}

	function sendVoiceMessage() {
		const text = liveTranscript.trim();
		if (!text || !session) return;

		// Stop listening first to prevent new text from coming in
		const wasListening = isListening;
		if (recognition) {
			try {
				recognition.stop();
			} catch (e) {
				console.warn('[Speech] Stop before send failed:', e);
			}
		}
		isListening = false;

		// Clear transcript immediately
		liveTranscript = '';
		finalTranscript = '';

		// Add user message to log
		conversationLog = [...conversationLog, { role: 'user', text }];
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});

		// Save to DB
		if ($user && currentSessionId) {
			saveMessage($user.id, currentSessionId, currentCharacterName, 'user', text, currentVoiceId);
		}

		// Send to tutor
		safeSendMessage(text);

		// Restart listening if it was on
		if (wasListening) {
			setTimeout(() => {
				startListening();
			}, 100);
		}
	}

	function clearTranscript() {
		liveTranscript = '';
		finalTranscript = '';
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
		historySessions = [];
		selectedSession = null;
		historyMessages = [];
	}
</script>

<div class="h-screen overflow-hidden bg-stone-50 flex">
	<!-- Left: Controls + Input (Preply-style) -->
	<aside
		class="w-full lg:w-[420px] h-screen flex flex-col bg-white border-r border-stone-200 p-8 lg:p-10 overflow-y-auto shrink-0"
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
				<div
					class="mb-6 flex items-center justify-between p-3 bg-stone-50 rounded-xl border border-stone-100"
				>
					<div class="flex items-center gap-3">
						<div class="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center">
							<span class="text-pink-600 text-sm font-medium">
								{($user.user_metadata?.name || $user.email)?.[0]?.toUpperCase() || '?'}
							</span>
						</div>
						<div class="text-sm">
							<p class="font-medium text-stone-700">{$user.user_metadata?.name || 'User'}</p>
							<p class="text-xs text-stone-400">{$user.email}</p>
						</div>
					</div>
					<div class="flex gap-2">
						<button
							onclick={() => (historyView ? backToMain() : loadHistory())}
							class="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
						>
							{historyView ? '← Back' : 'History'}
						</button>
						<button
							onclick={() => signOut()}
							class="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
						>
							Logout
						</button>
					</div>
				</div>
			{:else}
				<div class="mb-6 flex gap-2">
					<a
						href="/login"
						class="flex-1 py-2.5 text-center rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm font-medium transition-colors"
					>
						Log in
					</a>
					<a
						href="/signup"
						class="flex-1 py-2.5 text-center rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium transition-colors"
					>
						Sign up
					</a>
				</div>
			{/if}

			<h1 class="text-2xl font-bold text-stone-900 tracking-tight mb-2">
				Your personal English tutor
			</h1>
			<p class="text-stone-500 text-sm leading-relaxed mb-10">
				Practice with a tutor who corrects your grammar, suggests better expressions, and keeps the
				conversation flowing naturally.
			</p>

			{#if error}
				<div class="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">
					{error}
				</div>
			{/if}

			{#if status === 'idle'}
				<p class="text-stone-600 text-sm mb-3">Let's start with</p>
				<div class="grid grid-cols-2 gap-2">
					{#each voiceOptions as { id, label, emoji, mbti, btn }}
						<button
							onclick={() => connect(id)}
							class="py-3 rounded-xl {btn} text-white font-medium text-sm transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-1.5"
						>
							{label}
							{emoji} ({mbti})
						</button>
					{/each}
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
					<p class="text-stone-600 text-sm">
						Connection was lost or an error occurred. Choose a voice to start a new conversation.
					</p>
					<p class="text-stone-500 text-xs">Let's start with</p>
					<div class="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto">
						{#each voiceOptions as { id, label, emoji, mbti, btn }}
							<button
								onclick={() => connect(id)}
								class="py-2.5 rounded-xl {btn} text-white font-medium text-sm transition-all flex items-center justify-center gap-1.5"
							>
								{label}
								{emoji} ({mbti})
							</button>
						{/each}
					</div>
				</div>
			{:else if status === 'connected'}
				<div class="space-y-6">
					<!-- Voice / Text mode toggle -->
					<div class="flex rounded-xl bg-stone-100 p-1">
						<button
							onclick={() => setInputMode('voice')}
							class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
								{inputMode === 'voice'
								? 'bg-white text-stone-900 shadow-sm'
								: 'text-stone-500 hover:text-stone-700'}"
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

					{#if inputMode === 'voice'}
						<!-- Voice mode: Live transcription with manual send -->
						<div
							class="rounded-2xl border p-5 flex flex-col gap-4 {isListening
								? 'bg-emerald-50 border-emerald-100'
								: 'bg-stone-50 border-stone-200'}"
						>
							<!-- Mic status indicator -->
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
										<p class="text-emerald-700 font-medium text-sm">Listening...</p>
										<p class="text-emerald-600/70 text-xs">
											Speak naturally. Click send when done.
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

							<!-- Live transcript display -->
							{#if liveTranscript || isListening}
								<div class="bg-white rounded-xl border border-stone-200 p-4 min-h-[80px]">
									{#if liveTranscript}
										<p class="text-stone-800 text-sm leading-relaxed">{liveTranscript}</p>
									{:else}
										<p class="text-stone-400 text-sm italic">Start speaking...</p>
									{/if}
								</div>
							{/if}

							<!-- Control buttons -->
							<div class="flex gap-2">
								<button
									onclick={toggleMic}
									class="flex-1 py-3 rounded-xl font-medium text-sm transition-colors {isListening
										? 'bg-stone-200 hover:bg-stone-300 text-stone-700'
										: 'bg-emerald-500 hover:bg-emerald-600 text-white'}"
								>
									{isListening ? 'Stop mic' : 'Start mic'}
								</button>

								{#if liveTranscript.trim()}
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

							{#if liveTranscript.trim()}
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
		<div class="flex-1 flex flex-col min-h-0 p-6 lg:p-10">
			{#if historyView === 'list'}
				<div
					class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden"
				>
					<div class="shrink-0 px-6 py-4 border-b border-stone-100 bg-stone-50/50">
						<h2 class="text-sm font-semibold text-stone-700">Past Conversations</h2>
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
								{#each historySessions as sess}
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
							<h2 class="text-sm font-semibold text-stone-700">
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
							{#each historyMessages as msg}
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
							<h2 class="text-sm font-semibold text-stone-700">Conversation</h2>
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
									🥳
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
							{#each conversationLog as msg, i}
								{@const isLastAssistant =
									msg.role === 'assistant' && i === conversationLog.length - 1}
								{@const showSpeaking = isLastAssistant && (msg.isStreaming || isSpeaking)}
								<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
									<div
										class="max-w-[85%] rounded-2xl px-4 py-3 text-sm {msg.role === 'user'
											? 'bg-rose-50 text-stone-900 border border-rose-100'
											: 'bg-stone-50 text-stone-800 border border-stone-100'}"
									>
										<span
											class="text-xs font-medium text-stone-600 mb-1.5 flex items-center gap-1.5"
										>
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

<!-- 온보딩 모달: 로그인 후 프로필/동의 미완료 시 표시 -->
{#if $user && !$authLoading && !$onboardingLoading && !$onboardingComplete}
	<OnboardingModal userId={$user.id} onComplete={() => checkOnboardingStatus($user.id)} />
{/if}
