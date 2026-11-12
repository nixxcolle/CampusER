const express = require('express');
const offices = new Map([['School Clinic','clinic'],['Campus Security','security'],['DRRMO','fire_disaster']]);
const eventIdPattern = /^[A-Za-z0-9_-]{1,79}$/;

function createResponseWorkflow({ pool, authenticateStaff }) {
  const router = express.Router(), clients = new Set();
  const auth = authenticateStaff || ((_req,res) => res.status(404).json({error:'Staff responses are unavailable.'}));
  const publish = incident => {
    const message = 'data: '+JSON.stringify({event_id:incident.event_id})+'\n\n';
    for (const client of clients) if (client.office === 'Administrator' || incident.category === 'GENERAL' || offices.get(client.office) === incident.receiving_office) {
      try { if (!client.res.destroyed && !client.res.writableEnded && !client.res.write(message)) client.res.end(); }
      catch { client.res.destroy(); }
    }
  };
  router.get('/api/v1/events', auth, (req,res) => {
    res.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    res.flushHeaders();
    const client = { office:req.staff.office, res };
    clients.add(client);
    res.write('data: {"connected":true}\n\n');
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 10000);
    // Reconnects recheck the current staff token and approved office.
    const expiry = setTimeout(() => res.end(), 25000);
    res.on('close', () => { clients.delete(client); clearInterval(heartbeat); clearTimeout(expiry); });
  });
  router.post('/api/v1/reports/:eventId/acknowledge', auth, async (req,res) => {
    res.set('Cache-Control','no-store');
    if (!eventIdPattern.test(req.params.eventId)) return res.status(400).json({error:'Invalid Event ID.'});
    if (req.get('Transfer-Encoding') || Number(req.get('Content-Length') || 0) !== 0) return res.status(400).json({error:'Acknowledgment takes no request body.'});
    const officeCode = offices.get(req.staff.office) || null;
    try {
      const { rows:[saved] } = await pool.query(
        `UPDATE incidents SET response_status='acknowledged', acknowledged_at=COALESCE(acknowledged_at,clock_timestamp()),
          acknowledged_by=COALESCE(acknowledged_by,$2), acknowledged_office=COALESCE(acknowledged_office,$3)
         WHERE event_id=$1 AND response_status IN ('active','pending')
           AND ($4::text IS NULL OR receiving_office=$4 OR category='GENERAL')
         RETURNING event_id, category, receiving_office, response_status, acknowledged_at, acknowledged_by, acknowledged_office`,
        [req.params.eventId,req.staff.id,req.staff.office,officeCode]);
      if (saved) { publish(saved); return res.json(saved); }
      const { rows:[existing] } = await pool.query(
        `SELECT event_id, category, receiving_office, response_status, acknowledged_at, acknowledged_by, acknowledged_office FROM incidents
         WHERE event_id=$1 AND ($2::text IS NULL OR receiving_office=$2 OR category='GENERAL')`,
        [req.params.eventId,officeCode]);
      if (!existing) return res.status(404).json({error:'No report is available for this office.'});
      if (existing.acknowledged_at) return res.json(existing);
      return res.status(409).json({error:'This report can no longer be acknowledged.'});
    } catch { return res.status(503).json({error:'Acknowledgment could not be saved. Refresh and retry.'}); }
  });
  return {router,publish};
}
module.exports = {createResponseWorkflow};
