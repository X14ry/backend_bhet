const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/httpError');

const listQuery = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const patchSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
  suspendReportedUser: z.boolean().optional(),
});

router.get('/reports', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { status, limit } = req.validatedQuery;
  const rows = await query(
    `SELECT r.*, rp.display_name AS reported_name, rr.display_name AS reporter_name
       FROM reports r
       LEFT JOIN profiles rp ON rp.user_id = r.reported_id
       LEFT JOIN profiles rr ON rr.user_id = r.reporter_id
      ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT ?`,
    status ? [status, limit] : [limit]);
  res.json({ reports: rows });
}));

router.patch('/reports/:id', validate(idParam, 'params'), validate(patchSchema), asyncHandler(async (req, res) => {
  const rows = await query('SELECT id, reported_id FROM reports WHERE id = ?', [req.params.id]);
  if (!rows.length) throw notFound('Report not found');
  await query('UPDATE reports SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
  if (req.body.suspendReportedUser && rows[0].reported_id) {
    await query(`UPDATE users SET status = 'suspended' WHERE id = ? AND role <> 'admin'`, [rows[0].reported_id]);
  }
  res.json({ message: 'Report updated' });
}));

module.exports = router;
