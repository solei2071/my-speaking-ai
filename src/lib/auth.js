import { supabase } from './supabase.js';
import { writable } from 'svelte/store';

// Auth store
export const user = writable(null);
export const authLoading = writable(true);

// Initialize auth state
export async function initAuth() {
	authLoading.set(true);
	
	// Get current session
	const { data: { session } } = await supabase.auth.getSession();
	user.set(session?.user ?? null);
	
	// Listen for auth changes
	supabase.auth.onAuthStateChange((_event, session) => {
		user.set(session?.user ?? null);
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
	const { data, error } = await supabase.auth.signUp({
		email,
		password,
		options: {
			emailRedirectTo: getRedirectUrl(),
			data: {
				name: name || email.split('@')[0]
			}
		}
	});
	
	if (error) throw error;
	return data;
}

// Sign in with email
export async function signIn(email, password) {
	const { data, error } = await supabase.auth.signInWithPassword({
		email,
		password
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
	const { data: { user } } = await supabase.auth.getUser();
	return user;
}
