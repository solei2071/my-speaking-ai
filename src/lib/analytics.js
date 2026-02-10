import { supabase } from './supabase.js';

/**
 * Calculate speaking time statistics from conversation records
 * Estimates time by measuring gaps between messages
 *
 * @param {string} userId - User UUID
 * @param {string} period - Time period: 'daily', 'weekly', 'monthly', or 'all'
 * @returns {Promise<Object>} Speaking time statistics
 */
export async function calculateSpeakingTime(userId, period = 'all') {
	if (!userId) throw new Error('User ID is required');

	// Calculate date range based on period
	let startDate = null;
	const now = new Date();

	if (period === 'daily') {
		startDate = new Date(now);
		startDate.setDate(now.getDate() - 30); // Last 30 days
	} else if (period === 'weekly') {
		startDate = new Date(now);
		startDate.setDate(now.getDate() - 90); // Last 90 days
	} else if (period === 'monthly') {
		startDate = new Date(now);
		startDate.setMonth(now.getMonth() - 12); // Last 12 months
	}

	// Fetch conversation records
	let query = supabase
		.from('conversation_records')
		.select('created_at, role, session_id')
		.eq('user_id', userId)
		.order('created_at', { ascending: true });

	if (startDate) {
		query = query.gte('created_at', startDate.toISOString());
	}

	const { data: messages, error } = await query;

	if (error) {
		console.error('Error fetching conversation records:', error);
		throw new Error('Failed to fetch conversation records');
	}

	if (!messages || messages.length === 0) {
		return {
			totalMinutes: 0,
			dailyBreakdown: [],
			weeklyBreakdown: [],
			monthlyBreakdown: []
		};
	}

	// Calculate speaking time
	const dailyTimes = {};
	let totalSeconds = 0;

	for (let i = 1; i < messages.length; i++) {
		const current = messages[i];
		const previous = messages[i - 1];

		// Only count time for user messages (when user is speaking)
		if (current.role === 'user') {
			const gap =
				(new Date(current.created_at) - new Date(previous.created_at)) / 1000;

			// Cap gap at 5 minutes (300s), minimum 10 seconds
			const validGap = Math.max(10, Math.min(gap, 300));
			totalSeconds += validGap;

			// Track daily
			const date = new Date(current.created_at).toISOString().split('T')[0];
			dailyTimes[date] = (dailyTimes[date] || 0) + validGap;
		}
	}

	// Convert to minutes
	const totalMinutes = Math.floor(totalSeconds / 60);

	// Build daily breakdown
	const dailyBreakdown = Object.entries(dailyTimes)
		.map(([date, seconds]) => ({
			date,
			minutes: Math.floor(seconds / 60)
		}))
		.sort((a, b) => a.date.localeCompare(b.date));

	// Build weekly breakdown (group by week)
	const weeklyTimes = {};
	dailyBreakdown.forEach(({ date, minutes }) => {
		const weekStart = getWeekStart(new Date(date));
		weeklyTimes[weekStart] = (weeklyTimes[weekStart] || 0) + minutes;
	});

	const weeklyBreakdown = Object.entries(weeklyTimes)
		.map(([week, minutes]) => ({
			week,
			minutes
		}))
		.sort((a, b) => a.week.localeCompare(b.week));

	// Build monthly breakdown (group by month)
	const monthlyTimes = {};
	dailyBreakdown.forEach(({ date, minutes }) => {
		const month = date.substring(0, 7); // YYYY-MM
		monthlyTimes[month] = (monthlyTimes[month] || 0) + minutes;
	});

	const monthlyBreakdown = Object.entries(monthlyTimes)
		.map(([month, minutes]) => ({
			month,
			minutes
		}))
		.sort((a, b) => a.month.localeCompare(b.month));

	return {
		totalMinutes,
		dailyBreakdown,
		weeklyBreakdown,
		monthlyBreakdown
	};
}

/**
 * Calculate practice streaks
 *
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Streak statistics
 */
export async function calculateStreaks(userId) {
	if (!userId) throw new Error('User ID is required');

	// Fetch all unique practice dates
	const { data: messages, error } = await supabase
		.from('conversation_records')
		.select('created_at')
		.eq('user_id', userId)
		.order('created_at', { ascending: true });

	if (error) {
		console.error('Error fetching conversation records:', error);
		throw new Error('Failed to fetch conversation records');
	}

	if (!messages || messages.length === 0) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			practiceDates: []
		};
	}

	// Get unique dates (YYYY-MM-DD format)
	const uniqueDates = [
		...new Set(
			messages.map((m) => new Date(m.created_at).toISOString().split('T')[0])
		)
	].sort();

	const practiceDates = uniqueDates;

	// Calculate longest streak
	let longestStreak = 1;
	let tempStreak = 1;

	for (let i = 1; i < uniqueDates.length; i++) {
		const dayDiff =
			(new Date(uniqueDates[i]) - new Date(uniqueDates[i - 1])) /
			(1000 * 60 * 60 * 24);

		if (dayDiff === 1) {
			tempStreak++;
		} else {
			longestStreak = Math.max(longestStreak, tempStreak);
			tempStreak = 1;
		}
	}
	longestStreak = Math.max(longestStreak, tempStreak);

	// Calculate current streak (must include today or yesterday)
	const today = new Date().toISOString().split('T')[0];
	const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

	let currentStreak = 0;
	const lastPracticeDate = uniqueDates[uniqueDates.length - 1];

	if (lastPracticeDate === today || lastPracticeDate === yesterday) {
		currentStreak = 1;
		for (let i = uniqueDates.length - 2; i >= 0; i--) {
			const dayDiff =
				(new Date(uniqueDates[i + 1]) - new Date(uniqueDates[i])) /
				(1000 * 60 * 60 * 24);
			if (dayDiff === 1) {
				currentStreak++;
			} else {
				break;
			}
		}
	}

	return {
		currentStreak,
		longestStreak,
		practiceDates
	};
}

/**
 * Get session statistics
 *
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Session statistics
 */
export async function getSessionStats(userId) {
	if (!userId) throw new Error('User ID is required');

	// Fetch all messages
	const { data: messages, error } = await supabase
		.from('conversation_records')
		.select('session_id, character_name, role, created_at')
		.eq('user_id', userId)
		.order('created_at', { ascending: false });

	if (error) {
		console.error('Error fetching conversation records:', error);
		throw new Error('Failed to fetch conversation records');
	}

	if (!messages || messages.length === 0) {
		return {
			totalSessions: 0,
			averageMessagesPerSession: 0,
			favoriteCharacter: null,
			recentSessions: []
		};
	}

	// Group by session
	const sessionMap = {};
	const characterCount = {};

	messages.forEach((msg) => {
		// Track sessions
		if (!sessionMap[msg.session_id]) {
			sessionMap[msg.session_id] = {
				sessionId: msg.session_id,
				characterName: msg.character_name,
				messageCount: 0,
				startTime: msg.created_at
			};
		}
		sessionMap[msg.session_id].messageCount++;
		sessionMap[msg.session_id].startTime = msg.created_at; // Update to earliest (since sorted desc)

		// Track character usage
		if (msg.character_name) {
			characterCount[msg.character_name] =
				(characterCount[msg.character_name] || 0) + 1;
		}
	});

	const sessions = Object.values(sessionMap);
	const totalSessions = sessions.length;

	// Calculate average messages per session
	const totalMessages = messages.length;
	const averageMessagesPerSession =
		totalSessions > 0 ? Math.round(totalMessages / totalSessions) : 0;

	// Find favorite character
	let favoriteCharacter = null;
	if (Object.keys(characterCount).length > 0) {
		const sortedChars = Object.entries(characterCount).sort((a, b) => b[1] - a[1]);
		favoriteCharacter = {
			name: sortedChars[0][0],
			count: sortedChars[0][1]
		};
	}

	// Get recent sessions (last 10)
	const recentSessions = sessions
		.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
		.slice(0, 10)
		.map((s) => ({
			sessionId: s.sessionId,
			characterName: s.characterName,
			messageCount: s.messageCount,
			startTime: s.startTime
		}));

	return {
		totalSessions,
		averageMessagesPerSession,
		favoriteCharacter,
		recentSessions
	};
}

/**
 * Helper: Get the start of the week (Monday) for a given date
 */
function getWeekStart(date) {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
	const monday = new Date(d.setDate(diff));
	return monday.toISOString().split('T')[0];
}
