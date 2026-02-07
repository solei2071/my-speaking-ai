<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabase.js';

	let status = $state('Verifying...');
	let error = $state(null);

	onMount(async () => {
		try {
			// Supabase automatically picks up hash fragments from URL
			// and exchanges them for a session
			const { data: { session }, error: authError } = await supabase.auth.getSession();

			if (authError) {
				error = authError.message;
				status = 'Verification failed';
				return;
			}

			if (session) {
				status = 'Email verified! Redirecting...';
				// Redirect to home after successful verification
				setTimeout(() => goto('/'), 1500);
			} else {
				// Check for error in URL hash
				const hashParams = new URLSearchParams(window.location.hash?.slice(1) || '');
				const errorCode = hashParams.get('error_code');
				const errorDesc = hashParams.get('error_description');

				if (errorCode || errorDesc) {
					error = errorDesc || `Error: ${errorCode}`;
					status = 'Verification failed';
				} else {
					// No session and no error - might be loading
					status = 'No session found. You may have already verified.';
					setTimeout(() => goto('/'), 2000);
				}
			}
		} catch (e) {
			error = e?.message || 'Something went wrong';
			status = 'Verification failed';
		}
	});
</script>

<div class="min-h-screen bg-stone-50 flex items-center justify-center p-4">
	<div class="w-full max-w-md bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
		{#if error}
			<div class="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</div>
			<p class="text-red-600 font-medium">{status}</p>
			<p class="text-stone-500 text-sm mt-2">{error}</p>
		{:else}
			<div class="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
				<div class="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
			</div>
			<p class="text-stone-700 font-medium">{status}</p>
		{/if}

		<a href="/" class="inline-block mt-6 text-sm text-pink-500 hover:text-pink-600 font-medium">
			Go to home
		</a>
	</div>
</div>
