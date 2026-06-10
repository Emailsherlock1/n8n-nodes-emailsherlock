// End-to-end test against the live sandbox (es_test_ key, no credits spent).
// Run with: EMAILSHERLOCK_SANDBOX_KEY=es_test_... npm run test:e2e
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailSherlock, makeContext, liveRequest, rewriteUrl, extraHeaders } from './helpers.mjs';

const KEY = process.env.EMAILSHERLOCK_SANDBOX_KEY;
const skip = KEY ? false : 'EMAILSHERLOCK_SANDBOX_KEY is not set';
const node = new EmailSherlock();

test('single: valid@ answers result=valid', { skip }, async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'valid@example.com'),
		request: liveRequest(KEY),
	});
	const [out] = await node.execute.call(ctx);
	assert.equal(out[0].json.result, 'valid');
	assert.equal(out[0].json.email, 'valid@example.com');
});

test('single: pending@ answers the transient retry case', { skip }, async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'pending@example.com'),
		request: liveRequest(KEY),
	});
	const [out] = await node.execute.call(ctx);
	assert.equal(out[0].json.result, 'unknown');
	assert.equal(out[0].json.reason, 'verification_pending');
});

test('batch: results come back in order, one item per address', { skip }, async () => {
	const ctx = makeContext({
		params: (name) =>
			name === 'operation'
				? 'verifyBatch'
				: 'valid@example.com, invalid@example.com, role@example.com',
		request: liveRequest(KEY),
	});
	const [out] = await node.execute.call(ctx);
	assert.equal(out.length, 3);
	assert.equal(out[0].json.result, 'valid');
	assert.equal(out[1].json.result, 'invalid');
	assert.equal(out[2].json.role, true);
});

test('sandbox responses carry X-Sandbox: true', { skip }, async () => {
	const raw = await liveRequest(KEY)({
		method: 'POST',
		url: 'https://api.emailsherlock.com/v1/verify/single',
		body: { email: 'valid@example.com' },
	});
	assert.equal(raw.headers['x-sandbox'], 'true');
});

test('ratelimit@ maps to the 429 error message', { skip }, async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'ratelimit@example.com'),
		request: liveRequest(KEY),
	});
	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /rate limit/i);
			return true;
		},
	);
});

test('servererror@ maps to the 503 retry-later message', { skip }, async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'servererror@example.com'),
		request: liveRequest(KEY),
	});
	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /temporarily unavailable/i);
			return true;
		},
	);
});

test('credential test request: sandbox key answers 200, garbage key 401', { skip }, async () => {
	const { EmailSherlockApi } = await import('./helpers.mjs');
	const { request } = new EmailSherlockApi().test;

	// Execute the declarative test request the way n8n would: request shape
	// from the credential's test block, auth header from authenticate.
	const run = async (apiKey) =>
		fetch(rewriteUrl(`${request.baseURL}${request.url}`), {
			method: request.method,
			headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, ...extraHeaders },
			body: JSON.stringify(request.body),
		});

	const ok = await run(KEY);
	assert.equal(ok.status, 200);

	const bad = await run('es_test_not_a_real_key');
	assert.equal(bad.status, 401);
});
