import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const projectRoot = process.cwd();
const envFilePath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');
const routePath = path.join(projectRoot, 'src', 'routes', 'api', 'gemini-chat', '+server.js');

function parseEnvFile(filePath) {
	const values = {};
	if (!fs.existsSync(filePath)) return values;

	const raw = fs.readFileSync(filePath, 'utf8');
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const [key, ...rest] = trimmed.split('=');
		if (!key) continue;
		values[key] = rest.join('=').trim();
	}

	return values;
}

function isPlaceholder(value, templateValue) {
	if (!value) return true;
	if (templateValue && value === templateValue) return true;
	if (value.includes('your-') || value.includes('여기에_') || value.includes('xxxxx')) return true;
	return false;
}

function main() {
	const fileEnv = parseEnvFile(envFilePath);
	const templateEnv = parseEnvFile(envExamplePath);
	const env = { ...fileEnv, ...process.env };

	let hasError = false;
	const errors = [];
	const warnings = [];

	const hasGeminiKey =
		Boolean(env.GEMINI_API_KEY && !isPlaceholder(env.GEMINI_API_KEY, templateEnv.GEMINI_API_KEY)) ||
		Boolean(env.GOOGLE_API_KEY && !isPlaceholder(env.GOOGLE_API_KEY, templateEnv.GOOGLE_API_KEY));
	if (!hasGeminiKey) {
		hasError = true;
		errors.push('GEMINI_API_KEY 또는 GOOGLE_API_KEY가 .env에 실제 값으로 설정되지 않았습니다.');
	}

	const publicUrl = env.PUBLIC_SUPABASE_URL;
	if (!publicUrl || isPlaceholder(publicUrl, templateEnv.PUBLIC_SUPABASE_URL)) {
		hasError = true;
		errors.push('PUBLIC_SUPABASE_URL가 .env에 실제 값으로 설정되지 않았습니다.');
	}

	const publicAnon = env.PUBLIC_SUPABASE_ANON_KEY;
	if (!publicAnon || isPlaceholder(publicAnon, templateEnv.PUBLIC_SUPABASE_ANON_KEY)) {
		hasError = true;
		errors.push('PUBLIC_SUPABASE_ANON_KEY가 .env에 실제 값으로 설정되지 않았습니다.');
	}

	if (!fs.existsSync(routePath)) {
		hasError = true;
		errors.push('Gemini API 라우트 파일이 없습니다: src/routes/api/gemini-chat/+server.js');
	}

	if (fs.existsSync(envFilePath) && env.OPENAI_API_KEY) {
		warnings.push(
			'OPENAI_API_KEY가 .env에 남아 있습니다. OpenAI로는 더 이상 호출하지 않으므로 제거를 권장합니다.'
		);
	}

	console.log('=== 배포 게이트 점검 ===');
	if (errors.length === 0) {
		console.log('✓ 환경변수/필수 파일 확인 통과');
	} else {
		console.error('✗ 문제 항목:');
		for (const item of errors) console.error(`  - ${item}`);
	}

	for (const item of warnings) {
		console.warn(`! 경고: ${item}`);
	}

	if (hasError) {
		process.exit(1);
	}

	console.log('실행: npm run predeploy');
	execSync('npm run predeploy', { stdio: 'inherit' });

	console.log('\n=== 배포 준비 체크리스트 ===');
	console.log('1) .env 값 확인: 통과');
	console.log('2) 필수 테스트/빌드: npm run predeploy');
	console.log('3) Vercel 환경변수 등록');
	console.log('   - GEMINI_API_KEY 또는 GOOGLE_API_KEY');
	console.log('   - PUBLIC_SUPABASE_URL');
	console.log('   - PUBLIC_SUPABASE_ANON_KEY');
	console.log('   - GEMINI_RATE_LIMIT_WINDOW_MS (선택)');
	console.log('   - GEMINI_RATE_LIMIT_MAX (선택)');
	console.log('\n실행: npm run deploy:prod');
}

main();
