import { supabase } from './supabase.js';
import {
	validateOrThrow,
	saveMessageSchema,
	fetchSessionsSchema,
	fetchSessionMessagesSchema
} from './validation/schemas.js';

/** Save a single message to conversation_records */
export async function saveMessage(
	userId,
	sessionId,
	characterName,
	role,
	content,
	characterVoiceId = null
) {
	try {
		// Validate all inputs
		const validated = validateOrThrow(saveMessageSchema, {
			userId,
			sessionId,
			characterName,
			role,
			content,
			characterVoiceId
		});

		const row = {
			user_id: validated.userId,
			session_id: validated.sessionId,
			character_name: validated.characterName,
			role: validated.role,
			content: validated.content
		};

		if (validated.characterVoiceId) {
			row.character_voice_id = validated.characterVoiceId;
		}

		const { error } = await supabase.from('conversation_records').insert(row);

		if (error) {
			console.error('[Conversation] Database insert failed:', error);
			throw new Error(`Failed to save message: ${error.message}`);
		}
	} catch (e) {
		console.error('[Conversation] Save message error:', e);
		// Re-throw to let caller handle
		throw e;
	}
}

/** Fetch user's past sessions (grouped by session_id) */
export async function fetchSessions(userId) {
	try {
		// Validate input
		const validated = validateOrThrow(fetchSessionsSchema, { userId });

		const { data, error } = await supabase
			.from('conversation_records')
			.select('session_id, character_name, character_voice_id, created_at')
			.eq('user_id', validated.userId)
			.order('created_at', { ascending: true });

		if (error) {
			console.error('[Conversation] Fetch sessions failed:', error);
			throw new Error(`Failed to fetch sessions: ${error.message}`);
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
	} catch (e) {
		console.error('[Conversation] Error in fetchSessions:', e);
		// Return empty array for graceful UI degradation
		return [];
	}
}

/** Fetch all messages for a session */
export async function fetchSessionMessages(userId, sessionId) {
	try {
		// Validate inputs
		const validated = validateOrThrow(fetchSessionMessagesSchema, { userId, sessionId });

		const { data, error } = await supabase
			.from('conversation_records')
			.select('role, content, created_at')
			.eq('user_id', validated.userId)
			.eq('session_id', validated.sessionId)
			.order('created_at', { ascending: true });

		if (error) {
			console.error('[Conversation] Fetch messages failed:', error);
			throw new Error(`Failed to fetch messages: ${error.message}`);
		}

		return (data || []).map((r) => ({ role: r.role, text: r.content }));
	} catch (e) {
		console.error('[Conversation] Error in fetchSessionMessages:', e);
		return [];
	}
}
