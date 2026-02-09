<script>
	import { supabase } from '$lib/supabase.js';

	let connectionStatus = $state('Not tested');
	let testResult = $state(null);
	let error = $state(null);
	let isLoading = $state(false);

	// Test data
	let testName = $state('Test User');
	let testMessage = $state('Hello from test!');
	let allMessages = $state([]);

	async function testConnection() {
		isLoading = true;
		error = null;
		testResult = null;

		try {
			// Simple query to test connection
			const { data, error: queryError } = await supabase.from('messages').select('count').limit(1);

			if (queryError) {
				if (queryError.code === '42P01') {
					// Table doesn't exist
					connectionStatus = 'Connected (table not found)';
					testResult =
						'Connection successful! But "messages" table does not exist. Create it first.';
				} else {
					throw queryError;
				}
			} else {
				connectionStatus = 'Connected';
				testResult = 'Connection successful! Table exists.';
			}
		} catch (e) {
			connectionStatus = 'Failed';
			error = e?.message || 'Unknown error';
		} finally {
			isLoading = false;
		}
	}

	async function insertTestData() {
		isLoading = true;
		error = null;

		try {
			const { data, error: insertError } = await supabase
				.from('messages')
				.insert([{ user_name: testName, content: testMessage }])
				.select();

			if (insertError) throw insertError;

			testResult = `Inserted successfully! ID: ${data?.[0]?.id}`;
			await fetchAllMessages();
		} catch (e) {
			error = e?.message || 'Insert failed';
		} finally {
			isLoading = false;
		}
	}

	async function fetchAllMessages() {
		isLoading = true;
		error = null;

		try {
			const { data, error: fetchError } = await supabase
				.from('messages')
				.select('*')
				.order('created_at', { ascending: false })
				.limit(10);

			if (fetchError) throw fetchError;

			allMessages = data || [];
			testResult = `Fetched ${allMessages.length} messages`;
		} catch (e) {
			error = e?.message || 'Fetch failed';
		} finally {
			isLoading = false;
		}
	}

	async function deleteAllMessages() {
		if (!confirm('Delete all test messages?')) return;

		isLoading = true;
		error = null;

		try {
			const { error: deleteError } = await supabase.from('messages').delete().neq('id', 0); // Delete all

			if (deleteError) throw deleteError;

			testResult = 'All messages deleted';
			allMessages = [];
		} catch (e) {
			error = e?.message || 'Delete failed';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="min-h-screen bg-stone-50 p-8">
	<div class="max-w-2xl mx-auto space-y-6">
		<h1 class="text-2xl font-bold text-stone-900">Supabase Connection Test</h1>

		<!-- Connection Status -->
		<div class="bg-white rounded-xl border border-stone-200 p-6 space-y-4">
			<h2 class="font-semibold text-stone-700">Connection Status</h2>

			<div class="flex items-center gap-3">
				<span
					class="w-3 h-3 rounded-full {connectionStatus === 'Connected'
						? 'bg-emerald-500'
						: connectionStatus === 'Failed'
							? 'bg-red-500'
							: 'bg-stone-300'}"
				></span>
				<span class="text-sm font-medium">{connectionStatus}</span>
			</div>

			<button
				onclick={testConnection}
				disabled={isLoading}
				class="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
			>
				{isLoading ? 'Testing...' : 'Test Connection'}
			</button>
		</div>

		<!-- Result / Error -->
		{#if testResult}
			<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-700 text-sm">
				{testResult}
			</div>
		{/if}

		{#if error}
			<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
				<strong>Error:</strong>
				{error}
			</div>
		{/if}

		<!-- Insert Test Data -->
		<div class="bg-white rounded-xl border border-stone-200 p-6 space-y-4">
			<h2 class="font-semibold text-stone-700">Insert Test Data</h2>

			<div class="space-y-3">
				<div>
					<label class="block text-xs text-stone-500 mb-1">User Name</label>
					<input
						type="text"
						bind:value={testName}
						class="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm"
					/>
				</div>
				<div>
					<label class="block text-xs text-stone-500 mb-1">Message</label>
					<input
						type="text"
						bind:value={testMessage}
						class="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm"
					/>
				</div>
			</div>

			<div class="flex gap-2">
				<button
					onclick={insertTestData}
					disabled={isLoading}
					class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
				>
					Insert
				</button>
				<button
					onclick={fetchAllMessages}
					disabled={isLoading}
					class="px-4 py-2 bg-stone-500 hover:bg-stone-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
				>
					Fetch All
				</button>
				<button
					onclick={deleteAllMessages}
					disabled={isLoading}
					class="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
				>
					Delete All
				</button>
			</div>
		</div>

		<!-- Messages List -->
		{#if allMessages.length > 0}
			<div class="bg-white rounded-xl border border-stone-200 p-6 space-y-4">
				<h2 class="font-semibold text-stone-700">Messages ({allMessages.length})</h2>

				<div class="space-y-2">
					{#each allMessages as msg}
						<div class="bg-stone-50 rounded-lg p-3 text-sm">
							<div class="flex justify-between items-start">
								<span class="font-medium text-stone-700">{msg.user_name}</span>
								<span class="text-xs text-stone-400"
									>{new Date(msg.created_at).toLocaleString()}</span
								>
							</div>
							<p class="text-stone-600 mt-1">{msg.content}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- SQL Query Reference -->
		<div class="bg-stone-100 rounded-xl border border-stone-200 p-6 space-y-4">
			<h2 class="font-semibold text-stone-700">SQL Query (Run in Supabase SQL Editor)</h2>
			<pre class="bg-stone-900 text-stone-100 rounded-lg p-4 text-xs overflow-x-auto"><code
					>-- Create messages table for testing
CREATE TABLE public.messages (
  id BIGSERIAL PRIMARY KEY,
  user_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (for testing)
CREATE POLICY "Allow all" ON public.messages
  FOR ALL USING (true) WITH CHECK (true);</code
				></pre>
		</div>

		<a href="/" class="inline-block text-sm text-blue-500 hover:text-blue-600"> ← Back to main </a>
	</div>
</div>
