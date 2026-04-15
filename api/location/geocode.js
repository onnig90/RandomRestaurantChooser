const fetch = require('node-fetch');

const USER_AGENT =
  'RandomRestaurantChooser/1.0 (+https://github.com/xandersbackyard/RandomRestaurantChooser)';
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';

async function geocodeAddress(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
  });

  const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    const err = new Error('Address lookup failed');
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const match = data && data[0];

  if (!match) {
    return null;
  }

  return {
    lat: parseFloat(match.lat),
    lng: parseFloat(match.lon),
    displayName: match.display_name,
  };
}

async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    zoom: '18',
  });

  const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    const err = new Error('Reverse geocoding failed');
    err.status = 502;
    throw err;
  }

  const data = await response.json();

  return {
    lat: parseFloat(data.lat),
    lng: parseFloat(data.lon),
    displayName: data.display_name || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { q, lat, lng } = req.query || {};

    if (q && String(q).trim()) {
      const location = await geocodeAddress(String(q).trim());

      if (!location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      return res.status(200).json({ location });
    }

    if (lat !== undefined && lng !== undefined) {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);

      if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
        return res.status(400).json({ error: 'lat and lng must be valid numbers' });
      }

      const location = await reverseGeocode(parsedLat, parsedLng);
      return res.status(200).json({ location });
    }

    return res
      .status(400)
      .json({ error: 'Provide either q for address lookup or lat/lng for reverse geocoding' });
  } catch (err) {
    console.error('location/geocode error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
