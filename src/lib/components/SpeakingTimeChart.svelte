<script>
	import { onDestroy } from 'svelte';
	import {
		Chart,
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Tooltip,
		Legend
	} from 'chart.js';

	// Register Chart.js components
	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

	let { data, period } = $props();

	let canvas = $state(null);
	let chartInstance = $state(null);

	$effect(() => {
		// Recreate chart when data or period changes
		if (canvas && data) {
			createChart();
		}
	});

	function createChart() {
		// Destroy previous chart
		if (chartInstance) {
			chartInstance.destroy();
		}

		if (!canvas) return;

		let labels = [];
		let values = [];

		// Prepare data based on period
		if (period === 'daily') {
			const breakdown = data.dailyBreakdown.slice(-30); // Last 30 days
			labels = breakdown.map((d) => {
				const date = new Date(d.date);
				return `${date.getMonth() + 1}/${date.getDate()}`;
			});
			values = breakdown.map((d) => d.minutes);
		} else if (period === 'weekly') {
			const breakdown = data.weeklyBreakdown.slice(-12); // Last 12 weeks
			labels = breakdown.map((d) => {
				const date = new Date(d.week);
				return `${date.getMonth() + 1}/${date.getDate()}`;
			});
			values = breakdown.map((d) => d.minutes);
		} else if (period === 'monthly') {
			const breakdown = data.monthlyBreakdown.slice(-12); // Last 12 months
			labels = breakdown.map((d) => {
				const [year, month] = d.month.split('-');
				return `${year}/${month}`;
			});
			values = breakdown.map((d) => d.minutes);
		}

		// Create chart
		const ctx = canvas.getContext('2d');
		chartInstance = new Chart(ctx, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: '연습 시간 (분)',
						data: values,
						backgroundColor: 'rgba(244, 63, 94, 0.5)',
						borderColor: 'rgba(244, 63, 94, 1)',
						borderWidth: 1,
						borderRadius: 6
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: {
						display: false
					},
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.8)',
						padding: 12,
						titleColor: '#fff',
						bodyColor: '#fff',
						borderColor: 'rgba(244, 63, 94, 1)',
						borderWidth: 1
					}
				},
				scales: {
					y: {
						beginAtZero: true,
						ticks: {
							callback: function (value) {
								return value + '분';
							}
						},
						grid: {
							color: 'rgba(0, 0, 0, 0.05)'
						}
					},
					x: {
						grid: {
							display: false
						}
					}
				}
			}
		});
	}

	onDestroy(() => {
		if (chartInstance) {
			chartInstance.destroy();
		}
	});
</script>

<div class="w-full" style="height: 300px;">
	{#if data.dailyBreakdown.length === 0 && data.weeklyBreakdown.length === 0 && data.monthlyBreakdown.length === 0}
		<div class="flex items-center justify-center h-full text-stone-500">
			<p>아직 데이터가 없습니다</p>
		</div>
	{:else}
		<canvas bind:this={canvas}></canvas>
	{/if}
</div>
