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

	// Verifies one address to validate the key. Free with a sandbox key
	// (es_test_, deterministic fixture); costs one credit with a live key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.emailsherlock.com',
			url: '/v1/verify/single',
			method: 'POST',
			body: {
				email: 'valid@example.com',
			},
		},
	};
}
