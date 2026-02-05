<script>
	import { RealtimeAgent, RealtimeSession } from '@openai/agents-realtime';

	let status = $state('idle');
	let error = $state(null);
	let session = $state(null);
	let conversationLog = $state([]);
	let logContainer = $state(null);

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
			// status가 completed일 때만 표시 → 최종 확정된 transcript 사용 (더 정확함)
			if (item.status && item.status !== 'completed') continue;
			const text = getMessageText(item);
			if (!text?.trim()) continue;
			const role = item.role === 'user' ? 'user' : 'assistant';
			log.push({ role, text });
		}
		conversationLog = log;
		// 새 메시지 시 스크롤 하단으로
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});
	}

	async function connect() {
		status = 'connecting';
		error = null;
		conversationLog = [];

		try {
			const res = await fetch('/api/realtime-token', { method: 'POST' });
			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || data.details || '토큰 발급 실패');
			}

			const ephemeralKey = data.value;
			if (!ephemeralKey) {
				throw new Error('토큰을 받지 못했습니다.');
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
		} catch (e) {
			status = 'error';
			error = e?.message || '연결에 실패했습니다.';
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
</script>

<div class="min-h-screen nordic-bg text-stone-800 flex flex-col px-4 py-8 md:px-8 lg:px-16">
	<div class="max-w-2xl mx-auto w-full flex flex-col gap-6">
		<div class="rounded-2xl bg-white/90 backdrop-blur-md border border-stone-200/80 shadow-xl shadow-stone-200/30 p-8 md:p-10">
			<h1 class="text-2xl md:text-3xl font-medium tracking-tight text-stone-800 text-center mb-2" style="font-family: 'Playfair Display', serif;">
				AI 영어 회화 선생님
			</h1>
			<p class="text-stone-500 text-sm text-center mb-8">
				친근한 AI 선생님과 중급 수준 영어 회화를 연습해 보세요.
			</p>

			{#if error}
				<div class="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
					{error}
				</div>
			{/if}

			<div class="flex flex-col items-center gap-6">
				{#if status === 'idle'}
					<button
						onclick={connect}
						class="w-48 py-4 rounded-xl bg-teal-400/90 hover:bg-teal-500 text-white font-medium transition-all duration-200 shadow-md"
					>
						대화 시작하기
					</button>
					<p class="text-stone-500 text-sm text-center">
						마이크 권한을 허용하면 바로 대화를 시작할 수 있어요.
					</p>
				{:else if status === 'connecting'}
					<div class="flex flex-col items-center gap-4">
						<div class="w-12 h-12 border-4 border-teal-400 border-t-transparent rounded-full animate-spin"></div>
						<p class="text-stone-500 text-sm">연결 중...</p>
					</div>
				{:else if status === 'connected'}
					<div class="flex flex-col items-center gap-6 w-full">
						<div class="flex items-center gap-2 text-teal-600">
							<span class="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
							<span class="text-sm font-medium">대화 중</span>
						</div>
						<p class="text-stone-500 text-sm text-center">
							마이크에 대고 말해 보세요. AI 선생님이 응답할 거예요.
						</p>
						<button
							onclick={disconnect}
							class="px-6 py-2 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-700 text-sm font-medium transition-colors"
						>
							대화 종료
						</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- 대화 기록 -->
		{#if status === 'connected' || conversationLog.length > 0}
			<div class="rounded-2xl bg-white/90 backdrop-blur-md border border-stone-200/80 shadow-xl shadow-stone-200/30 overflow-hidden flex flex-col">
				<div class="px-4 py-3 border-b border-stone-200 bg-stone-50/50">
					<h2 class="text-sm font-medium text-stone-600">대화 기록</h2>
				</div>
				<div
					bind:this={logContainer}
					class="flex-1 min-h-[200px] max-h-[400px] overflow-y-auto p-4 space-y-4"
					role="log"
					aria-label="대화 기록"
				>
					{#if conversationLog.length === 0}
						<p class="text-stone-400 text-sm text-center py-8">대화를 시작하면 여기에 기록이 표시됩니다.</p>
					{:else}
						{#each conversationLog as { role, text }}
							<div
								class="flex {role === 'user' ? 'justify-end' : 'justify-start'}"
							>
								<div
									class="max-w-[85%] rounded-xl px-4 py-2.5 text-sm {role === 'user'
										? 'bg-teal-100 text-teal-900'
										: 'bg-stone-100 text-stone-800'}"
								>
									{#if role === 'user'}
										<span class="text-xs text-stone-500 block mb-1">나</span>
									{:else}
										<span class="text-xs text-stone-500 block mb-1">AI 선생님</span>
									{/if}
									<p class="whitespace-pre-wrap break-words">{text}</p>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
