const db = require('../../lib/db');
const { hashPassword, signToken } = require('../../lib/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email, password, phone, location } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 120) {
      return res.status(400).json({ error: 'name is required (1–120 characters)' });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    if (phone && !PHONE_RE.test(phone)) {
      return res.status(400).json({ error: 'phone must be in E.164 format (e.g. +12125551234)' });
    }

    const existing = await db.query('SELECT id_user FROM "user" WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const password_hash = await hashPassword(password);

    const result = await db.query(
      `INSERT INTO "user" (name, email, phone, location, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_user, name, email, phone, location`,
      [name.trim(), email.toLowerCase(), phone || null, location || null, password_hash]
    );

    const user = result.rows[0];
    const token = signToken({ id_user: user.id_user, email: user.email });

    return res.status(201).json({ token, user });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
