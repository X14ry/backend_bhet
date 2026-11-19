const router = require('express').Router();
const { z } = require('zod');
const { query, transaction } = require('../db');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { getMemberConnection, isBlockedEitherWay } = require('../utils/helpers');

const idParam = z.object({ id: z.coerce.number().int().positive() });
const msgBody = z.object({ body: z.string().trim().min(1).max(2000) });
const msgQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const meetupCreate = z.object({
  venueId: z.number().int().positive(),
  scheduledAt: z.string().datetime({ offset: true }),
  shareWithTrustedContact: z.boolean().default(false),
});
const meetupStatus = z.object({ status: z.enum(['accepted', 'declined', 'cancelled']) });

// ------------------------------------------------------------ list
router.get('/connections', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const rows = await query(
    `SELECT c.id, c.intention, c.shared_summary, c.created_at,
            p.user_id AS other_user_id, p.display_name, p.photo_url,
            (SELECT m.body FROM messages m WHERE m.connection_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
            (SELECT COUNT(*) FROM messages m WHERE m.connection_id = c.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread_count
       FROM connections c
       JOIN profiles p ON p.user_id = IF(c.user_one_id = ?, c.user_two_id, c.user_one_id)
      WHERE (c.user_one_id = ? OR c.user_two_id = ?) AND c.status = 'active'
      ORDER BY c.created_at DESC`, [me, me, me, me]);
  res.json({ connections: rows });
}));

// --------------------------------------------------------- unmatch
router.post('/connections/:id/unmatch', validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const c = await getMemberConnection(req.params.id, req.user.id);
  await query(`UPDATE connections SET status = 'unmatched', ended_by = ? WHERE id = ?`, [req.user.id, c.id]);
  await query(`UPDATE meetup_plans SET status = 'cancelled'
                WHERE connection_id = ? AND status IN ('proposed','accepted')`, [c.id]);
  res.json({ message: 'Unmatched. The conversation is closed.' });
}));

// -------------------------------------------------------- messages
router.get('/connections/:id/messages', validate(idParam, 'params'), validate(msgQuery, 'query'),
  asyncHandler(async (req, res) => {
    const c = await getMemberConnection(req.params.id, req.user.id);
    const { before, limit } = req.validatedQuery;
    const rows = await query(
      `SELECT id, sender_id, body, read_at, created_at FROM messages
        WHERE connection_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      before ? [c.id, before, limit] : [c.id, limit]);
    await query(
      `UPDATE messages SET read_at = NOW() WHERE connection_id = ? AND sender_id <> ? AND read_at IS NULL`,
      [c.id, req.user.id]);
    res.json({
      summary: c.shared_summary,
      messages: rows.reverse().map((m) => ({ ...m, mine: m.sender_id === req.user.id })),
    });
  }));

router.post('/connections/:id/messages', validate(idParam, 'params'), validate(msgBody),
  asyncHandler(async (req, res) => {
    const c = await getMemberConnection(req.params.id, req.user.id);
    if (await isBlockedEitherWay(req.user.id, c.other_user_id)) throw forbidden('You cannot message this person');
    const [r] = await require('../db').pool.query(
      'INSERT INTO messages (connection_id, sender_id, body) VALUES (?, ?, ?)',
      [c.id, req.user.id, req.body.body]);
    const rows = await query('SELECT id, sender_id, body, created_at FROM messages WHERE id = ?', [r.insertId]);
    res.status(201).json({ message: { ...rows[0], mine: true } });
  }));

// --------------------------------------------------------- venues
router.get('/venues', asyncHandler(async (_req, res) => {
  res.json({
    note: 'Meetups use public venues only. Exact locations are never shared.',
    venues: await query('SELECT id, name, area, category FROM venues WHERE is_active = 1 ORDER BY name'),
  });
}));

// --------------------------------------------------------- meetups
const meetupSelect = `
  SELECT mp.id, mp.connection_id, mp.proposed_by, mp.scheduled_at, mp.status,
         mp.shared_with_trusted_contact, mp.created_at,
         v.id AS venue_id, v.name AS venue_name, v.area AS venue_area, v.category AS venue_category
    FROM meetup_plans mp JOIN venues v ON v.id = mp.venue_id`;

router.get('/connections/:id/meetups', validate(idParam, 'params'), asyncHandler(async (req, res) => {
  const c = await getMemberConnection(req.params.id, req.user.id, undefined, { requireActive: false });
  res.json({ meetups: await query(`${meetupSelect} WHERE mp.connection_id = ? ORDER BY mp.scheduled_at DESC`, [c.id]) });
}));

router.post('/connections/:id/meetups', validate(idParam, 'params'), validate(meetupCreate),
  asyncHandler(async (req, res) => {
    const c = await getMemberConnection(req.params.id, req.user.id);
    const { venueId, scheduledAt, shareWithTrustedContact } = req.body;

    const when = new Date(scheduledAt);
    if (when.getTime() <= Date.now()) throw badRequest('Choose a time in the future');

    const venue = await query('SELECT id FROM venues WHERE id = ? AND is_active = 1', [venueId]);
    if (!venue.length) throw badRequest('Please choose a listed public venue');

    if (shareWithTrustedContact) {
      const tc = await query('SELECT id FROM trusted_contacts WHERE user_id = ? LIMIT 1', [req.user.id]);
      if (!tc.length) throw badRequest('Add a trusted contact first to share this plan');
    }

    const mysqlDate = when.toISOString().slice(0, 19).replace('T', ' ');
    const [r] = await require('../db').pool.query(
      `INSERT INTO meetup_plans (connection_id, proposed_by, venue_id, scheduled_at, shared_with_trusted_contact)
       VALUES (?, ?, ?, ?, ?)`, [c.id, req.user.id, venueId, mysqlDate, shareWithTrustedContact ? 1 : 0]);
    const rows = await query(`${meetupSelect} WHERE mp.id = ?`, [r.insertId]);
    res.status(201).json({ meetup: rows[0] });
  }));

router.patch('/meetups/:id', validate(idParam, 'params'), validate(meetupStatus), asyncHandler(async (req, res) => {
  const plans = await query('SELECT * FROM meetup_plans WHERE id = ?', [req.params.id]);
  if (!plans.length) throw notFound('Meetup not found');
  const plan = plans[0];
  const c = await getMemberConnection(plan.connection_id, req.user.id);
  const { status } = req.body;

  if (status === 'cancelled') {
    if (!['proposed', 'accepted'].includes(plan.status)) throw badRequest('This plan can no longer be cancelled');
  } else {
    if (plan.proposed_by === req.user.id) throw forbidden('Only the other person can accept or decline');
    if (plan.status !== 'proposed') throw badRequest('This plan has already been answered');
  }
  await query('UPDATE meetup_plans SET status = ? WHERE id = ?', [status, plan.id]);
  const rows = await query(`${meetupSelect} WHERE mp.id = ?`, [plan.id]);
  res.json({ meetup: rows[0], connectionId: c.id });
}));

module.exports = router;
