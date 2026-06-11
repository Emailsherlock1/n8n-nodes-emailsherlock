import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailSherlock, makeContext, stubResponse } from './helpers.mjs';

const node = new EmailSherlock();

// Stub that branches on the request method+path, for the multi-call job flow.
function routedResponse(routes) {
	return (options) => {
		for (const [match, body] of routes) {
			if (options.method === match.method && options.url.includes(match.path)) {
				return Promise.resolve({ statusCode: 200, headers: {}, body });
			}
		}
		throw new Error(`no stub for ${options.method} ${options.url}`);
	};
}

// Params helper: per-operation parameter bag, looked up by name.
function paramsFor(bag) {
	return (name) => bag[name];
}

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

const jobCompleted = {
	id: 'job-1',
	status: 'completed',
	total: 2,
	progress: { total: 2, done: 2 },
	results: [
		{ email: 'a@acme.com', result: 'valid' },
		{ email: 'nope@', error: 'invalid_email' },
	],
};

test('submitJob: a sandbox/completed job inline splits results into items', async () => {
	const ctx = makeContext({
		params: paramsFor({
			operation: 'submitJob',
			emails: 'a@acme.com, nope@',
			splitResults: true,
		}),
		request: routedResponse([[{ method: 'POST', path: '/v1/verify/jobs' }, jobCompleted]]),
	});

	const [out] = await node.execute.call(ctx);
	assert.equal(ctx.calls[0].options.method, 'POST');
	assert.deepEqual(ctx.calls[0].options.body, { emails: ['a@acme.com', 'nope@'] });
	assert.equal(out.length, 2);
	assert.equal(out[0].json.result, 'valid');
	assert.equal(out[1].json.error, 'invalid_email');
	// Submit returns immediately — exactly one HTTP call, no in-node polling.
	assert.equal(ctx.calls.length, 1);
});

test('submitJob: a processing live job returns the job object immediately', async () => {
	const processing = { id: 'job-2', status: 'processing', total: 2, progress: { total: 2, done: 0 } };
	const ctx = makeContext({
		params: paramsFor({
			operation: 'submitJob',
			emails: 'a@acme.com, b@acme.com',
			splitResults: true,
		}),
		request: routedResponse([[{ method: 'POST', path: '/v1/verify/jobs' }, processing]]),
	});

	const [out] = await node.execute.call(ctx);
	// No poll: a still-processing job has no results yet, so the job object
	// (with its id) is returned for a Get Verification Job follow-up.
	assert.equal(ctx.calls.length, 1);
	assert.equal(out.length, 1);
	assert.equal(out[0].json.id, 'job-2');
	assert.equal(out[0].json.status, 'processing');
});

test('getJob: 404 maps to a no-such-job error', async () => {
	const ctx = makeContext({
		params: paramsFor({ operation: 'getJob', jobId: 'gone', splitResults: true }),
		request: stubResponse(404, { error: { code: 'job_not_found', message: 'No such job.' } }),
	});

	await assert.rejects(
		() => node.execute.call(ctx),
		(e) => {
			assert.match(e.message, /no such job/i);
			return true;
		},
	);
});

test('getJob: splitResults=false returns the whole job object', async () => {
	const ctx = makeContext({
		params: paramsFor({ operation: 'getJob', jobId: 'job-1', splitResults: false }),
		request: routedResponse([[{ method: 'GET', path: '/v1/verify/jobs/' }, jobCompleted]]),
	});

	const [out] = await node.execute.call(ctx);
	assert.equal(ctx.calls[0].options.method, 'GET');
	assert.equal(ctx.calls[0].options.url, 'https://api.emailsherlock.com/v1/verify/jobs/job-1');
	assert.equal(out.length, 1);
	assert.equal(out[0].json.status, 'completed');
	assert.equal(out[0].json.progress.done, 2);
});

test('accountStatus: GET /v1/credits, spends nothing', async () => {
	const ctx = makeContext({
		params: paramsFor({ operation: 'accountStatus' }),
		request: routedResponse([
			[
				{ method: 'GET', path: '/v1/credits' },
				{ credits: { total: 1240, purchased: 1000, gifted: 240 }, rate_limit: { limit: 60, remaining: 59, reset: 1 }, plan: 'Free', sandbox: false },
			],
		]),
	});

	const [out] = await node.execute.call(ctx);
	assert.equal(ctx.calls[0].options.method, 'GET');
	assert.equal(ctx.calls[0].options.url, 'https://api.emailsherlock.com/v1/credits');
	assert.equal(out[0].json.credits.total, 1240);
	assert.equal(out[0].json.plan, 'Free');
});

test('credential and node wiring matches the package manifest', async () => {
	const { EmailSherlockApi } = await import('./helpers.mjs');
	const credential = new EmailSherlockApi();
	assert.equal(node.description.credentials[0].name, 'emailSherlockApi');
	assert.equal(node.description.name, 'emailSherlock');
	assert.equal(credential.name, 'emailSherlockApi');
	// The n8n verification scanner requires a declarative credential test.
	// It hits the zero-cost account endpoint (no credit spent on a key check).
	assert.equal(credential.test.request.url, '/v1/credits');
	assert.equal(credential.test.request.method, 'GET');
	assert.equal(credential.test.request.baseURL, 'https://api.emailsherlock.com');
});
