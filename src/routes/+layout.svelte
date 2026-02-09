<script>
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { initAuth } from '$lib/auth.js';
	import ErrorBoundary from '$lib/ErrorBoundary.svelte';

	let { children } = $props();

	onMount(() => {
		initAuth().catch((e) => {
			console.error('[App] Auth 초기화 실패:', e);
		});
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<ErrorBoundary>
	{@render children()}
</ErrorBoundary>
