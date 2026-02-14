import { z } from 'zod';

// Auth 스키마
export const signUpSchema = z.object({
	email: z.string().email('올바른 이메일을 입력하세요'),
	password: z.string().min(8, '비밀번호는 최소 8자 이상이어야 합니다').max(100),
	name: z.string().min(1).max(100).optional()
});

export const signInSchema = z.object({
	email: z.string().email('올바른 이메일을 입력하세요'),
	password: z.string().min(1, '비밀번호를 입력하세요')
});

// Profile 스키마
export const onboardingSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID 형식'),
	displayName: z.string().min(1, '이름을 입력하세요').max(100).trim(),
	phone: z.string().regex(/^\d{3}-\d{4}-\d{4}$/, '전화번호 형식: 010-1234-5678')
});

// Conversation 스키마
export const saveMessageSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID'),
	sessionId: z.string().min(1).max(200),
	characterName: z.string().min(1).max(50),
	role: z.enum(['user', 'assistant'], {
		errorMap: () => ({ message: 'Role must be either "user" or "assistant"' })
	}),
	content: z.string().min(1, '메시지는 비워둘 수 없습니다').max(10000).trim(),
	characterVoiceId: z.string().max(50).optional()
});

export const fetchSessionsSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID')
});

export const fetchSessionMessagesSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID'),
	sessionId: z.string().min(1)
});

export const geminiChatRequestSchema = z.object({
	character: z.string().max(50).optional(),
	voice: z.string().max(50).optional(),
	level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
	scenario: z.string().max(200).optional(),
	messages: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				text: z.string().min(1).max(10000).trim()
			})
		)
		.max(80)
		.default([])
});

// Analytics 스키마
export const userIdSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID')
});

export const analyticsRequestSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID'),
	period: z.enum(['daily', 'weekly', 'monthly', 'all']).optional()
});

// Saved Sentences 스키마
export const saveSentenceSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID'),
	content: z.string().min(1, '내용은 비워둘 수 없습니다').max(10000).trim(),
	characterName: z.string().min(1).max(50),
	characterVoiceId: z.string().max(50).optional().nullable(),
	sessionId: z.string().max(200).optional().nullable()
});

export const fetchSavedSentencesSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID')
});

export const deleteSavedSentenceSchema = z.object({
	userId: z.string().uuid('잘못된 사용자 ID'),
	sentenceId: z.string().uuid('잘못된 문장 ID')
});

// 헬퍼 함수
export function validateOrThrow(schema, data) {
	const result = schema.safeParse(data);
	if (!result.success) {
		const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
		throw new Error(`검증 실패 - ${errors}`);
	}
	return result.data;
}

export function validateSafe(schema, data) {
	const result = schema.safeParse(data);
	return {
		success: result.success,
		data: result.success ? result.data : null,
		error: result.success ? null : result.error.errors.map((e) => e.message).join(', ')
	};
}
