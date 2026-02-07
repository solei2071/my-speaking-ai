<script>
	import { signUp } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let success = $state('');
	let isLoading = $state(false);
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);

	async function handleSignUp(e) {
		e.preventDefault();
		error = '';
		success = '';

		// Validation
		if (!email || !password) {
			error = 'Email and password are required';
			return;
		}

		if (password.length < 6) {
			error = 'Password must be at least 6 characters';
			return;
		}

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			return;
		}

		isLoading = true;

		try {
			await signUp(email, password, name);
			success = 'Account created! Please check your email to verify your account.';
			// Clear form
			name = '';
			email = '';
			password = '';
			confirmPassword = '';
		} catch (e) {
			error = e?.message || 'Sign up failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="min-h-screen bg-stone-50 flex items-center justify-center p-4">
	<div class="w-full max-w-md">
		<div class="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
			<div class="text-center mb-8">
				<h1 class="text-2xl font-bold text-stone-900">Create Account</h1>
				<p class="text-stone-500 text-sm mt-2">Join and start learning English</p>
			</div>

			{#if error}
				<div class="mb-6 p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
					{error}
				</div>
			{/if}

			{#if success}
				<div class="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm">
					{success}
				</div>
			{/if}

			<form onsubmit={handleSignUp} class="space-y-4">
				<div>
					<label for="name" class="block text-sm font-medium text-stone-700 mb-1">Name</label>
					<input
						id="name"
						type="text"
						bind:value={name}
						placeholder="Your name"
						class="w-full px-4 py-3 rounded-xl border border-stone-200 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-300"
					/>
				</div>

				<div>
					<label for="email" class="block text-sm font-medium text-stone-700 mb-1">Email</label>
					<input
						id="email"
						type="email"
						bind:value={email}
						placeholder="you@example.com"
						required
						class="w-full px-4 py-3 rounded-xl border border-stone-200 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-300"
					/>
				</div>

				<div>
					<label for="password" class="block text-sm font-medium text-stone-700 mb-1">Password</label>
					<div class="relative">
						<input
							id="password"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							placeholder="At least 6 characters"
							required
							class="w-full px-4 py-3 pr-12 rounded-xl border border-stone-200 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-300"
						/>
						<button
							type="button"
							onclick={() => showPassword = !showPassword}
							class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600 transition-colors"
							tabindex="-1"
						>
							{#if showPassword}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
								</svg>
							{:else}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<div>
					<label for="confirmPassword" class="block text-sm font-medium text-stone-700 mb-1">Confirm Password</label>
					<div class="relative">
						<input
							id="confirmPassword"
							type={showConfirmPassword ? 'text' : 'password'}
							bind:value={confirmPassword}
							placeholder="Confirm your password"
							required
							class="w-full px-4 py-3 pr-12 rounded-xl border border-stone-200 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-300"
						/>
						<button
							type="button"
							onclick={() => showConfirmPassword = !showConfirmPassword}
							class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600 transition-colors"
							tabindex="-1"
						>
							{#if showConfirmPassword}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
								</svg>
							{:else}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<button
					type="submit"
					disabled={isLoading}
					class="w-full py-3 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-medium text-sm transition-colors"
				>
					{isLoading ? 'Creating account...' : 'Sign Up'}
				</button>
			</form>

			<div class="mt-6 text-center">
				<p class="text-sm text-stone-500">
					Already have an account?
					<a href="/login" class="text-pink-500 hover:text-pink-600 font-medium">Log in</a>
				</p>
			</div>
		</div>

		<div class="mt-4 text-center">
			<a href="/" class="text-sm text-stone-500 hover:text-stone-700">← Back to home</a>
		</div>
	</div>
</div>
