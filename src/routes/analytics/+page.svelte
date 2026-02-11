<script>
	import { onMount } from 'svelte';
	import { user } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { resolveRoute } from '$app/paths';
	import StatsCard from '$lib/components/StatsCard.svelte';
	import SpeakingTimeChart from '$lib/components/SpeakingTimeChart.svelte';
	import StreakCalendar from '$lib/components/StreakCalendar.svelte';
	import { CHARACTERS } from '$lib/characters.js';

	let loading = $state(true);
	let error = $state(null);
	let analyticsData = $state(null);
	let period = $state('daily');

	onMount(async () => {
		if (!$user) {
			goto(resolveRoute('/login'));
			return;
		}

		await loadAnalytics();
	});

	async function loadAnalytics() {
		loading = true;
		error = null;

		try {
			const response = await fetch(`/api/analytics/stats?period=${period}&userId=${$user.id}`);
			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || '데이터를 불러오지 못했습니다');
			}

			analyticsData = result.data;
		} catch (e) {
			console.error('Failed to load analytics:', e);
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function changePeriod(newPeriod) {
		period = newPeriod;
		await loadAnalytics();
	}

	function getFavoriteCharacterInfo() {
		if (!analyticsData?.sessions?.favoriteCharacter) return null;

		const charName = analyticsData.sessions.favoriteCharacter.name;
		const charId = Object.keys(CHARACTERS).find((id) => CHARACTERS[id].label === charName);

		if (charId) {
			return {
				...CHARACTERS[charId],
				count: analyticsData.sessions.favoriteCharacter.count
			};
		}

		return {
			label: charName,
			emoji: '🤖',
			count: analyticsData.sessions.favoriteCharacter.count
		};
	}
</script>

<svelte:head>
	<title>학습 분석 - My Speaking AI</title>
</svelte:head>

<div class="min-h-screen bg-stone-50">
	<!-- Header -->
	<header class="bg-white border-b border-stone-200">
		<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
			<div class="flex items-center justify-between">
				<div>
					<a
						href={resolveRoute('/')}
						class="text-sm text-stone-500 hover:text-stone-700 flex items-center gap-1"
					>
						← 홈으로
					</a>
					<h1 class="text-2xl font-bold text-stone-900 mt-1">학습 분석</h1>
				</div>
			</div>
		</div>
	</header>

	<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		{#if loading}
			<div class="flex items-center justify-center py-20">
				<div class="text-center">
					<div
						class="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-rose-500 border-r-transparent"
					></div>
					<p class="mt-4 text-stone-600">데이터를 불러오는 중...</p>
				</div>
			</div>
		{:else if error}
			<div class="text-center py-12">
				<div
					class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-rose-100 mb-4"
				>
					<svg class="w-8 h-8 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						></path>
					</svg>
				</div>
				<p class="text-rose-600 font-medium text-lg mb-2">데이터를 불러오지 못했습니다</p>
				<p class="text-stone-500 text-sm mb-6">{error}</p>
				<button
					onclick={loadAnalytics}
					class="px-6 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors font-medium"
				>
					다시 시도
				</button>
			</div>
		{:else if analyticsData}
			{@const favoriteChar = getFavoriteCharacterInfo()}

			<!-- Period selector -->
			<div class="mb-6 flex gap-2">
				<button
					onclick={() => changePeriod('daily')}
					class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {period === 'daily'
						? 'bg-rose-500 text-white'
						: 'bg-white text-stone-700 hover:bg-stone-100'}"
				>
					일별
				</button>
				<button
					onclick={() => changePeriod('weekly')}
					class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {period === 'weekly'
						? 'bg-rose-500 text-white'
						: 'bg-white text-stone-700 hover:bg-stone-100'}"
				>
					주별
				</button>
				<button
					onclick={() => changePeriod('monthly')}
					class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {period === 'monthly'
						? 'bg-rose-500 text-white'
						: 'bg-white text-stone-700 hover:bg-stone-100'}"
				>
					월별
				</button>
			</div>

			<!-- Stats Cards -->
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
				<StatsCard
					title="총 연습 시간"
					value="{analyticsData.speakingTime.totalMinutes}분"
					subtitle="대화 중 말한 시간"
					icon="⏱️"
				/>
				<StatsCard
					title="현재 연속 기록"
					value="{analyticsData.streaks.currentStreak}일"
					subtitle="연속으로 연습한 날"
					icon="🔥"
				/>
				<StatsCard
					title="최장 연속 기록"
					value="{analyticsData.streaks.longestStreak}일"
					subtitle="역대 최고 기록"
					icon="🏆"
				/>
				<StatsCard
					title="총 대화 세션"
					value="{analyticsData.sessions.totalSessions}개"
					subtitle="평균 {analyticsData.sessions.averageMessagesPerSession}개 메시지"
					icon="💬"
				/>
			</div>

			<!-- Favorite Character -->
			{#if favoriteChar}
				<div class="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mb-8">
					<h2 class="text-lg font-semibold text-stone-900 mb-4">가장 많이 대화한 튜터</h2>
					<div class="flex items-center gap-4">
						<div class="text-5xl">{favoriteChar.emoji}</div>
						<div>
							<p class="text-xl font-bold text-stone-900">
								{favoriteChar.label}
							</p>
							{#if favoriteChar.mbti}
								<p class="text-sm text-stone-500">{favoriteChar.mbti}</p>
							{/if}
							<p class="text-sm text-stone-600 mt-1">
								{favoriteChar.count}회 대화
							</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Speaking Time Chart -->
			<div class="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mb-8">
				<h2 class="text-lg font-semibold text-stone-900 mb-4">연습 시간 추이</h2>
				<SpeakingTimeChart data={analyticsData.speakingTime} {period} />
			</div>

			<!-- Streak Calendar -->
			<div class="bg-white rounded-xl shadow-sm border border-stone-200 p-6 mb-8">
				<h2 class="text-lg font-semibold text-stone-900 mb-4">연습 캘린더</h2>
				<StreakCalendar
					practiceDates={analyticsData.streaks.practiceDates}
					currentStreak={analyticsData.streaks.currentStreak}
				/>
			</div>

			<!-- Recent Sessions -->
			{#if analyticsData.sessions.recentSessions.length > 0}
				<div class="bg-white rounded-xl shadow-sm border border-stone-200 p-6">
					<h2 class="text-lg font-semibold text-stone-900 mb-4">최근 대화</h2>
					<div class="space-y-3">
						{#each analyticsData.sessions.recentSessions as session (session.sessionId)}
							{@const charId = Object.keys(CHARACTERS).find(
								(id) => CHARACTERS[id].label === session.characterName
							)}
							{@const char = charId ? CHARACTERS[charId] : null}
							<div
								class="flex items-center justify-between p-4 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors"
							>
								<div class="flex items-center gap-3">
									<div class="text-2xl">{char?.emoji || '🤖'}</div>
									<div>
										<p class="font-medium text-stone-900">
											{session.characterName}
										</p>
										<p class="text-sm text-stone-500">
											{new Date(session.startTime).toLocaleString('ko-KR', {
												year: 'numeric',
												month: 'long',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit'
											})}
										</p>
									</div>
								</div>
								<div class="text-right">
									<p class="text-sm font-medium text-stone-700">
										{session.messageCount}개 메시지
									</p>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<div class="text-center py-12">
				<div class="text-6xl mb-4">📊</div>
				<p class="text-xl font-semibold text-stone-900 mb-2">아직 대화 기록이 없습니다</p>
				<p class="text-stone-600 mb-6">AI 튜터와 대화를 시작하면 학습 분석이 표시됩니다</p>
				<a
					href={resolveRoute('/')}
					class="inline-block px-6 py-3 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors font-medium"
				>
					첫 대화 시작하기
				</a>
			</div>
		{/if}
	</main>
</div>

<style>
	/* Custom scrollbar */
	:global(html) {
		scroll-behavior: smooth;
	}
</style>
