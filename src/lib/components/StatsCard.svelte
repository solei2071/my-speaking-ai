<script>
	let { title, value, subtitle, icon } = $props();
</script>

<div class="bg-white rounded-xl shadow-sm border border-stone-200 p-6 hover:shadow-md transition-shadow">
	<div class="flex items-start justify-between">
		<div class="flex-1">
			<p class="text-sm font-medium text-stone-600 mb-1">{title}</p>
			<p class="text-3xl font-bold text-stone-900 mb-1">{value}</p>
			{#if subtitle}
				<p class="text-xs text-stone-500">{subtitle}</p>
			{/if}
		</div>
		{#if icon}
			<div class="text-3xl opacity-80">{icon}</div>
		{/if}
	</div>
</div>
