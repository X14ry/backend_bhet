// Loads FICTIONAL demo profiles for prototype testing (no real personal data).
// All demo accounts use the password:  Demo12345
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

const PASSWORD = 'Demo12345';
const AREA = 'Kathmandu Valley';

const users = [
  { email: 'admin@bhet.test', role: 'admin', dob: '1995-01-01', name: 'BHET Admin', intention: 'friendship', interests: [] },
  { email: 'mina@bhet.test',  dob: '2004-05-14', name: 'Mina',  intention: 'friendship', bio: 'New to the city, love trails.', interests: ['Hiking', 'Music'] },
  { email: 'sita@bhet.test',  dob: '2003-09-02', name: 'Sita',  intention: 'friendship', bio: 'Weekend hiker and coffee person.', interests: ['Hiking', 'Coffee', 'Books'] },
  { email: 'rohan@bhet.test', dob: '2002-11-21', name: 'Rohan', intention: 'friendship', bio: 'Guitar, football and momo.', interests: ['Music', 'Sport', 'Food'] },
  { email: 'aarav@bhet.test', dob: '1999-03-10', name: 'Aarav', intention: 'dating', bio: 'Engineer. Slow Sundays and good food.', interests: ['Food', 'Films', 'Cycling'] },
  { email: 'priya@bhet.test', dob: '1998-07-30', name: 'Priya', intention: 'dating', bio: 'Designer who likes books and travel.', interests: ['Books', 'Travel', 'Food'] },
  { email: 'kiran@bhet.test', dob: '1997-12-05', name: 'Kiran', intention: 'dating', bio: 'Photographer, always up for a walk.', interests: ['Photography', 'Hiking', 'Films'] },
];

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [interestRows] = await pool.query('SELECT id, name FROM interests');
  if (!interestRows.length) throw new Error('No interests found - run "npm run db:migrate" first');
  const interestId = Object.fromEntries(interestRows.map((r) => [r.name, r.id]));

  for (const u of users) {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [u.email]);
    if (existing.length) { console.log(`skip  ${u.email} (exists)`); continue; }

    const [r] = await pool.query(
      `INSERT INTO users (email, password_hash, date_of_birth, adult_confirmed_at, role)
       VALUES (?, ?, ?, NOW(), ?)`, [u.email, hash, u.dob, u.role || 'user']);
    const id = r.insertId;
    await pool.query('INSERT INTO discovery_preferences (user_id) VALUES (?)', [id]);
    await pool.query(
      `INSERT INTO profiles (user_id, display_name, short_bio, intention, broad_area) VALUES (?, ?, ?, ?, ?)`,
      [id, u.name, u.bio || null, u.intention, AREA]);
    const rows = u.interests.map((n) => [id, interestId[n]]).filter((x) => x[1]);
    if (rows.length) await pool.query('INSERT INTO user_interests (user_id, interest_id) VALUES ?', [rows]);
    console.log(`added ${u.email}`);
  }
  console.log(`\nDemo accounts ready. Password for all: ${PASSWORD}`);
}

main().catch((e) => { console.error('Seed failed:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
