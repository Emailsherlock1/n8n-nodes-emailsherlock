import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

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

async function verifyApiRequest(
	this: IExecuteFunctions,
	itemIndex: number,
	path: string,
	body: IDataObject,
): Promise<IDataObject> {
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'emailSherlockApi', {
		method: 'POST',
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
		subtitle: '={{$parameter["operation"] === "verifyBatch" ? "Verify Batch" : "Verify Email"}}',
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
				options: [
					{
						name: 'Verify Email',
						value: 'verifyEmail',
						description: 'Verify a single email address',
						action: 'Verify an email address',
					},
					{
						name: 'Verify Batch',
						value: 'verifyBatch',
						description: 'Verify a list of email addresses in one request',
						action: 'Verify a batch of email addresses',
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
					'The email addresses to verify. Separate them with commas or newlines, or map an expression that resolves to an array. The output contains one item per address, in order.',
				displayOptions: {
					show: {
						operation: ['verifyBatch'],
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
					const result = await verifyApiRequest.call(this, i, '/v1/verify/single', { email });
					returnData.push({ json: result, pairedItem: { item: i } });
				} else {
					const emails = toEmailList(this.getNodeParameter('emails', i));
					if (emails.length === 0) {
						throw new NodeOperationError(this.getNode(), 'The emails field is empty', {
							itemIndex: i,
						});
					}
					const response = await verifyApiRequest.call(this, i, '/v1/verify/batch', { emails });
					const results = Array.isArray(response.results) ? response.results : [];
					for (const result of results) {
						returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
					}
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
