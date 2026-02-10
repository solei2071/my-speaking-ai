import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';
import {
	calculateSpeakingTime,
	calculateStreaks,
	getSessionStats
} from '$lib/analytics.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
	try {
		// Check authentication
		const {
			data: { session },
			error: authError
		} = await supabase.auth.getSession();

		if (authError || !session?.user) {
			return json({ error: '인증이 필요합니다' }, { status: 401 });
		}

		const userId = session.user.id;
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
