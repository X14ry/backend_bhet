const router = require('express').Router();
const { z } = require('zod');
const { query, transaction } = require('../db');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/httpError');

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  shortBio: z.string().trim().max(300).optional().nullable(),
  photoUrl: z.string().trim().url().max(500).optional().nullable(),
  intention: z.enum(['friendship', 'dating']),
  broadArea: z.string().trim().min(1).max(100),
});

const interestsSchema = z.object({
  interestIds: z.array(z.number().int().positive()).max(10),
});

async function loadProfile(userId) {
  const rows = await query(
    `SELECT p.user_id AS id, p.display_name, p.short_bio, p.photo_url, p.intention, p.broad_area,
            TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) AS age
       FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?`, [userId]);
  if (!rows.length) return null;
  const interests = await query(
    `SELECT i.id, i.name FROM user_interests ui JOIN interests i ON i.id = ui.interest_id
      WHERE ui.user_id = ? ORDER BY i.name`, [userId]);
  return { ...rows[0], interests };
}

router.get('/interests', asyncHandler(async (_req, res) => {
  res.json({ interests: await query('SELECT id, name FROM interests ORDER BY name') });
}));

router.get('/profile', asyncHandler(async (req, res) => {
  const profile = await loadProfile(req.user.id);
  res.json({ profile }); // null until the user completes onboarding
}));

router.put('/profile', validate(profileSchema), asyncHandler(async (req, res) => {
  const { displayName, shortBio, photoUrl, intention, broadArea } = req.body;
  await query(
    `INSERT INTO profiles (user_id, display_name, short_bio, photo_url, intention, broad_area)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), short_bio = VALUES(short_bio),
       photo_url = VALUES(photo_url), intention = VALUES(intention), broad_area = VALUES(broad_area)`,
    [req.user.id, displayName, shortBio ?? null, photoUrl ?? null, intention, broadArea]);
  res.json({ profile: await loadProfile(req.user.id) });
}));

router.put('/profile/interests', validate(interestsSchema), asyncHandler(async (req, res) => {
  const ids = [...new Set(req.body.interestIds)];
  if (ids.length) {
    const found = await query('SELECT id FROM interests WHERE id IN (?)', [ids]);
    if (found.length !== ids.length) throw badRequest('One or more interests do not exist');
  }
  await transaction(async (conn) => {
    await conn.query('DELETE FROM user_interests WHERE user_id = ?', [req.user.id]);
    if (ids.length) {
      await conn.query('INSERT INTO user_interests (user_id, interest_id) VALUES ?',
        [ids.map((id) => [req.user.id, id])]);
    }
  });
  res.json({ profile: await loadProfile(req.user.id) });
}));

// ------------------------------------------------- discovery preferences
const prefSchema = z.object({
  broadArea: z.string().trim().min(1).max(100).nullable().optional(),
  minAge: z.number().int().min(18).max(99).optional(),
  maxAge: z.number().int().min(18).max(99).optional(),
  isPaused: z.boolean().optional(),
});

async function loadPrefs(userId) {
  const rows = await query(
    'SELECT broad_area, min_age, max_age, is_paused FROM discovery_preferences WHERE user_id = ?', [userId]);
  const r = rows[0];
  return { broadArea: r.broad_area, minAge: r.min_age, maxAge: r.max_age, isPaused: !!r.is_paused };
}

router.get('/preferences', asyncHandler(async (req, res) => {
  res.json({ preferences: await loadPrefs(req.user.id) });
}));

router.put('/preferences', validate(prefSchema), asyncHandler(async (req, res) => {
  const cur = await loadPrefs(req.user.id);
  const next = {
    broadArea: req.body.broadArea !== undefined ? req.body.broadArea : cur.broadArea,
    minAge: req.body.minAge ?? cur.minAge,
    maxAge: req.body.maxAge ?? cur.maxAge,
    isPaused: req.body.isPaused ?? cur.isPaused,
  };
  if (next.maxAge < next.minAge) throw badRequest('maxAge must be greater than or equal to minAge');
  await query(
    `UPDATE discovery_preferences SET broad_area = ?, min_age = ?, max_age = ?, is_paused = ? WHERE user_id = ?`,
    [next.broadArea, next.minAge, next.maxAge, next.isPaused ? 1 : 0, req.user.id]);
  res.json({ preferences: await loadPrefs(req.user.id) });
}));

module.exports = router;
