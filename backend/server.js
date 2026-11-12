const { createHash } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { Pool } = require('pg');
const { createStaffAuth } = require('./staff-auth');
const { createAudioRoutes } = require('./audio');
const { createResponseWorkflow } = require('./response-workflow');

const host = '127.0.0.1';
const port = 3000;
const receivingOffice = new Map([
  ['MEDICAL', 'clinic'],
  ['SECURITY', 'security'],
  ['FIRE_DISASTER', 'fire_disaster'],
  ['GENERAL', 'general'],
]);

function validReport(report, idempotencyKey) {
  return report &&
    typeof report.station_id === 'string' && /^STATION-\d{2}$/.test(report.station_id) &&
    typeof report.event_id === 'string' && /^[a-zA-Z0-9_-]{1,79}$/.test(report.event_id) &&
    report.event_id.startsWith(`${report.station_id}-`) &&
    report.event_id === idempotencyKey &&
    typeof report.location === 'string' && report.location.trim().length > 0 &&
    receivingOffice.has(report.category) && report.trigger === 'physical_button' &&
    Number.isInteger(report.uptime_ms) && report.uptime_ms >= 0 && report.uptime_ms <= 4294967295 &&
    (report.occurred_at_unix === null ||
      (Number.isSafeInteger(report.occurred_at_unix) && report.occurred_at_unix >= 0));
}

function matchesStoredReport(saved, report) {
  return saved.station_id === report.station_id && saved.location === report.location &&
    saved.category === report.category && saved.trigger_source === report.trigger &&
    saved.uptime_ms === String(report.uptime_ms) &&
    saved.occurred_at_unix === (report.occurred_at_unix === null ? null : String(report.occurred_at_unix));
}

function sendStoredReceipt(res, status, eventId) {
  res.status(status)
    .set('X-Report-ID', eventId)
    .set('X-Report-Stored', 'true')
    .json({ event_id: eventId });
}

function createApp(db, dashboardConfig = null, verifyUserFetch = fetch, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  const audioDirectory = path.resolve(options.audioDirectory || process.env.CAMPUS_ER_AUDIO_DIR ||
    path.join(os.homedir(), '.local', 'share', 'campus-er', 'incident-audio'));
  const authenticateStaff = dashboardConfig ? createStaffAuth(dashboardConfig, verifyUserFetch) : null;
  const responses = createResponseWorkflow({pool:db,authenticateStaff});

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1 FROM stations LIMIT 1');
      await db.query('SELECT 1 FROM incident_audio LIMIT 1');
      await db.query('SELECT response_status, acknowledged_at FROM incidents LIMIT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ error: 'Database, station or audio schema unavailable' });
    }
  });

  app.post('/api/v1/reports', express.json({ limit: '4kb' }), async (req, res) => {
    const report = req.body;
    if (!validReport(report, req.get('Idempotency-Key'))) {
      return res.status(400).json({ error: 'Invalid report or mismatched Idempotency-Key' });
    }

    const authorization = /^Bearer ([0-9a-f]{64})$/i.exec(req.get('Authorization') || '');
    const tokenHash = authorization && createHash('sha256').update(authorization[1]).digest('hex');
    const { rows: [station] } = await db.query(
      'SELECT location FROM stations WHERE station_id = $1 AND device_token_sha256 = $2',
      [report.station_id, tokenHash],
    );
    if (!station) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Invalid station credential' });
    }

    if (report.location === station.location) {
      const { rows } = await db.query(
        `INSERT INTO incidents
           (event_id, station_id, location, receiving_office, category, trigger_source, uptime_ms, occurred_at_unix)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [report.event_id, report.station_id, station.location, receivingOffice.get(report.category),
          report.category, report.trigger, report.uptime_ms, report.occurred_at_unix],
      );
      if (rows.length) {
        responses.publish({event_id:report.event_id,category:report.category,receiving_office:receivingOffice.get(report.category)});
        return sendStoredReceipt(res, 201, report.event_id);
      }
    }

    // A separate statement can see the committed row after a concurrent insert wins.
    const { rows: [saved] } = await db.query(
      `SELECT station_id, location, category, trigger_source,
              uptime_ms::text, occurred_at_unix::text
       FROM incidents WHERE event_id = $1`,
      [report.event_id],
    );
    if (!saved) {
      if (report.location !== station.location) {
        return res.status(422).json({ error: 'Location does not match station registration' });
      }
      return res.status(503).json({ error: 'Report could not be confirmed. Retry the same Event ID.' });
    }
    if (!matchesStoredReport(saved, report)) {
      return res.status(409).json({ error: 'Event ID is already in use for a different report' });
    }
    return sendStoredReceipt(res, 200, report.event_id);
  });

  app.use(createAudioRoutes({ pool: db, authenticateStaff, audioDirectory }));
  app.use(responses.router);

  if (dashboardConfig) {
    const pwaDirectory = path.resolve(dashboardConfig.pwaDirectory || '');
    if (!dashboardConfig.pwaDirectory || !existsSync(path.join(pwaDirectory, 'index.html'))) {
      throw new Error('Set pwaDirectory to the CampusER checkout containing index.html.');
    }
    if (audioDirectory === pwaDirectory || audioDirectory.startsWith(pwaDirectory + path.sep)) {
      throw new Error('Keep private audio storage outside the frontend directory.');
    }
    const staffOfficeCode = new Map([
      ['School Clinic', 'clinic'],
      ['Campus Security', 'security'],
      ['DRRMO', 'fire_disaster'],
    ]);
    const noStore = (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    };

    app.get('/api/v1/staff/session', noStore, authenticateStaff, (req, res) => {
      res.json({ office: req.staff.office, features:{acknowledgements:true,live_updates:true} });
    });
    app.get('/api/v1/reports', noStore, authenticateStaff, async (req, res) => {
      const office = staffOfficeCode.get(req.staff.office);
      const { rows } = await db.query(
        `SELECT i.event_id, i.station_id, i.location, i.category, i.receiving_office,
                i.received_at, i.occurred_at_unix, i.uptime_ms,
                i.response_status, i.acknowledged_at, i.acknowledged_by, i.acknowledged_office,
                a.event_id IS NOT NULL AS audio_available, a.sha256 AS audio_sha256,
                a.duration_ms AS audio_duration_ms
         FROM incidents i LEFT JOIN incident_audio a ON a.event_id = i.event_id
         WHERE ($1::text IS NULL OR i.receiving_office = $1 OR i.category = 'GENERAL')
         ORDER BY i.received_at DESC, i.event_id DESC`,
        [office || null],
      );
      res.json({ incidents: rows });
    });
    app.get('/campus-er-config.js', (_req, res) => {
      res.type('application/javascript').set('Cache-Control', 'no-store')
        .send("window.CAMPUS_ER_SOURCE = 'pi';\n");
    });
    // Backend settings must never become static frontend downloads.
    app.use((req,res,next)=>{
      let requested;try{requested=path.posix.normalize(decodeURIComponent(req.path).replaceAll('\\','/'));}catch{return res.status(400).end();}
      if(/^\/(backend|verification)(\/|$)/i.test(requested))return res.status(404).end();
      next();
    });
    app.use(express.static(pwaDirectory, {
      dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    }));
  }

  app.use((error, _req, res, _next) => {
    if (error.status >= 400 && error.status < 500) {
      return res.status(error.status).json({ error: 'Unable to read request body' });
    }
    console.error('Request failed:', error.code || error.name);
    return res.status(503).json({ error: 'Unable to confirm storage. Retry the same Event ID.' });
  });

  return app;
}

if (require.main === module) {
  const db = new Pool({ connectionTimeoutMillis: 5000 });
  db.on('error', (error) => console.error('Idle database connection failed:', error.code || error.name));
  let app;
  try {
    let dashboardConfig = null;
    if (process.env.CAMPUS_ER_DASHBOARD_CONFIG) {
      try {
        dashboardConfig = JSON.parse(readFileSync(process.env.CAMPUS_ER_DASHBOARD_CONFIG, 'utf8'));
      } catch {
        throw new Error('Unable to read dashboard configuration JSON.');
      }
    }
    app = createApp(db, dashboardConfig);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    db.end();
    return;
  }
  const server = app.listen(port, host);
  server.on('listening', () => {
    console.log(`CAMPUS-ER report API is listening on http://${host}:${port}`);
  });
  server.on('error', (error) => {
    console.error('Unable to start the report API:', error.code || error.name);
    process.exitCode = 1;
    db.end();
  });
}

module.exports = { createApp };
