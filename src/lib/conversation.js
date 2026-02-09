import { supabase } from './supabase.js';

/** Save a single message to conversation_records */
export async function saveMessage(userId, sessionId, characterName, role, content, characterVoiceId = null) {
	if (!userId || !sessionId || !content?.trim()) return;

	const row = {
		user_id: userId,
		session_id: sessionId,
		character_name: characterName,
		role: role === 'user' ? 'user' : 'assistant',
		content: content.trim()
	};
	if (characterVoiceId != null) row.character_voice_id = characterVoiceId;

	const { error } = await supabase.from('conversation_records').insert(row);

	if (error) console.error('[Conversation] Save failed:', error);
}

/** Fetch user's past sessions (grouped by session_id) */
export async function fetchSessions(userId) {
	if (!userId) return [];

	const { data, error } = await supabase
		.from('conversation_records')
		.select('session_id, character_name, character_voice_id, created_at')
		.eq('user_id', userId)
		.order('created_at', { ascending: true });

	if (error) {
		console.error('[Conversation] Fetch sessions failed:', error);
		return [];
	}

	// Group by session_id
	const bySession = new Map();
	for (const row of data || []) {
		const sid = row.session_id;
		if (!bySession.has(sid)) {
			bySession.set(sid, {
				session_id: sid,
				character_name: row.character_name,
				character_voice_id: row.character_voice_id ?? null,
				started_at: row.created_at,
				message_count: 0
			});
		}
		bySession.get(sid).message_count += 1;
	}

	return Array.from(bySession.values()).sort(
		(a, b) => new Date(b.started_at) - new Date(a.started_at)
	);
}

/** Fetch all messages for a session */
export async function fetchSessionMessages(userId, sessionId) {
	if (!userId || !sessionId) return [];

	const { data, error } = await supabase
		.from('conversation_records')
		.select('role, content, created_at')
		.eq('user_id', userId)
		.eq('session_id', sessionId)
		.order('created_at', { ascending: true });

	if (error) {
		console.error('[Conversation] Fetch messages failed:', error);
		return [];
	}

	return (data || []).map((r) => ({ role: r.role, text: r.content }));
}
