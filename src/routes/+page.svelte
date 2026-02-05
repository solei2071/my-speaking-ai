<script>
	import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';

	let status = $state('idle');
	let error = $state(null);
	let session = $state(null);
	let conversationLog = $state([]);
	let logContainer = $state(null);
	let textInput = $state('');
	let inputMode = $state('voice'); // 'voice' | 'text'
	let micOn = $state(true); // voice 모드에서 마이크 on/off

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

	function updateConversationLog(history) {
		const log = [];
		for (const item of history) {
			if (item.type !== 'message') continue;
			if (item.status && item.status !== 'completed') continue;
			const text = getMessageText(item);
			if (!text?.trim()) continue;
			const role = item.role === 'user' ? 'user' : 'assistant';
			log.push({ role, text });
		}
		conversationLog = log;
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
				const msg = data.details ? `${data.error || 'Failed to get token'}: ${data.details}` : (data.error || data.details || 'Failed to get token.');
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
			await realtimeSession.connect({ apiKey: ephemeralKey });

			session = realtimeSession;
			status = 'connected';
			inputMode = 'voice';
			micOn = false; // 처음엔 마이크 꺼짐, Start mic 눌러야 활성화
			if (realtimeSession.muted !== null) realtimeSession.mute(true);
		} catch (e) {
			status = 'error';
			error = e?.message || 'Connection failed.';
		}
	}

	function disconnect() {
		if (session) {
			try {
				session.close();
			} catch (_) {}
			session = null;
		}
		status = 'idle';
		error = null;
	}

	function sendText() {
		const text = textInput.trim();
		if (!text || !session) return;
		session.sendMessage(text);
		textInput = '';
	}

	function setInputMode(mode) {
		inputMode = mode;
		if (mode === 'voice') {
			micOn = false; // 처음엔 마이크 꺼진 상태, Start mic 눌러야 활성화
			if (session?.muted !== null) session.mute(true);
		} else {
			micOn = false;
			if (session?.muted !== null) session.mute(true);
		}
	}

	function toggleMic() {
		micOn = !micOn;
		if (session?.muted !== null) session.mute(!micOn);
	}

	function hasUserMessage() {
		return conversationLog.some((m) => m.role === 'user');
	}

	function requestGrammarCorrection() {
		if (!session) return;
		session.sendMessage(
			'Please correct the grammar and spelling in my previous message. Give me the corrected version and briefly explain any mistakes.'
		);
	}

	function requestParaphrase() {
		if (!session) return;
		session.sendMessage(
			'Please paraphrase my previous message into more natural English. Give me a few alternative versions if possible.'
		);
	}
</script>

<div class="min-h-screen bg-stone-50 flex">
	<!-- Left: Controls + Input (Preply-style) -->
	<aside class="w-full lg:w-[420px] lg:min-h-screen flex flex-col bg-white border-r border-stone-200 p-8 lg:p-10">
		<div class="flex-1">
			<h1 class="text-2xl font-bold text-stone-900 tracking-tight mb-2">
				Learn faster with your personal AI English tutor
			</h1>
			<p class="text-stone-500 text-sm leading-relaxed mb-10">
				Practice with a tutor who corrects your grammar, helps you paraphrase, and designs every lesson around your goals.
			</p>

			{#if error}
				<div class="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm">
					{error}
				</div>
			{/if}

			{#if status === 'idle'}
				{@const voiceOptions = [
					{ id: 'sage', label: 'Rachel', btn: 'bg-violet-500 hover:bg-violet-600 shadow-violet-500/20' },
					{ id: 'echo', label: 'Sh', btn: 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/20' },
					{ id: 'verse', label: 'Verse', btn: 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20' },
					{ id: 'marin', label: 'Marin', btn: 'bg-teal-500 hover:bg-teal-600 shadow-teal-500/20' },
					{ id: 'alloy', label: 'Alloy', btn: 'bg-slate-500 hover:bg-slate-600 shadow-slate-500/20' },
					{ id: 'ash', label: 'Ash', btn: 'bg-stone-500 hover:bg-stone-600 shadow-stone-500/20' },
					{ id: 'ballad', label: 'Ballad', btn: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' },
					{ id: 'coral', label: 'Coral', btn: 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' },
					{ id: 'shimmer', label: 'Shimmer', btn: 'bg-fuchsia-500 hover:bg-fuchsia-600 shadow-fuchsia-500/20' },
					{ id: 'cedar', label: 'Cedar', btn: 'bg-lime-600 hover:bg-lime-700 shadow-lime-500/20' }
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
			{:else if status === 'connected'}
				<div class="space-y-6">
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
						<span class="text-sm font-medium text-stone-700">In conversation</span>
					</div>

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
						<!-- Voice mode: Listening state or Mic off -->
						<div class="rounded-2xl border p-6 flex flex-col items-center gap-4 {micOn ? 'bg-emerald-50 border-emerald-100' : 'bg-stone-50 border-stone-200'}">
							{#if micOn}
								<div class="relative">
									<div class="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center animate-pulse">
										<div class="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center">
											<svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
												<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
												<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
											</svg>
										</div>
									</div>
									<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
										<div class="w-20 h-20 rounded-full border-2 border-emerald-400/50 listening-ripple"></div>
									</div>
								</div>
								<div class="text-center">
									<p class="text-emerald-700 font-medium text-sm">Listening...</p>
									<p class="text-emerald-600/80 text-xs mt-1">Speak now. I'm ready to hear you.</p>
								</div>
							{:else}
								<div class="w-16 h-16 rounded-full bg-stone-200 flex items-center justify-center">
									<svg class="w-8 h-8 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0V8a5 5 0 0110 0v3z" />
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 5l14 14" />
									</svg>
								</div>
								<div class="text-center">
									<p class="text-stone-600 font-medium text-sm">Mic is off</p>
									<p class="text-stone-500 text-xs mt-1">Click Start mic to speak.</p>
								</div>
							{/if}
							<button
								onclick={toggleMic}
								class="w-full py-3 rounded-xl font-medium text-sm transition-colors {micOn
									? 'bg-rose-500 hover:bg-rose-600 text-white'
									: 'bg-emerald-500 hover:bg-emerald-600 text-white'}"
							>
								{micOn ? 'Stop mic' : 'Start mic'}
							</button>
						</div>
					{:else}
						<div class="space-y-3">
							<label class="block text-sm font-medium text-stone-600">Type your message</label>
							<div class="flex gap-2">
								<input
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
						class="w-full py-2.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm font-medium transition-colors"
					>
						End conversation
					</button>
				</div>
			{/if}
		</div>
	</aside>

	<!-- Right: Conversation -->
	<main class="flex-1 flex flex-col min-h-screen">
		<div class="flex-1 flex flex-col p-6 lg:p-10">
			<div class="flex-1 rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden flex flex-col">
				<div class="px-6 py-4 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between gap-4 flex-wrap">
					<h2 class="text-sm font-semibold text-stone-700">Conversation</h2>
					{#if status === 'connected' && hasUserMessage()}
						<div class="flex gap-2">
							<button
								onclick={requestGrammarCorrection}
								class="px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 text-xs font-medium transition-colors"
							>
								Adjust grammar
							</button>
							<button
								onclick={requestParaphrase}
								class="px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 text-xs font-medium transition-colors"
							>
								Paraphrase
							</button>
						</div>
					{/if}
				</div>
				<div
					bind:this={logContainer}
					class="flex-1 min-h-[300px] overflow-y-auto p-6 space-y-4"
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
						{#each conversationLog as { role, text }}
							<div class="flex {role === 'user' ? 'justify-end' : 'justify-start'}">
								<div
									class="max-w-[85%] rounded-2xl px-4 py-3 text-sm {role === 'user'
										? 'bg-rose-50 text-stone-900 border border-rose-100'
										: 'bg-stone-50 text-stone-800 border border-stone-100'}"
								>
									<span class="text-xs font-medium text-stone-600 block mb-1.5">
										{role === 'user' ? 'You' : 'AI Tutor'}
									</span>
									<p class="whitespace-pre-wrap break-words leading-relaxed">{text}</p>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</main>
</div>
