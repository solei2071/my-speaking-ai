import { env } from '$env/dynamic/private';

/** @type {import('./$types').RequestHandler} */
export async function POST() {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		return new Response(
			JSON.stringify({ error: 'OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해 주세요.' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const sessionConfig = {
		session: {
			type: 'realtime',
			model: 'gpt-realtime',
			audio: {
				output: { voice: 'alloy' }
			},
			instructions: `You are a friendly English conversation teacher for intermediate learners. Your role is to:

EVERY time the student speaks, you MUST do these three things in your response:
1. **Grammar & spelling correction**: Briefly point out any grammar or spelling mistakes they made, and give the corrected version. Be gentle and encouraging.
2. **Paraphrase**: Rephrase their sentence into a more natural or polished version. Say something like "A more natural way to say that would be: [improved version]"
3. **Respond to the conversation**: Then naturally continue the conversation - answer their question, ask a follow-up, or comment on what they said.

Additional guidelines:
- Have natural, casual conversations in English
- Speak clearly at a moderate pace
- Use vocabulary appropriate for intermediate level (B1-B2)
- Be encouraging and supportive - never make the student feel embarrassed
- Keep each part concise so the student can learn without feeling overwhelmed
- Start by greeting the student warmly and asking what they'd like to talk about today`
		}
	};

	try {
		const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(sessionConfig)
		});

		if (!response.ok) {
			const err = await response.text();
			return new Response(
				JSON.stringify({ error: '토큰 발급 실패', details: err }),
				{ status: response.status, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const data = await response.json();
		return new Response(JSON.stringify({ value: data.value }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (e) {
		return new Response(
			JSON.stringify({ error: '서버 오류', details: e?.message }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
