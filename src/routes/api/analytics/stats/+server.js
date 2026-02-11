import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';
import { calculateSpeakingTime, calculateStreaks, getSessionStats } from '$lib/analytics.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, request }) {
	try {
		// Try to get session from Authorization header or server-side session
		let userId = null;

		const authHeader = request.headers.get('authorization');
		if (authHeader?.startsWith('Bearer ')) {
			const token = authHeader.slice(7);
			const {
				data: { user },
				error: authError
			} = await supabase.auth.getUser(token);
			if (!authError && user) {
				userId = user.id;
			}
		}

		// Fallback: try userId query param (client already authenticated)
		if (!userId) {
			userId = url.searchParams.get('userId');
		}

		if (!userId) {
			return json({ error: '인증이 필요합니다' }, { status: 401 });
		}

		const period = url.searchParams.get('period') || 'all';

		// Validate period
		if (!['daily', 'weekly', 'monthly', 'all'].includes(period)) {
			return json({ error: '잘못된 기간 형식' }, { status: 400 });
		}

		// Fetch all analytics data in parallel
		const [speakingTime, streaks, sessionStats] = await Promise.all([
			calculateSpeakingTime(userId, period),
			calculateStreaks(userId),
			getSessionStats(userId)
		]);

		return json({
			success: true,
			data: {
				speakingTime,
				streaks,
				sessions: sessionStats
			}
		});
	} catch (error) {
		console.error('Analytics API error:', error);
		return json(
			{
				error: '분석 데이터를 불러오는 중 오류가 발생했습니다',
				details: error.message
			},
			{ status: 500 }
		);
	}
}
