import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const { EmailSherlock } = require('../dist/nodes/EmailSherlock/EmailSherlock.node.js');
export const {
	EmailSherlockApi,
} = require('../dist/credentials/EmailSherlockApi.credentials.js');

// Minimal IExecuteFunctions stand-in: enough surface for EmailSherlock.execute().
export function makeContext({ params, items = [{ json: {} }], request, continueOnFail = false }) {
	const calls = [];
	return {
		calls,
		getInputData: () => items,
		getNodeParameter: (name, itemIndex) => params(name, itemIndex),
		getNode: () => ({ name: 'EmailSherlock', type: 'emailSherlock', typeVersion: 1 }),
		continueOnFail: () => continueOnFail,
		helpers: {
			async httpRequestWithAuthentication(credentialType, options) {
				calls.push({ credentialType, options });
				return request(options);
			},
		},
	};
}

export function stubResponse(statusCode, body, headers = {}) {
	return () => Promise.resolve({ statusCode, headers, body });
}

// Real HTTP against the live API, shaped like the n8n helper response
// (returnFullResponse: true). Used by the sandbox e2e test.
// EMAILSHERLOCK_API_BASE rewrites the base URL so the same test can run
// against a local instance of the API.
const API_BASE = process.env.EMAILSHERLOCK_API_BASE ?? 'https://api.emailsherlock.com';

export function rewriteUrl(url) {
	return url.replace('https://api.emailsherlock.com', API_BASE);
}

// A local instance sits behind no TLS terminator, so the https channel
// requirement needs the forwarded-proto hint.
export const extraHeaders = API_BASE.startsWith('http://')
	? { 'X-Forwarded-Proto': 'https' }
	: {};

export function liveRequest(apiKey) {
	return async (options) => {
		const res = await fetch(rewriteUrl(options.url), {
			method: options.method,
			headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, ...extraHeaders },
			body: JSON.stringify(options.body),
		});
		const body = await res.json().catch(() => ({}));
		return {
			statusCode: res.status,
			headers: Object.fromEntries(res.headers.entries()),
			body,
		};
	};
}
