const assert = require('node:assert/strict');
const test = require('node:test');
const { createStaffAuth } = require('./staff-auth');

const userId = '01234567-89ab-4cde-8f01-23456789abcd';
const otherUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const config = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'sb_publishable_test',
  staff: { [userId]: 'School Clinic' },
};

async function invoke(middleware, header = 'Bearer test-user-token') {
  const req = { get: () => header };
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalls = 0;
  await middleware(req, res, () => { nextCalls += 1; });
  return { req, res, nextCalls };
}

test('approved staff gets the Pi office even when metadata claims administrator', async () => {
  const middleware = createStaffAuth(config, async (url, options) => {
    assert.equal(url, 'https://example.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, config.supabaseAnonKey);
    assert.equal(options.headers.Authorization, 'Bearer test-user-token');
    assert(options.signal instanceof AbortSignal);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: userId.toUpperCase(), user_metadata: { office: 'Administrator' } }),
    };
  });
  const result = await invoke(middleware);
  assert.equal(result.nextCalls, 1);
  assert.deepEqual(result.req.staff, { id: userId, office: 'School Clinic' });
});

test('malformed and oversized tokens are rejected before contacting Supabase', async () => {
  let requests = 0;
  const middleware = createStaffAuth(config, async () => { requests += 1; });
  for (const header of [null, '', 'Basic token', 'Bearer ', 'Bearer a b', 'Bearer token\n', `Bearer ${'x'.repeat(8193)}`]) {
    const result = await invoke(middleware, header);
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.res.headers['WWW-Authenticate'], 'Bearer');
    assert.equal(result.nextCalls, 0);
  }
  assert.equal(requests, 0);
});

test('an authentic but unapproved user is denied regardless of claimed office', async () => {
  const middleware = createStaffAuth(config, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: otherUserId, office: 'Administrator' }),
  }));
  const result = await invoke(middleware);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalls, 0);
  assert.equal(result.req.staff, undefined);
});

test('invalid Supabase tokens and invalid user IDs receive 401', async () => {
  for (const status of [400, 401, 403]) {
    const result = await invoke(createStaffAuth(config, async () => ({ ok: false, status })));
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.nextCalls, 0);
  }
  for (const id of [undefined, 'invalid', `${userId}\n`]) {
    const result = await invoke(createStaffAuth(config, async () => ({
      ok: true, status: 200, json: async () => ({ id }),
    })));
    assert.equal(result.res.statusCode, 401);
    assert.equal(result.nextCalls, 0);
  }
});

test('authentication outages return 503 without exposing upstream details', async () => {
  const privateDetail = 'upstream-private-detail';
  const fetchers = [
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: false, status: 500 }),
    async () => { throw new Error(privateDetail); },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error(privateDetail); } }),
  ];
  for (const fetcher of fetchers) {
    const result = await invoke(createStaffAuth(config, fetcher));
    assert.equal(result.res.statusCode, 503);
    assert.equal(result.nextCalls, 0);
    assert(!JSON.stringify(result.res.body).includes(privateDetail));
  }
});

test('startup rejects unsafe keys, origins and staff mappings without echoing configuration', () => {
  const secret = 'private-key-material';
  const serviceKey = `header.${Buffer.from(JSON.stringify({ role: 'service_role', secret })).toString('base64url')}.signature`;
  const publicKey = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  assert.doesNotThrow(() => createStaffAuth({ ...config, supabaseAnonKey: publicKey }));
  const invalid = [
    { ...config, supabaseUrl: `http://${secret}.example` },
    { ...config, supabaseUrl: `https://${secret}@example.supabase.co` },
    { ...config, supabaseUrl: `https://example.supabase.co/${secret}` },
    { ...config, supabaseAnonKey: '' },
    { ...config, supabaseAnonKey: `sb_secret_${secret}` },
    { ...config, supabaseAnonKey: serviceKey },
    { ...config, staff: { [secret]: 'School Clinic' } },
    { ...config, staff: { [userId]: secret } },
    { ...config, staff: { [userId]: 'School Clinic', [userId.toUpperCase()]: 'Administrator' } },
  ];
  for (const candidate of invalid) {
    assert.throws(() => createStaffAuth(candidate), (error) => {
      assert.equal(error.name, 'Error');
      assert(!error.message.includes(secret));
      assert(!error.message.includes(serviceKey));
      return true;
    });
  }
});
