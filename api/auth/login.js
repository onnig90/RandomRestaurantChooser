const db = require('../../lib/db');
const { verifyPassword, signToken } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const result = await db.query(
      'SELECT id_user, name, email, phone, location, password_hash FROM "user" WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ id_user: user.id_user, email: user.email });
    const { password_hash, ...safeUser } = user;

    return res.status(200).json({ token, user: safeUser });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
