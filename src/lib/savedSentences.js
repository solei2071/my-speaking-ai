import { supabase } from './supabase.js';
import {
	validateOrThrow,
	saveSentenceSchema,
	fetchSavedSentencesSchema,
	deleteSavedSentenceSchema
} from './validation/schemas.js';

/** Save an AI sentence to saved_sentences */
export async function saveSentence(
	userId,
	content,
	characterName,
	characterVoiceId = null,
	sessionId = null
) {
	try {
		const validated = validateOrThrow(saveSentenceSchema, {
			userId,
			content,
			characterName,
			characterVoiceId,
			sessionId
		});

		const row = {
			user_id: validated.userId,
			content: validated.content,
			character_name: validated.characterName
		};

		if (validated.characterVoiceId) {
			row.character_voice_id = validated.characterVoiceId;
		}
		if (validated.sessionId) {
			row.session_id = validated.sessionId;
		}

		const { error } = await supabase.from('saved_sentences').insert(row);

		if (error) {
			console.error('[SavedSentences] Database insert failed:', error);
			throw new Error(`Failed to save sentence: ${error.message}`);
		}
	} catch (e) {
		console.error('[SavedSentences] Save sentence error:', e);
		throw e;
	}
}

/** Fetch all saved sentences for a user, newest first */
export async function fetchSavedSentences(userId) {
	try {
		const validated = validateOrThrow(fetchSavedSentencesSchema, { userId });

		const { data, error } = await supabase
			.from('saved_sentences')
			.select('id, content, character_name, character_voice_id, session_id, created_at')
			.eq('user_id', validated.userId)
			.order('created_at', { ascending: false });

		if (error) {
			console.error('[SavedSentences] Fetch failed:', error);
			throw new Error(`Failed to fetch saved sentences: ${error.message}`);
		}

		return data || [];
	} catch (e) {
		console.error('[SavedSentences] Error in fetchSavedSentences:', e);
		return [];
	}
}

/** Delete a saved sentence */
export async function deleteSavedSentence(userId, sentenceId) {
	try {
		const validated = validateOrThrow(deleteSavedSentenceSchema, { userId, sentenceId });

		const { error } = await supabase
			.from('saved_sentences')
			.delete()
			.eq('id', validated.sentenceId)
			.eq('user_id', validated.userId);

		if (error) {
			console.error('[SavedSentences] Delete failed:', error);
			throw new Error(`Failed to delete saved sentence: ${error.message}`);
		}
	} catch (e) {
		console.error('[SavedSentences] Error in deleteSavedSentence:', e);
		throw e;
	}
}
