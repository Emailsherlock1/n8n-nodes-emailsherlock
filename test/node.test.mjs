import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailSherlock, makeContext, stubResponse } from './helpers.mjs';

const node = new EmailSherlock();

const validResult = {
	email: 'jane@acme.com',
	result: 'valid',
	deliverable: true,
	reason: 'mailbox_accepts',
	mx: true,
	disposable: false,
	role: false,
	catch_all: false,
	score: 0.95,
	freshness: 'fresh',
	domain: { name: 'acme.com', score: 87, spf: true },
};

test('verifyEmail returns the full response as one item', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'jane@acme.com'),
		request: stubResponse(200, validResult),
	});

	const [out] = await node.execute.call(ctx);
	assert.equal(out.length, 1);
	assert.deepEqual(out[0].json, validResult);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(ctx.calls[0].credentialType, 'emailSherlockApi');
	assert.equal(ctx.calls[0].options.url, 'https://api.emailsherlock.com/v1/verify/single');
	assert.deepEqual(ctx.calls[0].options.body, { email: 'jane@acme.com' });
});

test('verifyBatch splits a comma/newline string and maps results[] to items', async () => {
	const ctx = makeContext({
		params: (name) =>
			name === 'operation' ? 'verifyBatch' : 'a@acme.com, b@acme.com\nc@acme.com',
		request: stubResponse(200, {
			results: [
				{ email: 'a@acme.com', result: 'valid' },
				{ email: 'b@acme.com', result: 'invalid' },
				{ email: 'nope@', error: 'invalid_email' },
			],
		}),
	});

	const [out] = await node.execute.call(ctx);
	assert.deepEqual(ctx.calls[0].options.body, {
		emails: ['a@acme.com', 'b@acme.com', 'c@acme.com'],
	});
	assert.equal(out.length, 3);
	assert.equal(out[1].json.result, 'invalid');
	assert.equal(out[2].json.error, 'invalid_email');
	assert.deepEqual(out[2].pairedItem, { item: 0 });
});

test('verifyBatch accepts an expression that resolved to an array', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyBatch' : ['x@acme.com', ' y@acme.com ']),
		request: stubResponse(200, { results: [] }),
	});

	await node.execute.call(ctx);
	assert.deepEqual(ctx.calls[0].options.body, { emails: ['x@acme.com', 'y@acme.com'] });
});

test('402 maps to an insufficient-credits error', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'jane@acme.com'),
		request: stubResponse(402, {
			error: { code: 'insufficient_credits', message: 'Not enough credits.' },
		}),
	});

	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /Not enough credits/);
			return true;
		},
	);
});

test('429 reports the Retry-After wait time', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'jane@acme.com'),
		request: stubResponse(
			429,
			{ error: { code: 'rate_limit_exceeded', message: 'Too many requests.' } },
			{ 'retry-after': '17' },
		),
	});

	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /retry after 17 seconds/);
			return true;
		},
	);
});

test('503 maps to a retry-later error', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'jane@acme.com'),
		request: stubResponse(503, {
			error: { code: 'verify_unavailable', message: 'Verification unavailable.' },
		}),
	});

	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /temporarily unavailable/i);
			return true;
		},
	);
});

test('continueOnFail routes the error into the output stream', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : 'jane@acme.com'),
		request: stubResponse(503, { error: { code: 'verify_unavailable', message: 'down' } }),
		continueOnFail: true,
	});

	const [out] = await node.execute.call(ctx);
	assert.equal(out.length, 1);
	assert.match(out[0].json.error, /temporarily unavailable/i);
});

test('empty email fails with a clear message', async () => {
	const ctx = makeContext({
		params: (name) => (name === 'operation' ? 'verifyEmail' : '  '),
		request: stubResponse(200, validResult),
	});

	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /email field is empty/i);
			return true;
		},
	);
});

test('credential and node wiring matches the package manifest', async () => {
	const { EmailSherlockApi } = await import('./helpers.mjs');
	const credential = new EmailSherlockApi();
	assert.equal(node.description.credentials[0].name, 'emailSherlockApi');
	assert.equal(node.description.name, 'emailSherlock');
	assert.equal(credential.name, 'emailSherlockApi');
	// The n8n verification scanner requires a declarative credential test.
	assert.equal(credential.test.request.url, '/v1/verify/single');
	assert.equal(credential.test.request.baseURL, 'https://api.emailsherlock.com');
	assert.deepEqual(credential.test.request.body, { email: 'valid@example.com' });
});
