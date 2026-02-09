import { supabase } from './supabase.js';
import { writable } from 'svelte/store';
import { checkOnboardingStatus, onboardingComplete, onboardingLoading } from './profile.js';
import { validateOrThrow, signUpSchema, signInSchema } from './validation/schemas.js';

// Auth store
export const user = writable(null);
export const authLoading = writable(true);

// Re-export for convenience
export { onboardingComplete, onboardingLoading };

// Initialize auth state
export async function initAuth() {
	authLoading.set(true);

	// Get current session
	const {
		data: { session }
	} = await supabase.auth.getSession();
	user.set(session?.user ?? null);

	// 로그인된 상태면 온보딩 완료 여부 확인
	if (session?.user) {
		await checkOnboardingStatus(session.user.id);
	}

	// Listen for auth changes
	supabase.auth.onAuthStateChange(async (_event, session) => {
		user.set(session?.user ?? null);

		// 로그인 시 온보딩 상태 체크
		if (session?.user) {
			await checkOnboardingStatus(session.user.id);
		} else {
			onboardingComplete.set(false);
		}
	});

	authLoading.set(false);
}

// Get redirect URL for auth (email confirmation, etc.)
function getRedirectUrl() {
	if (typeof window === 'undefined') return '';
	const base = window.location.origin;
	return `${base}/auth/callback`;
}

// Sign up with email
export async function signUp(email, password, name) {
	// Validate inputs before sending to Supabase
	const validated = validateOrThrow(signUpSchema, { email, password, name });

	const { data, error } = await supabase.auth.signUp({
		email: validated.email,
		password: validated.password,
		options: {
			emailRedirectTo: getRedirectUrl(),
			data: {
				name: validated.name || validated.email.split('@')[0]
			}
		}
	});

	if (error) throw error;
	return data;
}

// Sign in with email
export async function signIn(email, password) {
	// Validate inputs
	const validated = validateOrThrow(signInSchema, { email, password });

	const { data, error } = await supabase.auth.signInWithPassword({
		email: validated.email,
		password: validated.password
	});

	if (error) throw error;
	return data;
}

// Sign out
export async function signOut() {
	const { error } = await supabase.auth.signOut();
	if (error) throw error;
	user.set(null);
}

// Get current user
export async function getCurrentUser() {
	const {
		data: { user }
	} = await supabase.auth.getUser();
	return user;
}
