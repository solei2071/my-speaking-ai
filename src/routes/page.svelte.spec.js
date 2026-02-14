import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
		PUBLIC_SUPABASE_ANON_KEY: 'public-key-placeholder'
	}
}));

describe('/+page.svelte', () => {
	it('should render h1', async () => {
		render(Page);

		const heading = page.getByRole('heading', { level: 1 });
		await expect.element(heading).toBeInTheDocument();
	});
});
