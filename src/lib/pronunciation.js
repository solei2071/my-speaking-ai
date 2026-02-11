/**
 * Pronunciation analysis utilities for speech recognition feedback
 */

/**
 * Analyze speech metrics from Web Speech API results
 * @param {string} transcript - The recognized text
 * @param {number} confidence - Overall confidence score (0-1)
 * @param {number} duration - Speaking duration in milliseconds
 * @param {Array} wordResults - Individual word results with confidence scores
 * @returns {Object} Analysis results
 */
export function analyzeSpeech(transcript, confidence = 0, duration = 0, wordResults = []) {
	if (!transcript?.trim()) {
		return {
			clarityScore: 0,
			speakingPace: 0,
			feedback: 'No speech detected',
			problematicWords: [],
			strengths: []
		};
	}

	const words = transcript.trim().split(/\s+/);
	const wordCount = words.length;

	// Calculate speaking pace (words per minute)
	const minutes = duration / 60000;
	const speakingPace = minutes > 0 ? Math.round(wordCount / minutes) : 0;

	// Clarity score (0-100, based on confidence)
	const clarityScore = Math.round(confidence * 100);

	// Get problematic words (low confidence)
	const problematicWords = getProblematicWords(wordResults, words);

	// Generate feedback
	const feedback = generateFeedback({
		clarityScore,
		speakingPace,
		problematicWords,
		wordCount
	});

	// Identify strengths
	const strengths = identifyStrengths({
		clarityScore,
		speakingPace,
		wordCount
	});

	return {
		clarityScore,
		speakingPace,
		wordCount,
		duration,
		feedback,
		problematicWords,
		strengths
	};
}

/**
 * Extract words with low confidence scores
 * @param {Array} wordResults - Array of {word, confidence} objects
 * @returns {Array} Words that need improvement
 */
export function getProblematicWords(wordResults = []) {
	if (!wordResults || wordResults.length === 0) {
		return [];
	}

	// Threshold for problematic words (below 70% confidence)
	const CONFIDENCE_THRESHOLD = 0.7;

	return wordResults
		.filter((result) => result.confidence < CONFIDENCE_THRESHOLD)
		.map((result) => ({
			word: result.word,
			confidence: Math.round(result.confidence * 100),
			suggestion: generateWordSuggestion(result.word)
		}));
}

/**
 * Generate improvement suggestion for a word
 * @param {string} word
 * @returns {string} Suggestion text
 */
function generateWordSuggestion(word) {
	// Common pronunciation challenges
	const commonIssues = {
		th: ['the', 'think', 'three', 'through', 'thing'],
		r: ['really', 'right', 'road', 'rule', 'river'],
		l: ['love', 'life', 'little', 'level', 'long'],
		v: ['very', 'voice', 'video', 'value', 'view']
	};

	for (const [sound, examples] of Object.entries(commonIssues)) {
		if (examples.some((ex) => word.toLowerCase().includes(ex))) {
			return `Focus on the '${sound}' sound`;
		}
	}

	return 'Try speaking more clearly';
}

/**
 * Generate user-friendly feedback based on analysis
 * @param {Object} analysis - Analysis metrics
 * @returns {string} Feedback message
 */
export function generateFeedback({ clarityScore, speakingPace, problematicWords }) {
	const feedback = [];

	// Clarity feedback
	if (clarityScore >= 85) {
		feedback.push('Excellent clarity! 🌟');
	} else if (clarityScore >= 70) {
		feedback.push('Good clarity, keep it up!');
	} else if (clarityScore >= 50) {
		feedback.push('Try speaking a bit more clearly');
	} else {
		feedback.push('Speak slower and enunciate more clearly');
	}

	// Speaking pace feedback (optimal: 120-150 WPM)
	if (speakingPace > 0) {
		if (speakingPace < 100) {
			feedback.push('You can speak a bit faster');
		} else if (speakingPace > 180) {
			feedback.push('Try slowing down a little');
		} else {
			feedback.push('Great speaking pace!');
		}
	}

	// Problematic words feedback
	if (problematicWords.length > 0) {
		const wordList = problematicWords.slice(0, 3).map((w) => w.word);
		if (wordList.length === 1) {
			feedback.push(`Work on: "${wordList[0]}"`);
		} else {
			feedback.push(`Work on: ${wordList.join(', ')}`);
		}
	}

	return feedback.join(' • ');
}

/**
 * Identify user's strengths based on metrics
 * @param {Object} metrics
 * @returns {Array} List of strengths
 */
function identifyStrengths({ clarityScore, speakingPace, wordCount }) {
	const strengths = [];

	if (clarityScore >= 80) {
		strengths.push({ label: 'Clear pronunciation', icon: '🎯' });
	}

	if (speakingPace >= 120 && speakingPace <= 160) {
		strengths.push({ label: 'Natural pace', icon: '⚡' });
	}

	if (wordCount >= 10) {
		strengths.push({ label: 'Good fluency', icon: '💬' });
	}

	return strengths;
}

/**
 * Detect hesitation markers in transcript
 * @param {string} transcript
 * @returns {Object} Hesitation analysis
 */
export function detectHesitation(transcript) {
	const hesitationWords = ['um', 'uh', 'er', 'ah', 'like', 'you know', 'I mean'];
	const lowerTranscript = transcript.toLowerCase();

	const detected = hesitationWords.filter((word) => lowerTranscript.includes(word));

	return {
		hasHesitation: detected.length > 0,
		markers: detected,
		count: detected.length,
		suggestion:
			detected.length > 2
				? 'Try to reduce filler words for more confident speech'
				: detected.length > 0
					? 'Minimize filler words'
					: ''
	};
}

/**
 * Calculate overall pronunciation score
 * @param {Object} analysis - Analysis object from analyzeSpeech
 * @returns {Object} Overall score and grade
 */
export function calculateOverallScore(analysis) {
	const { clarityScore, speakingPace, problematicWords } = analysis;

	// Weight factors
	const clarityWeight = 0.6;
	const paceWeight = 0.2;
	const accuracyWeight = 0.2;

	// Pace score (optimal: 120-160 WPM)
	let paceScore = 100;
	if (speakingPace > 0) {
		if (speakingPace < 100 || speakingPace > 180) {
			paceScore = 60;
		} else if (speakingPace < 120 || speakingPace > 160) {
			paceScore = 80;
		}
	}

	// Accuracy score (based on problematic words)
	const totalWords = analysis.wordCount || 1;
	const errorRate = problematicWords.length / totalWords;
	const accuracyScore = Math.max(0, 100 - errorRate * 100);

	// Overall score
	const overallScore = Math.round(
		clarityScore * clarityWeight + paceScore * paceWeight + accuracyScore * accuracyWeight
	);

	// Grade
	let grade = 'F';
	if (overallScore >= 90) grade = 'A';
	else if (overallScore >= 80) grade = 'B';
	else if (overallScore >= 70) grade = 'C';
	else if (overallScore >= 60) grade = 'D';

	return {
		score: overallScore,
		grade,
		breakdown: {
			clarity: clarityScore,
			pace: paceScore,
			accuracy: Math.round(accuracyScore)
		}
	};
}
