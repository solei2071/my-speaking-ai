<script>
	import { onMount } from 'svelte';

	let hasError = $state(false);
	let errorMessage = $state('');
	let errorStack = $state('');

	onMount(() => {
		const handleError = (event) => {
			hasError = true;
			errorMessage = event.error?.message || '예상치 못한 오류가 발생했습니다';
			errorStack = event.error?.stack || '';
			console.error('[ErrorBoundary] 에러 포착:', event.error);
			event.preventDefault();
		};

		const handleRejection = (event) => {
			hasError = true;
			errorMessage = event.reason?.message || String(event.reason);
			errorStack = event.reason?.stack || '';
			console.error('[ErrorBoundary] Promise rejection:', event.reason);
			event.preventDefault();
		};

		window.addEventListener('error', handleError);
		window.addEventListener('unhandledrejection', handleRejection);

		return () => {
			window.removeEventListener('error', handleError);
			window.removeEventListener('unhandledrejection', handleRejection);
		};
	});

	function reload() {
		window.location.reload();
	}
	function dismiss() {
		hasError = false;
	}
</script>

{#if hasError}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
		<div class="max-w-lg w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
			<div class="bg-red-50 px-6 py-5 border-b border-red-100">
				<h2 class="text-xl font-bold text-red-900">오류가 발생했습니다</h2>
			</div>
			<div class="px-6 py-5">
				<div class="p-4 bg-red-50 rounded-xl border border-red-100">
					<p class="text-sm text-red-900 font-medium">{errorMessage}</p>
					{#if errorStack && import.meta.env.DEV}
						<details class="mt-3">
							<summary class="text-xs text-red-700 cursor-pointer">기술적 세부사항</summary>
							<pre
								class="mt-2 text-xs text-red-700 overflow-auto max-h-40 p-3 bg-red-100 rounded">{errorStack}</pre>
						</details>
					{/if}
				</div>
			</div>
			<div class="px-6 py-4 bg-stone-50 border-t flex gap-3">
				<button
					onclick={reload}
					class="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium"
				>
					페이지 새로고침
				</button>
				<button
					onclick={dismiss}
					class="flex-1 py-3 rounded-xl border border-stone-200 hover:bg-white text-stone-700 font-medium"
				>
					닫기
				</button>
			</div>
		</div>
	</div>
{/if}

<slot />
