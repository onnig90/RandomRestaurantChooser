const db = require('./db');

class RestaurantFilter {
  constructor({ cuisine, priceRange, minRating, maxDistance, openHours } = {}) {
    this.cuisine = cuisine || null;
    this.priceRange = priceRange || null;
    this.minRating = minRating ? parseFloat(minRating) : null;
    this.maxDistance = maxDistance ? parseInt(maxDistance, 10) : 5000;
    this.openHours = openHours || null;
  }

  static fromRequest(params) {
    return new RestaurantFilter({
      cuisine: params.cuisine,
      priceRange: params.priceRange,
      minRating: params.minRating,
      maxDistance: params.maxDistance,
      openHours: params.openNow === 'true' ? 'now' : params.openHours,
    });
  }

  async LoadFilter(id_filter, id_user) {
    const result = await db.query(
      `SELECT f.cuisine, f.price_range, f.min_rating, f.max_distance, f.open_hours
       FROM filter f
       JOIN user_filter uf ON uf.id_filter = f.id_filter
       WHERE uf.id_user = $1 AND f.id_filter = $2`,
      [id_user, id_filter]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return new RestaurantFilter({
      cuisine: row.cuisine,
      priceRange: row.price_range,
      minRating: row.min_rating,
      maxDistance: row.max_distance,
      openHours: row.open_hours,
    });
  }
}

module.exports = RestaurantFilter;
