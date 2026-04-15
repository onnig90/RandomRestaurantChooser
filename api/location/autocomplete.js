const { autocompletePlaces } = require('../../lib/googleMaps');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const query = req.query && req.query.q ? String(req.query.q).trim() : '';
    if (!query) {
      return res.status(200).json({ predictions: [] });
    }

    const lat = req.query && req.query.lat !== undefined ? parseFloat(req.query.lat) : null;
    const lng = req.query && req.query.lng !== undefined ? parseFloat(req.query.lng) : null;
    const origin =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null;

    const predictions = await autocompletePlaces(query, { origin });
    return res.status(200).json({ predictions });
  } catch (err) {
    console.error('location/autocomplete error:', err);
    return res.status(200).json({
      predictions: [],
      error: err.message || 'Autocomplete unavailable',
    });
  }
};
