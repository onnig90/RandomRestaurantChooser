const db = require('../../lib/db');
const { requireAuth } = require('../../lib/middleware');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id_user } = requireAuth(req);

    const result = await db.query(
      `SELECT f.id_filter, f.cuisine, f.price_range, f.min_rating, f.max_distance,
              f.open_hours, uf.label, uf.is_default, uf.created_at
       FROM filter f
       JOIN user_filter uf ON uf.id_filter = f.id_filter
       WHERE uf.id_user = $1
       ORDER BY uf.is_default DESC, uf.created_at DESC`,
      [id_user]
    );

    return res.status(200).json({ filters: result.rows });
  } catch (err) {
    console.error('filters/index error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
