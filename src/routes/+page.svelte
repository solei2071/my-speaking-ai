<script>
	import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';

	const VOICE_LABELS = { sage: 'Rachel', echo: 'Sh', verse: 'Arnold', marin: 'Marin', alloy: 'Alloy', ash: 'Ash', ballad: 'Ballad', coral: 'Coral', shimmer: 'Shimmer', cedar: 'Cedar' };
	let status = $state('idle');
	let error = $state(null);
	let session = $state(null);
	let currentCharacterName = $state('Tutor');
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
				conversationLog = [...conversationLog.slice(0, -1), { role: 'assistant', text: streamingText }];
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
			conversationLog = [...conversationLog.slice(0, -1), { role: 'assistant', text, isStreaming: true }];
		}
		// If no messages or last is completed assistant (shouldn't happen normally)
		else if (!lastMsg || lastMsg.role === 'assistant') {
			// Check if we need to add a new streaming message
			const userCount = conversationLog.filter(m => m.role === 'user').length;
			const assistantCount = conversationLog.filter(m => m.role === 'assistant').length;
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
				conversationLog = [...conversationLog.slice(0, -1), { role: 'assistant', text: latestCompletedText }];
				isSpeaking = false;
			}
			// Or add if there's no assistant message yet
			else if (lastMsg?.role === 'user') {
				conversationLog = [...conversationLog, { role: 'assistant', text: latestCompletedText }];
			}
			// Or update if text changed
			else if (lastMsg?.role === 'assistant' && lastMsg.text !== latestCompletedText) {
				conversationLog = [...conversationLog.slice(0, -1), { role: 'assistant', text: latestCompletedText }];
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

		try {
			const res = await fetch('/api/realtime-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ voice })
			});
			const data = await res.json();

			if (!res.ok) {
				let msg = data.details ? `${data.error || 'Failed to get token'}: ${data.details}` : (data.error || data.details || 'Failed to get token.');
				if (data.hint) msg += ` ${data.hint}`;
				throw new Error(msg);
			}

			const ephemeralKey = data.value;
			if (!ephemeralKey) {
				throw new Error('Couldn\'t get token.');
			}

			const agent = new RealtimeAgent({
				name: 'English Teacher',
				instructions: `You are a friendly English conversation teacher for intermediate learners.`
			});

			const realtimeSession = new RealtimeSession(agent);
			realtimeSession.on('history_updated', (history) => updateConversationLog(history));
			realtimeSession.on('error', (e) => {
				error = e?.error?.message ?? String(e?.error ?? e);
				status = 'error';
				session = null;
				isSpeaking = false;
			});
			realtimeSession.on('audio_done', () => {
				isSpeaking = false;
				streamingMessageId = null;
				// Mark streaming message as complete
				const lastMsg = conversationLog[conversationLog.length - 1];
				if (lastMsg?.isStreaming) {
					conversationLog = [...conversationLog.slice(0, -1), { role: 'assistant', text: lastMsg.text }];
				}
			});
			realtimeSession.transport?.on?.('connection_change', (connStatus) => {
				if (connStatus === 'disconnected') {
					error = 'Connection lost. Please start a new conversation.';
					status = 'error';
					session = null;
					isSpeaking = false;
				}
			});

			// Listen to various events for real-time streaming
			realtimeSession.on('server_event', (event) => handleServerEvent(event));
			realtimeSession.on('message', (event) => handleServerEvent(event));
			realtimeSession.on('response', (event) => handleServerEvent(event));
			realtimeSession.on('transcript', (data) => {
				if (data?.text || data?.delta) {
					isSpeaking = true;
					streamingText += data.delta || '';
					if (data.text) streamingText = data.text;
					updateStreamingMessage(streamingText);
				}
			});
			
			// Also try transport events
			realtimeSession.transport?.on?.('message', (event) => handleServerEvent(event));

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
						ws.addEventListener('message', (event) => {
							try {
								const data = JSON.parse(event.data);
								handleServerEvent(data);
							} catch (_) {}
						});
						console.log('[Debug] WebSocket message listener added');
					}
				} catch (e) {
					console.log('[Debug] WebSocket hook error:', e);
				}
			}, 100);

			session = realtimeSession;
			currentCharacterName = VOICE_LABELS[voice] ?? 'Tutor';
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
					if (ws.readyState === 1) { // OPEN
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
				} catch (_) {}
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
		} catch (_) {}

		// Start fresh after a brief delay
		setTimeout(() => {
			isListening = true;
			try {
				recognition.start();
			} catch (_) {
				// Already started
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
			} catch (_) {}
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
			} catch (_) {}
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
</script>

<div class="h-screen overflow-hidden bg-stone-50 flex">
	<!-- Left: Controls + Input (Preply-style) -->
	<aside class="w-full lg:w-[420px] h-screen flex flex-col bg-white border-r border-stone-200 p-8 lg:p-10 overflow-y-auto shrink-0">
		<div class="flex-1">
			<h1 class="text-2xl font-bold text-stone-900 tracking-tight mb-2">
				Your personal English tutor
			</h1>
			<p class="text-stone-500 text-sm leading-relaxed mb-10">
				Practice with a tutor who corrects your grammar, suggests better expressions, and keeps the conversation flowing naturally.
			</p>

			{#if error}
				<div class="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">
					{error}
				</div>
			{/if}

			{#if status === 'idle'}
				{@const voiceOptions = [
					{ id: 'sage', label: 'Rachel', btn: 'bg-pink-400 hover:bg-pink-500 shadow-pink-400/20' },
					{ id: 'echo', label: 'Sh', btn: 'bg-teal-400 hover:bg-teal-500 shadow-teal-400/20' },
					{ id: 'verse', label: 'Arnold', btn: 'bg-emerald-400 hover:bg-emerald-500 shadow-emerald-400/20' },
					{ id: 'marin', label: 'Marin', btn: 'bg-violet-400 hover:bg-violet-500 shadow-violet-400/20' },
					{ id: 'alloy', label: 'Alloy', btn: 'bg-amber-400 hover:bg-amber-500 shadow-amber-400/20' },
					{ id: 'ash', label: 'Ash', btn: 'bg-stone-400 hover:bg-stone-500 shadow-stone-400/20' },
					{ id: 'ballad', label: 'Ballad', btn: 'bg-sky-400 hover:bg-sky-500 shadow-sky-400/20' },
					{ id: 'coral', label: 'Coral', btn: 'bg-coral hover:bg-[#e07360] shadow-[#eb8374]/20' },
					{ id: 'shimmer', label: 'Shimmer', btn: 'bg-fuchsia-400 hover:bg-fuchsia-500 shadow-fuchsia-400/20' },
					{ id: 'cedar', label: 'Cedar', btn: 'bg-green-600 hover:bg-green-700 shadow-green-600/20' }
				]}
				<div class="space-y-3">
					{#each voiceOptions as { id, label, btn }}
						<button
							onclick={() => connect(id)}
							class="w-full py-3 rounded-xl {btn} text-white font-medium text-sm transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
						>
							Let's start with {label}
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
							</svg>
						</button>
					{/each}
				</div>
				<p class="text-stone-400 text-xs mt-4 text-center">
					Allow mic access and you're good to go!
				</p>
			{:else if status === 'connecting'}
				<div class="flex flex-col items-center gap-4 py-12">
					<div class="w-10 h-10 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
					<p class="text-stone-500 text-sm">Connecting...</p>
				</div>
			{:else if status === 'disconnected'}
				<div class="flex flex-col items-center gap-4 py-12">
					<div class="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
						<svg class="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
					</div>
					<div class="text-center">
						<p class="text-emerald-700 font-medium text-sm">Disconnected</p>
						<p class="text-stone-500 text-xs mt-1">{disconnectMessage}</p>
					</div>
				</div>
			{:else if status === 'error'}
				{@const errorVoiceOptions = [
					{ id: 'sage', label: 'Rachel', btn: 'bg-pink-400 hover:bg-pink-500 shadow-pink-400/20' },
					{ id: 'echo', label: 'Sh', btn: 'bg-teal-400 hover:bg-teal-500 shadow-teal-400/20' },
					{ id: 'verse', label: 'Arnold', btn: 'bg-emerald-400 hover:bg-emerald-500 shadow-emerald-400/20' },
					{ id: 'marin', label: 'Marin', btn: 'bg-violet-400 hover:bg-violet-500 shadow-violet-400/20' },
					{ id: 'alloy', label: 'Alloy', btn: 'bg-amber-400 hover:bg-amber-500 shadow-amber-400/20' },
					{ id: 'ash', label: 'Ash', btn: 'bg-stone-400 hover:bg-stone-500 shadow-stone-400/20' },
					{ id: 'ballad', label: 'Ballad', btn: 'bg-sky-400 hover:bg-sky-500 shadow-sky-400/20' },
					{ id: 'coral', label: 'Coral', btn: 'bg-coral hover:bg-[#e07360] shadow-[#eb8374]/20' },
					{ id: 'shimmer', label: 'Shimmer', btn: 'bg-fuchsia-400 hover:bg-fuchsia-500 shadow-fuchsia-400/20' },
					{ id: 'cedar', label: 'Cedar', btn: 'bg-green-600 hover:bg-green-700 shadow-green-600/20' }
				]}
				<div class="space-y-4">
					<p class="text-stone-600 text-sm">Connection was lost or an error occurred. Choose a voice to start a new conversation.</p>
					<div class="space-y-2 max-h-[280px] overflow-y-auto">
						{#each errorVoiceOptions as { id, label, btn }}
							<button
								onclick={() => connect(id)}
								class="w-full py-2.5 rounded-xl {btn} text-white font-medium text-sm transition-all flex items-center justify-center gap-2"
							>
								Let's start with {label}
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
								</svg>
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
								{inputMode === 'voice' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z" />
							</svg>
							Voice
						</button>
						<button
							onclick={() => setInputMode('text')}
							class="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
								{inputMode === 'text' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
							</svg>
							Text
						</button>
					</div>

					{#if inputMode === 'voice'}
						<!-- Voice mode: Live transcription with manual send -->
						<div class="rounded-2xl border p-5 flex flex-col gap-4 {isListening ? 'bg-emerald-50 border-emerald-100' : 'bg-stone-50 border-stone-200'}">
							<!-- Mic status indicator -->
							<div class="flex items-center gap-3">
								{#if isListening}
									<div class="relative">
										<div class="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center animate-pulse">
											<svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
												<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
												<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
											</svg>
										</div>
									</div>
									<div>
										<p class="text-emerald-700 font-medium text-sm">Listening...</p>
										<p class="text-emerald-600/70 text-xs">Speak naturally. Click send when done.</p>
									</div>
								{:else}
									<div class="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center">
										<svg class="w-5 h-5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z" />
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
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
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
							<label for="text-input" class="block text-sm font-medium text-stone-600">Type your message</label>
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
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
						</svg>
						End & disconnect
					</button>
				</div>
			{/if}
		</div>
	</aside>

	<!-- Right: Conversation (only this area scrolls) -->
	<main class="flex-1 flex flex-col min-h-0 overflow-hidden">
		<div class="flex-1 flex flex-col min-h-0 p-6 lg:p-10">
			<div class="flex-1 flex flex-col min-h-0 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden">
				<div class="shrink-0 px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between gap-4 flex-wrap">
					<div class="flex items-center gap-2">
						<h2 class="text-sm font-semibold text-stone-700">Conversation</h2>
						{#if status === 'connected'}
							<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="API Connected"></span>
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
								title={hasUserMessage() ? 'Correct grammar of your last message' : 'Send a message first'}
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
						<div class="flex flex-col items-center justify-center h-full min-h-[280px] text-center">
							<div class="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mb-4">
								<svg class="w-8 h-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
								</svg>
							</div>
							<p class="text-stone-500 text-sm max-w-[240px]">
								Your conversation will show up here once you start!
							</p>
						</div>
					{:else}
						{#each conversationLog as msg, i}
							{@const isLastAssistant = msg.role === 'assistant' && i === conversationLog.length - 1}
							{@const showSpeaking = isLastAssistant && (msg.isStreaming || isSpeaking)}
							<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
								<div
									class="max-w-[85%] rounded-2xl px-4 py-3 text-sm {msg.role === 'user'
										? 'bg-rose-50 text-stone-900 border border-rose-100'
										: 'bg-stone-50 text-stone-800 border border-stone-100'}"
								>
									<span class="text-xs font-medium text-stone-600 mb-1.5 flex items-center gap-1.5">
										{msg.role === 'user' ? 'You' : currentCharacterName}
										{#if showSpeaking}
											<span class="speaking-animation inline-flex items-center gap-0.5">
												<span class="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
												<span class="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
												<span class="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
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
		</div>
	</main>
</div>
