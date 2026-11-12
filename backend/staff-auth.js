const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const offices = new Set(['School Clinic', 'Campus Security', 'DRRMO', 'Administrator']);

function createStaffAuth(config, fetchImpl = fetch) {
  let authUrl;
  try {
    const url = new URL(config?.supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
        url.search || url.hash) {
      throw new Error();
    }
    authUrl = `${url.origin}/auth/v1/user`;
  } catch {
    throw new Error('Staff authentication requires a Supabase HTTPS origin without a path or credentials.');
  }

  const apiKey = config.supabaseAnonKey;
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey)) {
    throw new Error('Staff authentication requires a nonempty Supabase public key.');
  }
  let keyRole;
  try {
    keyRole = JSON.parse(Buffer.from(apiKey.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    // Publishable keys do not contain a JWT payload.
  }
  if (apiKey.startsWith('sb_secret_') || keyRole === 'service_role') {
    throw new Error('Use a Supabase public key for staff authentication.');
  }

  if (!config.staff || typeof config.staff !== 'object' || Array.isArray(config.staff)) {
    throw new Error('Staff access must map Supabase user UUIDs to approved office names.');
  }
  const approvedStaff = new Map();
  for (const [id, office] of Object.entries(config.staff)) {
    if (id.length !== 36 || !userIdPattern.test(id) || !offices.has(office) || approvedStaff.has(id.toLowerCase())) {
      throw new Error('Staff access contains an invalid user UUID, office, or duplicate user.');
    }
    approvedStaff.set(id.toLowerCase(), office);
  }

  return async function staffAuth(req, res, next) {
    const header = req.get('Authorization');
    const authorization = typeof header === 'string' && /^Bearer (\S+)$/i.exec(header);
    if (!authorization || authorization[0].length !== header.length || authorization[1].length > 8192) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'A staff access token is required.' });
    }

    let user;
    try {
      const response = await fetchImpl(authUrl, {
        headers: { apikey: apiKey, Authorization: `Bearer ${authorization[1]}` },
        signal: AbortSignal.timeout(5000),
      });
      if ([400, 401, 403].includes(response.status)) {
        return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'The staff access token is invalid.' });
      }
      if (!response.ok) {
        return res.status(503).json({ error: 'Staff sign-in verification is unavailable.' });
      }
      user = await response.json();
    } catch {
      return res.status(503).json({ error: 'Staff sign-in verification is unavailable.' });
    }

    if (typeof user?.id !== 'string' || user.id.length !== 36 || !userIdPattern.test(user.id)) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'The staff access token is invalid.' });
    }
    const id = user.id.toLowerCase();
    const office = approvedStaff.get(id);
    if (!office) {
      return res.status(403).json({ error: 'This account is not approved for the Pi dashboard.' });
    }

    req.staff = { id, office };
    return next();
  };
}

module.exports = { createStaffAuth };
