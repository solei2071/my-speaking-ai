<script>
	let { practiceDates, currentStreak } = $props();

	// Get last 90 days
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const today = new Date();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const startDate = new Date(today);
	startDate.setDate(today.getDate() - 89); // 90 days including today

	// Generate calendar grid
	const calendar = $derived(() => {
		const days = [];
		const practiceSet = new Set(practiceDates);

		for (let i = 0; i < 90; i++) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const date = new Date(startDate);
			date.setDate(startDate.getDate() + i);
			const dateStr = date.toISOString().split('T')[0];

			days.push({
				date: dateStr,
				isPractice: practiceSet.has(dateStr),
				isToday: dateStr === today.toISOString().split('T')[0],
				dayOfWeek: date.getDay(),
				day: date.getDate()
			});
		}

		return days;
	});

	const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

	function getLevel(isPractice) {
		if (!isPractice) return 0;
		return 4; // Max intensity for simplicity
	}
</script>

<div>
	<!-- Week day labels -->
	<div class="grid grid-cols-7 gap-1 mb-2 text-xs text-stone-500 font-medium text-center">
		{#each weekDays as day, i (i)}
			<div class="py-1">{day}</div>
		{/each}
	</div>

	<!-- Calendar grid -->
	<div class="grid grid-cols-7 gap-1">
		{#each calendar() as day (day.date)}
			<div
				class="aspect-square rounded flex items-center justify-center text-xs transition-all hover:scale-110 cursor-pointer {day.isToday
					? 'ring-2 ring-rose-500'
					: ''}"
				class:bg-stone-100={getLevel(day.isPractice) === 0}
				class:bg-rose-200={getLevel(day.isPractice) === 1}
				class:bg-rose-300={getLevel(day.isPractice) === 2}
				class:bg-rose-400={getLevel(day.isPractice) === 3}
				class:bg-rose-500={getLevel(day.isPractice) === 4}
				class:text-white={day.isPractice}
				class:text-stone-400={!day.isPractice}
				title="{day.date} {day.isPractice ? '✓ 연습함' : ''}"
			>
				{day.day}
			</div>
		{/each}
	</div>

	<!-- Legend -->
	<div class="mt-4 flex items-center justify-end gap-2 text-xs text-stone-600">
		<span>연습 빈도:</span>
		<div class="flex gap-1">
			<div class="w-4 h-4 rounded bg-stone-100 border border-stone-200"></div>
			<div class="w-4 h-4 rounded bg-rose-500"></div>
		</div>
	</div>

	<!-- Streak info -->
	{#if currentStreak > 0}
		<div class="mt-4 p-4 bg-gradient-to-r from-orange-100 to-rose-100 rounded-lg">
			<div class="flex items-center gap-2">
				<span class="text-2xl">🔥</span>
				<div>
					<p class="font-semibold text-stone-900">
						{currentStreak}일 연속 연습 중!
					</p>
					<p class="text-xs text-stone-600">계속 이 기세를 유지하세요!</p>
				</div>
			</div>
		</div>
	{/if}
</div>
