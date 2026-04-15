const { computeRoute, geocodePlaceId, normalizePlaceId } = require('../../lib/googleMaps');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const originLat = parseFloat(req.query.originLat);
    const originLng = parseFloat(req.query.originLng);
    const travelMode = req.query && req.query.travelMode ? String(req.query.travelMode).toUpperCase() : 'DRIVE';
    const placeId = req.query && req.query.placeId ? normalizePlaceId(req.query.placeId) : '';
    const destinationLat =
      req.query && req.query.destinationLat !== undefined
        ? parseFloat(req.query.destinationLat)
        : null;
    const destinationLng =
      req.query && req.query.destinationLng !== undefined
        ? parseFloat(req.query.destinationLng)
        : null;

    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return res.status(400).json({ error: 'originLat and originLng are required' });
    }

    let destination = null;
    if (placeId) {
      try {
        destination = await geocodePlaceId(placeId);
      } catch (err) {
        console.warn('Route destination place lookup failed:', err.message);
      }
    }

    if (!destination && Number.isFinite(destinationLat) && Number.isFinite(destinationLng)) {
      destination = {
        lat: destinationLat,
        lng: destinationLng,
      };
    }

    if (!destination) {
      return res.status(400).json({ error: 'placeId or destinationLat/destinationLng is required' });
    }

    const route = await computeRoute({
      origin: { lat: originLat, lng: originLng },
      destination,
      travelMode,
    });

    return res.status(200).json({
      route,
    });
  } catch (err) {
    console.error('restaurants/route error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
