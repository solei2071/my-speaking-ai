<script>
	import { saveOnboarding } from './profile.js';

	let { userId = '', onComplete = () => {} } = $props();

	let displayName = $state('');
	let phone = $state('');
	let agreeTerms = $state(false);
	let agreePrivacy = $state(false);
	let error = $state('');
	let isLoading = $state(false);

	// 약관 상세보기 토글
	let showTermsDetail = $state(false);
	let showPrivacyDetail = $state(false);

	let canSubmit = $derived(
		displayName.trim().length > 0 && phone.trim().length > 0 && agreeTerms && agreePrivacy
	);

	function formatPhone(value) {
		// 숫자만 추출
		const numbers = value.replace(/[^0-9]/g, '');
		// 한국 전화번호 형식 (010-1234-5678)
		if (numbers.length <= 3) return numbers;
		if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
		return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
	}

	function handlePhoneInput(e) {
		phone = formatPhone(e.target.value);
	}

	function toggleAll() {
		const newValue = !(agreeTerms && agreePrivacy);
		agreeTerms = newValue;
		agreePrivacy = newValue;
	}

	async function handleSubmit(e) {
		e.preventDefault();
		error = '';

		if (!displayName.trim()) {
			error = '이름을 입력해주세요.';
			return;
		}

		const phoneNumbers = phone.replace(/[^0-9]/g, '');
		if (phoneNumbers.length < 10 || phoneNumbers.length > 11) {
			error = '올바른 전화번호를 입력해주세요.';
			return;
		}

		if (!agreeTerms || !agreePrivacy) {
			error = '필수 약관에 모두 동의해주세요.';
			return;
		}

		isLoading = true;

		try {
			const result = await saveOnboarding(userId, displayName.trim(), phone.trim());
			if (result.success) {
				onComplete();
			} else {
				error = result.error || '저장에 실패했습니다.';
			}
		} catch (e) {
			error = e?.message || '오류가 발생했습니다.';
		} finally {
			isLoading = false;
		}
	}
</script>

<!-- Fullscreen overlay modal -->
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
	<div
		class="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden max-h-[90vh] flex flex-col"
	>
		<!-- Header -->
		<div class="shrink-0 px-8 pt-8 pb-4">
			<div class="flex items-center gap-3 mb-2">
				<div class="w-10 h-10 rounded-xl bg-pink-100 flex items-center justify-center">
					<svg class="w-5 h-5 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
						/>
					</svg>
				</div>
				<div>
					<h2 class="text-xl font-bold text-stone-900">서비스 이용 동의</h2>
					<p class="text-stone-500 text-sm">서비스 이용을 위해 아래 정보를 입력해주세요.</p>
				</div>
			</div>
		</div>

		<!-- Scrollable content -->
		<div class="flex-1 overflow-y-auto px-8 pb-2">
			{#if error}
				<div class="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
					{error}
				</div>
			{/if}

			<form id="onboarding-form" onsubmit={handleSubmit} class="space-y-5">
				<!-- 이름 입력 -->
				<div>
					<label for="onboard-name" class="block text-sm font-medium text-stone-700 mb-1.5">
						이름 <span class="text-red-500">*</span>
					</label>
					<input
						id="onboard-name"
						type="text"
						bind:value={displayName}
						placeholder="홍길동"
						required
						class="w-full px-4 py-3 rounded-xl border border-stone-200 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-300 transition-all"
					/>
				</div>

				<!-- 전화번호 입력 -->
				<div>
					<label for="onboard-phone" class="block text-sm font-medium text-stone-700 mb-1.5">
						전화번호 <span class="text-red-500">*</span>
					</label>
					<input
						id="onboard-phone"
						type="tel"
						value={phone}
						oninput={handlePhoneInput}
						placeholder="010-1234-5678"
						required
						class="w-full px-4 py-3 rounded-xl border border-stone-200 text-stone-800 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-pink-500/30 focus:border-pink-300 transition-all"
					/>
				</div>

				<!-- 구분선 -->
				<div class="border-t border-stone-100 pt-4">
					<p class="text-sm font-medium text-stone-700 mb-3">약관 동의</p>

					<!-- 전체 동의 -->
					<label
						class="flex items-center gap-3 p-3 rounded-xl bg-stone-50 border border-stone-200 cursor-pointer hover:bg-stone-100 transition-colors mb-3"
					>
						<input
							type="checkbox"
							checked={agreeTerms && agreePrivacy}
							onchange={toggleAll}
							class="w-5 h-5 rounded border-stone-300 text-pink-500 focus:ring-pink-500/30 cursor-pointer"
						/>
						<span class="font-medium text-stone-800 text-sm">전체 동의합니다</span>
					</label>

					<!-- 서비스 이용약관 -->
					<div class="ml-1 space-y-2">
						<div class="flex items-center justify-between">
							<label class="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									bind:checked={agreeTerms}
									class="w-4 h-4 rounded border-stone-300 text-pink-500 focus:ring-pink-500/30 cursor-pointer"
								/>
								<span class="text-sm text-stone-700">
									<span class="text-red-500 font-medium">[필수]</span> 서비스 이용약관 동의
								</span>
							</label>
							<button
								type="button"
								onclick={() => (showTermsDetail = !showTermsDetail)}
								class="text-xs text-stone-400 hover:text-stone-600 underline transition-colors"
							>
								{showTermsDetail ? '접기' : '보기'}
							</button>
						</div>

						{#if showTermsDetail}
							<div
								class="ml-7 p-4 bg-stone-50 rounded-xl border border-stone-100 text-xs text-stone-600 leading-relaxed max-h-40 overflow-y-auto"
							>
								<p class="font-semibold mb-2">서비스 이용약관</p>
								<p class="mb-2">
									제1조 (목적) 이 약관은 My Speaking AI(이하 "서비스")가 제공하는 영어 회화 학습
									서비스의 이용과 관련하여 서비스와 이용자 간의 권리, 의무 및 책임사항을 규정함을
									목적으로 합니다.
								</p>
								<p class="mb-2">
									제2조 (정의) ① "서비스"란 AI 기반 영어 회화 연습 플랫폼을 의미합니다. ② "이용자"란
									이 약관에 따라 서비스를 이용하는 자를 말합니다.
								</p>
								<p class="mb-2">
									제3조 (약관의 효력) 이 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게
									공지함으로써 효력이 발생합니다.
								</p>
								<p class="mb-2">
									제4조 (서비스 이용) ① 서비스는 AI를 활용한 영어 회화 연습 기능을 제공합니다. ②
									이용자는 서비스를 개인 학습 목적으로만 이용할 수 있습니다.
								</p>
								<p>
									제5조 (면책) 서비스는 AI가 생성한 응답의 정확성을 보장하지 않으며, 학습
									참고용으로만 활용하시기 바랍니다.
								</p>
							</div>
						{/if}

						<!-- 개인정보 처리방침 -->
						<div class="flex items-center justify-between">
							<label class="flex items-center gap-3 cursor-pointer">
								<input
									type="checkbox"
									bind:checked={agreePrivacy}
									class="w-4 h-4 rounded border-stone-300 text-pink-500 focus:ring-pink-500/30 cursor-pointer"
								/>
								<span class="text-sm text-stone-700">
									<span class="text-red-500 font-medium">[필수]</span> 개인정보 처리방침 동의
								</span>
							</label>
							<button
								type="button"
								onclick={() => (showPrivacyDetail = !showPrivacyDetail)}
								class="text-xs text-stone-400 hover:text-stone-600 underline transition-colors"
							>
								{showPrivacyDetail ? '접기' : '보기'}
							</button>
						</div>

						{#if showPrivacyDetail}
							<div
								class="ml-7 p-4 bg-stone-50 rounded-xl border border-stone-100 text-xs text-stone-600 leading-relaxed max-h-40 overflow-y-auto"
							>
								<p class="font-semibold mb-2">개인정보 처리방침</p>
								<p class="mb-2">1. 수집하는 개인정보 항목: 이메일, 이름, 전화번호, 대화 기록</p>
								<p class="mb-2">
									2. 개인정보의 수집 및 이용 목적: 서비스 제공, 회원 관리, 학습 기록 저장 및 분석
								</p>
								<p class="mb-2">
									3. 개인정보의 보유 및 이용 기간: 회원 탈퇴 시까지 (탈퇴 후 즉시 파기)
								</p>
								<p class="mb-2">
									4. 개인정보의 제3자 제공: 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.
									다만, 법령에 의한 경우는 예외입니다.
								</p>
								<p class="mb-2">
									5. 개인정보의 파기: 보유 기간 경과 또는 처리 목적 달성 후 지체 없이 파기합니다.
								</p>
								<p>
									6. 이용자의 권리: 이용자는 언제든지 자신의 개인정보에 대해 열람, 수정, 삭제를
									요청할 수 있습니다.
								</p>
							</div>
						{/if}
					</div>
				</div>
			</form>
		</div>

		<!-- Footer / Submit button -->
		<div class="shrink-0 px-8 py-6 bg-stone-50/50 border-t border-stone-100">
			<button
				type="submit"
				form="onboarding-form"
				disabled={!canSubmit || isLoading}
				class="w-full py-3.5 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
			>
				{#if isLoading}
					<span class="flex items-center justify-center gap-2">
						<div
							class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
						></div>
						저장 중...
					</span>
				{:else}
					동의하고 시작하기
				{/if}
			</button>
			<p class="text-xs text-stone-400 text-center mt-3">
				필수 항목에 동의하지 않으면 서비스를 이용할 수 없습니다.
			</p>
		</div>
	</div>
</div>
