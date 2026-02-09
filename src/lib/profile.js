import { supabase } from './supabase.js';
import { writable } from 'svelte/store';

// 온보딩(프로필+동의) 완료 여부 store
export const onboardingComplete = writable(false);
export const onboardingLoading = writable(true);

// 현재 약관 버전
export const AGREEMENT_VERSION = '1.0';

/**
 * 사용자 프로필 존재 여부 확인
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getUserProfile(userId) {
	const { data, error } = await supabase
		.from('user_profiles')
		.select('*')
		.eq('id', userId)
		.single();

	if (error && error.code !== 'PGRST116') {
		// PGRST116 = no rows found (정상)
		console.error('Error fetching profile:', error);
	}

	return data;
}

/**
 * 사용자 동의 기록 확인
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function getUserAgreements(userId) {
	const { data, error } = await supabase
		.from('user_agreements')
		.select('*')
		.eq('user_id', userId)
		.eq('agreement_version', AGREEMENT_VERSION);

	if (error) {
		console.error('Error fetching agreements:', error);
		return [];
	}

	return data || [];
}

/**
 * 온보딩 완료 여부 체크 (프로필 + 두 가지 동의 모두)
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function checkOnboardingStatus(userId) {
	onboardingLoading.set(true);

	try {
		const [profile, agreements] = await Promise.all([
			getUserProfile(userId),
			getUserAgreements(userId)
		]);

		const hasProfile = !!profile;
		const hasTerms = agreements.some(
			(a) => a.agreement_type === 'terms_of_service' && a.agreed
		);
		const hasPrivacy = agreements.some(
			(a) => a.agreement_type === 'privacy_policy' && a.agreed
		);

		const complete = hasProfile && hasTerms && hasPrivacy;
		onboardingComplete.set(complete);
		return complete;
	} catch (e) {
		console.error('Error checking onboarding:', e);
		onboardingComplete.set(false);
		return false;
	} finally {
		onboardingLoading.set(false);
	}
}

/**
 * 프로필 저장 + 동의 기록 저장 (온보딩 완료)
 * @param {string} userId
 * @param {string} displayName
 * @param {string} phone
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveOnboarding(userId, displayName, phone) {
	try {
		// 1. 프로필 저장 (upsert)
		const { error: profileError } = await supabase
			.from('user_profiles')
			.upsert({
				id: userId,
				display_name: displayName,
				phone: phone
			});

		if (profileError) {
			return { success: false, error: `프로필 저장 실패: ${profileError.message}` };
		}

		// 2. 이용약관 동의 저장
		const { error: termsError } = await supabase.from('user_agreements').upsert(
			{
				user_id: userId,
				agreement_type: 'terms_of_service',
				agreed: true,
				agreement_version: AGREEMENT_VERSION
			},
			{ onConflict: 'user_id,agreement_type,agreement_version' }
		);

		if (termsError) {
			return { success: false, error: `이용약관 동의 저장 실패: ${termsError.message}` };
		}

		// 3. 개인정보 처리방침 동의 저장
		const { error: privacyError } = await supabase.from('user_agreements').upsert(
			{
				user_id: userId,
				agreement_type: 'privacy_policy',
				agreed: true,
				agreement_version: AGREEMENT_VERSION
			},
			{ onConflict: 'user_id,agreement_type,agreement_version' }
		);

		if (privacyError) {
			return { success: false, error: `개인정보 동의 저장 실패: ${privacyError.message}` };
		}

		onboardingComplete.set(true);
		return { success: true };
	} catch (e) {
		return { success: false, error: e?.message || '저장 중 오류가 발생했습니다.' };
	}
}
