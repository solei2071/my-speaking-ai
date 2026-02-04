<!--
  ============================================
  Svelte 5 컴포넌트 구조
  ============================================
  Svelte 파일은 3개 영역으로 나뉩니다:
  1. <script> - 로직(자바스크립트)
  2. <style> - 스타일 (이 파일은 Tailwind로 대체)
  3. HTML - 화면에 보이는 부분
-->
<script>
	/* ============================================
	   상태 변수 (State) - 화면에서 바뀌는 값들
	   ============================================
	   $state() = Svelte 5의 "반응형" 변수. 값이 바뀌면 화면이 자동으로 갱신됩니다.
	   예: isRecording이 true면 버튼 색이 빨간색으로 바뀜
	*/
	let isRecording = $state(false); // 지금 녹음 중인지 (true/false)
	let recordedBlob = $state(null); // 녹음된 오디오 데이터 (Blob = 바이너리 덩어리)
	let audioUrl = $state(null); // 재생용 URL (브라우저가 <audio>에 쓸 수 있게)
	let error = $state(null); // 에러 메시지 (마이크 권한 거부 등)
	let recordingDuration = $state(0); // 녹음한 초(숫자)

	/* 일반 변수 - 화면에 반영 안 됨, 내부 로직용 */
	let mediaRecorder = null; // 브라우저 API. 실제 녹음을 담당
	let stream = null; // 마이크 스트림
	let chunks = []; // 녹음 데이터가 조각으로 들어옴
	let durationInterval = null; // 1초마다 duration 증가시키는 타이머

	/* ============================================
	   startRecording() - 녹음 시작
	   ============================================
	   async = 비동기 함수. await는 "결과 나올 때까지 기다림"을 의미
	   getUserMedia는 사용자에게 "마이크 접근 허용해주세요" 팝업을 띄움
	*/
	async function startRecording() {
		// 초기화: 이전 녹음/에러 지우기
		error = null;
		recordedBlob = null;
		audioUrl = null;
		chunks = [];
		recordingDuration = 0;

		try {
			// 1) 마이크 접근 요청. { audio: true } = 오디오만 (비디오 X)
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });

			// 2) MediaRecorder = 브라우저가 제공하는 녹음 도구
			mediaRecorder = new MediaRecorder(stream);

			// 3) ondataavailable = 녹음 데이터가 생길 때마다 호출됨
			//    콜백 함수: (e) => { ... } = "이벤트 e가 들어오면 실행"
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data);
			};

			// 4) onstop = 녹음이 멈췄을 때 호출
			mediaRecorder.onstop = () => {
				if (chunks.length > 0) {
					// Blob = 바이너리 데이터. audio/webm = 웹 오디오 포맷
					recordedBlob = new Blob(chunks, { type: 'audio/webm' });
					// createObjectURL = Blob을 브라우저가 재생할 수 있는 URL로 변환
					audioUrl = URL.createObjectURL(recordedBlob);
				}
				// stream?. = "stream이 있으면" (optional chaining). 마이크 끄기
				stream?.getTracks().forEach((t) => t.stop());
			};

			// 5) 녹음 시작!
			mediaRecorder.start();
			isRecording = true;

			// 6) setInterval = 1000ms(1초)마다 실행. 녹음 시간 표시용
			durationInterval = setInterval(() => {
				recordingDuration += 1;
			}, 1000);
		} catch (e) {
			// 7) catch = 에러 발생 시 (예: 사용자가 마이크 거부)
			error = e.message || '마이크 접근 권한이 필요합니다.';
		}
	}

	/* ============================================
	   stopRecording() - 녹음 중지
	   ============================================
	   mediaRecorder.stop() 호출하면 onstop 콜백이 실행됨
	*/
	function stopRecording() {
		if (mediaRecorder && isRecording) {
			mediaRecorder.stop();
			isRecording = false;
			clearInterval(durationInterval); // 타이머 중지
		}
	}

	/* ============================================
	   formatDuration() - 0초 → "00:00", 65초 → "01:05"
	   ============================================
	   padStart(2, '0') = "5" → "05" (2자리로 맞추기)
	*/
	function formatDuration(seconds) {
		const m = Math.floor(seconds / 60); // 분
		const s = seconds % 60; // 초 (나머지)
		return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}

	/* ============================================
	   $effect - 부수 효과 (cleanup)
	   ============================================
	   audioUrl이 바뀔 때마다 실행. return () => { } = cleanup 함수.
	   createObjectURL로 만든 URL은 메모리 해제를 위해 revoke해야 함.
	*/
	$effect(() => {
		const url = audioUrl;
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	});
</script>

<!--
  ============================================
  HTML 부분 - 화면
  ============================================
  class="..." = Tailwind CSS. 클래스 이름으로 스타일 적용
  예: min-h-screen = 최소 높이 화면 전체, flex = 가로/세로 정렬
-->
<div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
	<div class="w-full max-w-md rounded-2xl bg-slate-900/80 border border-slate-700/50 p-8 shadow-xl">
		<h1 class="text-xl font-semibold text-center mb-2">목소리 녹음</h1>
		<p class="text-slate-400 text-sm text-center mb-8">녹음 후 재생해서 확인하세요</p>

		<!--
		  {#if} = Svelte 조건문. error가 있으면 이 div만 보임
		  {error} = 변수 값을 그대로 출력
		-->
		{#if error}
			<div class="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-sm">
				{error}
			</div>
		{/if}

		<div class="flex flex-col items-center gap-6">
			<!--
			  onclick = 클릭 시 실행할 함수
			  () => ... = 화살표 함수. "이 함수를 실행해라"
			  isRecording ? A : B = 삼항 연산자. "녹음 중이면 A, 아니면 B"
			-->
			<button
				onclick={() => (isRecording ? stopRecording() : startRecording())}
				class="w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200
					{isRecording
					? 'bg-red-500 hover:bg-red-600 animate-pulse'
					: 'bg-emerald-500 hover:bg-emerald-600'}"
				aria-label={isRecording ? '녹음 중지' : '녹음 시작'}
			>
				<!-- {#if} / {:else} = if-else. 녹음 중이면 정지 아이콘, 아니면 마이크 아이콘 -->
				{#if isRecording}
					<svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
						<rect x="6" y="6" width="12" height="12" rx="2" />
					</svg>
				{:else}
					<svg class="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
						<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
						<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
					</svg>
				{/if}
			</button>

			<!-- 녹음 중일 때만 "녹음 중… 00:00" 표시 -->
			{#if isRecording}
				<p class="text-slate-400 text-sm">녹음 중… {formatDuration(recordingDuration)}</p>
			{/if}

			<!-- 녹음 결과가 있을 때만 재생 영역 표시 -->
			{#if recordedBlob && audioUrl}
				<div class="w-full space-y-4">
					<p class="text-slate-400 text-sm text-center">녹음 완료. 아래에서 재생해 확인하세요.</p>
					<!--
					  <audio> = HTML5 오디오. src에 URL 넣으면 재생 가능
					  controls = 재생/일시정지/볼륨 버튼 자동 표시
					-->
					<audio
						src={audioUrl}
						controls
						class="w-full h-12 rounded-lg bg-slate-800"
					></audio>
					<!--
					  {( )} = 안에 자바스크립트 식 넣기
					  toFixed(1) = 소수점 1자리까지
					-->
					<p class="text-slate-500 text-xs text-center">
						파일 크기: {(recordedBlob.size / 1024).toFixed(1)} KB
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
