const fetch = require('node-fetch');
const {
  geocodeAddress: geocodeGoogleAddress,
  geocodePlaceId,
  reverseGeocode: reverseGoogleGeocode,
  validateAddress,
} = require('../../lib/googleMaps');

const USER_AGENT =
  'RandomRestaurantChooser/1.0 (+https://github.com/xandersbackyard/RandomRestaurantChooser)';
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';

async function geocodeFallbackAddress(query) {
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
    placeId: null,
  };
}

async function reverseFallbackGeocode(lat, lng) {
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
    placeId: null,
  };
}

async function resolveAddressInput({ q, placeId }) {
  let validation = null;

  if (placeId) {
    try {
      const location = await geocodePlaceId(placeId);
      if (location) {
        return {
          location,
          validation: null,
          source: 'google',
        };
      }
    } catch (err) {
      console.warn('placeId geocode failed:', err.message);
    }
  }

  if (!q) {
    return { location: null, validation: null, source: null };
  }

  try {
    validation = await validateAddress(q);
  } catch (err) {
    console.warn('Address validation failed:', err.message);
  }

  try {
    const location = await geocodeGoogleAddress(q);
    if (location) {
      if (validation && validation.formattedAddress) {
        location.displayName = validation.formattedAddress;
      }

      if (validation && validation.placeId && !location.placeId) {
        location.placeId = validation.placeId;
      }

      return {
        location,
        validation,
        source: 'google',
      };
    }
  } catch (err) {
    console.warn('Google geocoding failed:', err.message);
  }

  if (validation && validation.location) {
    return {
      location: {
        lat: validation.location.lat,
        lng: validation.location.lng,
        displayName: validation.formattedAddress || q,
        placeId: validation.placeId || null,
      },
      validation,
      source: 'google',
    };
  }

  const fallbackLocation = await geocodeFallbackAddress(q);
  return {
    location: fallbackLocation,
    validation,
    source: 'fallback',
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { q, lat, lng, placeId } = req.query || {};

    if (q && String(q).trim()) {
      const resolved = await resolveAddressInput({
        q: String(q).trim(),
        placeId: placeId ? String(placeId).trim() : null,
      });

      if (!resolved.location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      return res.status(200).json({
        location: resolved.location,
        validation:
          resolved.validation && resolved.validation.formattedAddress
            ? {
                suggestedAddress: resolved.validation.formattedAddress,
                addressComplete: resolved.validation.addressComplete,
                hasSuggestion:
                  resolved.validation.formattedAddress.toLowerCase() !== String(q).trim().toLowerCase(),
              }
            : null,
        source: resolved.source,
      });
    }

    if (placeId && String(placeId).trim()) {
      const resolved = await resolveAddressInput({
        q: null,
        placeId: String(placeId).trim(),
      });

      if (!resolved.location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      return res.status(200).json({
        location: resolved.location,
        validation: null,
        source: resolved.source,
      });
    }

    if (lat !== undefined && lng !== undefined) {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);

      if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
        return res.status(400).json({ error: 'lat and lng must be valid numbers' });
      }

      try {
        const location = await reverseGoogleGeocode(parsedLat, parsedLng);
        if (location) {
          return res.status(200).json({
            location,
            validation: null,
            source: 'google',
          });
        }
      } catch (err) {
        console.warn('Google reverse geocoding failed:', err.message);
      }

      const fallbackLocation = await reverseFallbackGeocode(parsedLat, parsedLng);
      return res.status(200).json({
        location: fallbackLocation,
        validation: null,
        source: 'fallback',
      });
    }

    return res.status(400).json({
      error: 'Provide q, placeId, or lat/lng for geocoding',
    });
  } catch (err) {
    console.error('location/geocode error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
