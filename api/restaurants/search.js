const RestaurantDAO = require('../../lib/googlePlaces');
const RestaurantFilter = require('../../lib/restaurantFilter');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng query parameters are required' });
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      return res.status(400).json({ error: 'lat and lng must be valid numbers' });
    }

    const filter = RestaurantFilter.fromRequest(req.query);
    const dao = new RestaurantDAO();
    const restaurants = await dao.GetRestaurants({ lat: parsedLat, lng: parsedLng }, filter);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ restaurants });
  } catch (err) {
    console.error('restaurants/search error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
