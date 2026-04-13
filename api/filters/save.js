const db = require('../../lib/db');
const { requireAuth } = require('../../lib/middleware');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id_user } = requireAuth(req);
    const { cuisine, priceRange, minRating, maxDistance, openHours, label, isDefault } = req.body || {};

    if (minRating !== undefined && (isNaN(parseFloat(minRating)) || minRating < 0 || minRating > 5)) {
      return res.status(400).json({ error: 'minRating must be between 0 and 5' });
    }

    const filterResult = await db.query(
      `INSERT INTO filter (cuisine, price_range, min_rating, max_distance, open_hours)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        cuisine || null,
        priceRange || null,
        minRating !== undefined ? parseFloat(minRating) : null,
        maxDistance ? parseInt(maxDistance, 10) : null,
        openHours || null,
      ]
    );

    const filter = filterResult.rows[0];

    if (isDefault) {
      await db.query(
        `UPDATE user_filter SET is_default = FALSE WHERE id_user = $1`,
        [id_user]
      );
    }

    await db.query(
      `INSERT INTO user_filter (id_user, id_filter, label, is_default)
       VALUES ($1, $2, $3, $4)`,
      [id_user, filter.id_filter, label || null, isDefault ? true : false]
    );

    return res.status(201).json({ filter });
  } catch (err) {
    console.error('filters/save error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
