import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// Node global, declared locally so the package needs no @types/node dependency.
declare const setTimeout: (callback: () => void, ms: number) => unknown;

const BASE_URL = 'https://api.emailsherlock.com';

function toEmailList(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
	}
	if (typeof raw === 'string') {
		return raw
			.split(/[\s,;]+/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
	return [];
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(
	this: IExecuteFunctions,
	itemIndex: number,
	method: 'GET' | 'POST',
	path: string,
	body?: IDataObject,
): Promise<IDataObject> {
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'emailSherlockApi', {
		method,
		url: `${BASE_URL}${path}`,
		body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as { statusCode: number; headers: IDataObject; body: IDataObject };

	const { statusCode, headers } = response;
	const data = response.body ?? {};

	if (statusCode >= 200 && statusCode < 300) {
		return data;
	}

	const apiError = (data.error ?? {}) as IDataObject;
	let message = (apiError.message as string) ?? 'The EmailSherlock API returned an error';
	let description: string | undefined;

	if (statusCode === 401 || statusCode === 403) {
		message = 'The API key was rejected';
		description = 'Check the EmailSherlock credential. Keys are managed at emailsherlock.com/api.';
	} else if (statusCode === 402) {
		message = 'Not enough credits for this request';
		description =
			'The API returned insufficient_credits. Top up or upgrade your plan at emailsherlock.com/api.';
	} else if (statusCode === 404) {
		message = 'No such job';
		description = 'The job id is unknown for this account, or the job expired (7-day retention).';
	} else if (statusCode === 429) {
		const retryAfter = headers['retry-after'];
		message = retryAfter
			? `Rate limit exceeded, retry after ${retryAfter} seconds`
			: 'Rate limit exceeded';
		description =
			'The Retry-After response header tells you how long to wait. Slow down the workflow or raise your plan limits.';
	} else if (statusCode === 503) {
		message = 'Verification is temporarily unavailable';
		description =
			'The API returned verify_unavailable and refunded the credits for this call. Retry later, for example with a Wait node in front of a retry loop.';
	}

	throw new NodeApiError(this.getNode(), data as JsonObject, {
		message,
		description,
		httpCode: String(statusCode),
		itemIndex,
	});
}

export class EmailSherlock implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EmailSherlock',
		name: 'emailSherlock',
		icon: 'file:emailsherlock.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Verify email addresses with the EmailSherlock API',
		defaults: {
			name: 'EmailSherlock',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'emailSherlockApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				// Ordered by how a workflow is built (verify first, account last),
				// not alphabetically — the default keeps Verify Email preselected.
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: [
					{
						name: 'Verify Email',
						value: 'verifyEmail',
						description: 'Verify a single email address synchronously',
						action: 'Verify an email address',
					},
					{
						name: 'Verify Batch',
						value: 'verifyBatch',
						description: 'Verify a list of addresses in one synchronous request',
						action: 'Verify a batch of email addresses',
					},
					{
						name: 'Submit Verification Job',
						value: 'submitJob',
						description:
							'Submit a list for asynchronous verification with definitive inbox verdicts (up to 10000 addresses)',
						action: 'Submit a verification job',
					},
					{
						name: 'Get Verification Job',
						value: 'getJob',
						description: 'Read the status and results of a verification job by ID',
						action: 'Get a verification job',
					},
					{
						name: 'Get Account Status',
						value: 'accountStatus',
						description: 'Read the credit balance and rate-limit status. Spends no credits.',
						action: 'Get the account status',
					},
				],
				default: 'verifyEmail',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'jane@acme.com',
				description: 'The email address to verify',
				displayOptions: {
					show: {
						operation: ['verifyEmail'],
					},
				},
			},
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'jane@acme.com, sales@acme.com',
				description:
					'The addresses to verify. Separate them with commas or newlines, or map an expression that resolves to an array. The output has one item per address, in order.',
				displayOptions: {
					show: {
						operation: ['verifyBatch', 'submitJob'],
					},
				},
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				description: 'Whether to poll the job until it finishes and return the results directly. Turn this off to return the job ID immediately and poll yourself (for example with a Wait node).',
				displayOptions: {
					show: {
						operation: ['submitJob'],
					},
				},
			},
			{
				displayName: 'Max Wait (Seconds)',
				name: 'maxWaitSeconds',
				type: 'number',
				default: 120,
				description:
					'How long to keep polling before giving up and returning the unfinished job. A large job can take longer than this; in that case poll Get Verification Job yourself afterwards.',
				typeOptions: {
					minValue: 5,
					maxValue: 900,
				},
				displayOptions: {
					show: {
						operation: ['submitJob'],
						waitForCompletion: [true],
					},
				},
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '',
				required: true,
				placeholder: '0f8a3c1e-6b4d-4e2a-9c7f-2d1b3a4c5d6e',
				description: 'The job ID returned by Submit Verification Job',
				displayOptions: {
					show: {
						operation: ['getJob'],
					},
				},
			},
			{
				displayName: 'Split Results Into Items',
				name: 'splitResults',
				type: 'boolean',
				default: true,
				description:
					'Whether to output one item per verified address. Turn off to output the whole job object (status, progress, results) as a single item.',
				displayOptions: {
					show: {
						operation: ['submitJob', 'getJob'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'verifyEmail') {
					const email = (this.getNodeParameter('email', i) as string).trim();
					if (email === '') {
						throw new NodeOperationError(this.getNode(), 'The email field is empty', {
							itemIndex: i,
						});
					}
					const result = await apiRequest.call(this, i, 'POST', '/v1/verify/single', { email });
					returnData.push({ json: result, pairedItem: { item: i } });
				} else if (operation === 'verifyBatch') {
					const emails = toEmailList(this.getNodeParameter('emails', i));
					if (emails.length === 0) {
						throw new NodeOperationError(this.getNode(), 'The emails field is empty', {
							itemIndex: i,
						});
					}
					const response = await apiRequest.call(this, i, 'POST', '/v1/verify/batch', { emails });
					const results = Array.isArray(response.results) ? response.results : [];
					for (const result of results) {
						returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
					}
				} else if (operation === 'submitJob') {
					const emails = toEmailList(this.getNodeParameter('emails', i));
					if (emails.length === 0) {
						throw new NodeOperationError(this.getNode(), 'The emails field is empty', {
							itemIndex: i,
						});
					}
					let job = await apiRequest.call(this, i, 'POST', '/v1/verify/jobs', { emails });

					const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;
					if (waitForCompletion && job.status !== 'completed') {
						job = await pollJob.call(
							this,
							i,
							job.id as string,
							this.getNodeParameter('maxWaitSeconds', i) as number,
						);
					}
					pushJob.call(this, returnData, i, job);
				} else if (operation === 'getJob') {
					const jobId = (this.getNodeParameter('jobId', i) as string).trim();
					if (jobId === '') {
						throw new NodeOperationError(this.getNode(), 'The job ID field is empty', {
							itemIndex: i,
						});
					}
					const job = await apiRequest.call(
						this,
						i,
						'GET',
						`/v1/verify/jobs/${encodeURIComponent(jobId)}`,
					);
					pushJob.call(this, returnData, i, job);
				} else {
					// accountStatus
					const status = await apiRequest.call(this, i, 'GET', '/v1/credits');
					returnData.push({ json: status, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

/**
 * Poll a job until it completes or the wait budget runs out. Backs off from
 * 2s to 10s so a fast job returns quickly and a slow one does not hammer the
 * API. Returns the last job state seen (still "processing" on timeout).
 */
async function pollJob(
	this: IExecuteFunctions,
	itemIndex: number,
	jobId: string,
	maxWaitSeconds: number,
): Promise<IDataObject> {
	const deadline = Date.now() + maxWaitSeconds * 1000;
	let delayMs = 2000;
	let job: IDataObject = { id: jobId, status: 'processing' };

	while (Date.now() < deadline) {
		await sleep(delayMs);
		job = await apiRequest.call(
			this,
			itemIndex,
			'GET',
			`/v1/verify/jobs/${encodeURIComponent(jobId)}`,
		);
		if (job.status === 'completed') {
			return job;
		}
		delayMs = Math.min(delayMs + 2000, 10000);
	}

	return job;
}

function pushJob(
	this: IExecuteFunctions,
	returnData: INodeExecutionData[],
	itemIndex: number,
	job: IDataObject,
): void {
	const splitResults = this.getNodeParameter('splitResults', itemIndex) as boolean;
	const results = Array.isArray(job.results) ? job.results : null;

	// Only split once results exist; a still-processing job has none yet, so
	// fall back to the job object so the id is never lost.
	if (splitResults && results !== null) {
		for (const result of results) {
			returnData.push({ json: result as IDataObject, pairedItem: { item: itemIndex } });
		}
		return;
	}

	returnData.push({ json: job, pairedItem: { item: itemIndex } });
}
