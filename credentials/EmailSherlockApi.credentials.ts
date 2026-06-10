import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EmailSherlockApi implements ICredentialType {
	name = 'emailSherlockApi';

	displayName = 'EmailSherlock API';

	// Full URL on purpose: community credentials link their own docs, not docs.n8n.io.
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://emailsherlock.com/api/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your EmailSherlock API key. Live keys start with es_live_, sandbox keys with es_test_. Create one at https://emailsherlock.com/api.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Validates the key against the zero-cost account-status endpoint: a 200
	// proves the key works without spending a credit (live or sandbox).
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.emailsherlock.com',
			url: '/v1/credits',
			method: 'GET',
		},
	};
}
