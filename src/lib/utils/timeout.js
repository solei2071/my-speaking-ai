export function withTimeout(promise, ms, operation = 'Operation') {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
		)
	]);
}
