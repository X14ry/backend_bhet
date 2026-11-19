const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { query, transaction } = require('../db');
const validate = require('../middleware/validate');
const { authenticate, signToken } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, unauthorized, forbidden, conflict } = require('../utils/httpError');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Invalid date');

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(72)
    .regex(/[A-Za-z]/, 'Password needs a letter')
    .regex(/\d/, 'Password needs a number'),
  dateOfBirth: isoDate,
  confirmAdult: z.literal(true, { errorMap: () => ({ message: 'You must confirm you are 18 or over' }) }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

function ageFromDob(dob) {
  const d = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

router.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, dateOfBirth } = req.body;
  if (ageFromDob(dateOfBirth) < 18) throw forbidden('BHET is for adults aged 18 and over');

  const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) throw conflict('An account with this email already exists');

  const hash = await bcrypt.hash(password, 12);
  const userId = await transaction(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO users (email, password_hash, date_of_birth, adult_confirmed_at) VALUES (?, ?, ?, NOW())',
      [email, hash, dateOfBirth]);
    await conn.query('INSERT INTO discovery_preferences (user_id) VALUES (?)', [r.insertId]);
    return r.insertId;
  });

  res.status(201).json({ token: signToken(userId), user: { id: userId, email } });
}));

router.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const rows = await query('SELECT id, email, password_hash, status FROM users WHERE email = ?', [email]);
  // same message for unknown email / wrong password (no account enumeration)
  const ok = rows.length && await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) throw unauthorized('Incorrect email or password');
  if (rows[0].status !== 'active') throw forbidden('Account is suspended');
  res.json({ token: signToken(rows[0].id), user: { id: rows[0].id, email: rows[0].email } });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.email, u.role, u.created_at,
            TIMESTAMPDIFF(YEAR, u.date_of_birth, CURDATE()) AS age,
            p.display_name, p.intention, p.broad_area,
            (p.user_id IS NOT NULL) AS has_profile
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`, [req.user.id]);
  res.json({ user: { ...rows[0], has_profile: !!rows[0].has_profile } });
}));

// Permanent account + data deletion (as flagged in the report's data-deletion note)
router.delete('/account', authenticate, validate(z.object({ password: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(req.body.password, rows[0].password_hash))) {
      throw badRequest('Password is incorrect');
    }
    await query('DELETE FROM users WHERE id = ?', [req.user.id]); // cascades
    res.status(204).end();
  }));

module.exports = router;
