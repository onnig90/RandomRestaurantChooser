const fetch = require('node-fetch');

const USER_AGENT =
  'RandomRestaurantChooser/1.0 (+https://github.com/xandersbackyard/RandomRestaurantChooser)';
const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com/v1';
const GOOGLE_GEOCODING_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const GOOGLE_ROUTES_BASE_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const GOOGLE_ADDRESS_VALIDATION_BASE_URL =
  'https://addressvalidation.googleapis.com/v1:validateAddress';

function getServerApiKey() {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    null
  );
}

function getBrowserApiKey() {
  return process.env.GOOGLE_MAPS_BROWSER_API_KEY || null;
}

function hasServerApiKey() {
  return Boolean(getServerApiKey());
}

function normalizePlaceId(value) {
  return String(value || '')
    .trim()
    .replace(/^places\//, '');
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        (payload && payload.error && payload.error.message) ||
          payload.error_message ||
          `Google API request failed with status ${response.status}`
      );
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutErr = new Error('Google API request timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoogleJson(url, { method = 'GET', fieldMask, body, timeoutMs = 4000 } = {}) {
  const apiKey = getServerApiKey();
  if (!apiKey) {
    const err = new Error('Google Maps server API key is not configured');
    err.status = 500;
    throw err;
  }

  const headers = {
    'User-Agent': USER_AGENT,
    'X-Goog-Api-Key': apiKey,
  };

  if (fieldMask) {
    headers['X-Goog-FieldMask'] = fieldMask;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetchJsonWithTimeout(
    url,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    timeoutMs
  );
}

function parseGeocodeLocation(result) {
  if (!result || !result.geometry || !result.geometry.location) {
    return null;
  }

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    displayName: result.formatted_address || null,
    placeId: result.place_id || null,
    types: Array.isArray(result.types) ? result.types : [],
  };
}

async function geocodeAddress(query) {
  const apiKey = getServerApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    address: query,
    key: apiKey,
  });

  const data = await fetchJsonWithTimeout(
    `${GOOGLE_GEOCODING_BASE_URL}?${params.toString()}`,
    {
      headers: {
        'User-Agent': USER_AGENT,
      },
    },
    3500
  );

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const err = new Error(data.error_message || `Geocoding error: ${data.status}`);
    err.status = 502;
    throw err;
  }

  return parseGeocodeLocation(data.results && data.results[0]);
}

async function reverseGeocode(lat, lng) {
  const apiKey = getServerApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: apiKey,
  });

  const data = await fetchJsonWithTimeout(
    `${GOOGLE_GEOCODING_BASE_URL}?${params.toString()}`,
    {
      headers: {
        'User-Agent': USER_AGENT,
      },
    },
    3500
  );

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const err = new Error(data.error_message || `Reverse geocoding error: ${data.status}`);
    err.status = 502;
    throw err;
  }

  return parseGeocodeLocation(data.results && data.results[0]);
}

async function geocodePlaceId(placeId) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) return null;

  const apiKey = getServerApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    place_id: normalizedPlaceId,
    key: apiKey,
  });

  const data = await fetchJsonWithTimeout(
    `${GOOGLE_GEOCODING_BASE_URL}?${params.toString()}`,
    {
      headers: {
        'User-Agent': USER_AGENT,
      },
    },
    3500
  );

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const err = new Error(data.error_message || `Place geocoding error: ${data.status}`);
    err.status = 502;
    throw err;
  }

  return parseGeocodeLocation(data.results && data.results[0]);
}

async function validateAddress(address) {
  if (!address || !hasServerApiKey()) return null;

  const data = await fetchGoogleJson(GOOGLE_ADDRESS_VALIDATION_BASE_URL, {
    method: 'POST',
    body: {
      address: {
        addressLines: [address],
      },
    },
    timeoutMs: 3500,
  });

  const result = data.result || {};
  const verdict = result.verdict || {};
  const geocode = result.geocode || {};
  const location = geocode.location
    ? {
        lat: geocode.location.latitude,
        lng: geocode.location.longitude,
      }
    : null;

  return {
    formattedAddress: result.address && result.address.formattedAddress
      ? result.address.formattedAddress
      : null,
    placeId: geocode.placeId ? normalizePlaceId(geocode.placeId) : null,
    location,
    addressComplete: verdict.addressComplete !== false,
    hasUnconfirmedComponents: Boolean(verdict.hasUnconfirmedComponents),
    hasInferredComponents: Boolean(verdict.hasInferredComponents),
    inputGranularity: verdict.inputGranularity || null,
    validationGranularity: verdict.validationGranularity || null,
    geocodeGranularity: verdict.geocodeGranularity || null,
  };
}

async function autocompletePlaces(query, options = {}) {
  if (!query || !hasServerApiKey()) return [];

  const body = {
    input: query,
    includeQueryPredictions: false,
  };

  if (options.origin && Number.isFinite(options.origin.lat) && Number.isFinite(options.origin.lng)) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.origin.lat,
          longitude: options.origin.lng,
        },
        radius: 50000,
      },
    };
  }

  const data = await fetchGoogleJson(`${GOOGLE_PLACES_BASE_URL}/places:autocomplete`, {
    method: 'POST',
    fieldMask: [
      'suggestions.placePrediction.place',
      'suggestions.placePrediction.placeId',
      'suggestions.placePrediction.text.text',
      'suggestions.placePrediction.structuredFormat.mainText.text',
      'suggestions.placePrediction.structuredFormat.secondaryText.text',
    ].join(','),
    body,
    timeoutMs: 2500,
  });

  return (data.suggestions || [])
    .map((suggestion) => suggestion.placePrediction)
    .filter(Boolean)
    .map((prediction) => ({
      placeId: normalizePlaceId(prediction.placeId || prediction.place),
      primaryText:
        prediction.structuredFormat &&
        prediction.structuredFormat.mainText &&
        prediction.structuredFormat.mainText.text
          ? prediction.structuredFormat.mainText.text
          : prediction.text && prediction.text.text
            ? prediction.text.text
            : '',
      secondaryText:
        prediction.structuredFormat &&
        prediction.structuredFormat.secondaryText &&
        prediction.structuredFormat.secondaryText.text
          ? prediction.structuredFormat.secondaryText.text
          : '',
      fullText: prediction.text && prediction.text.text ? prediction.text.text : '',
    }))
    .filter((prediction) => prediction.placeId && prediction.primaryText);
}

async function searchNearbyRestaurants(location, options = {}) {
  const radius = Math.max(1, Math.min(options.radius || 5000, 50000));
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.priceLevel',
    'places.currentOpeningHours',
    'places.businessStatus',
    'places.types',
    'places.googleMapsUri',
    'nextPageToken',
  ].join(',');

  const allPlaces = [];
  let pageToken = null;
  const maxPages = 3;

  for (let page = 0; page < maxPages; page++) {
    const body = {
      textQuery: 'restaurant',
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationBias: {
        circle: {
          center: {
            latitude: location.lat,
            longitude: location.lng,
          },
          radius,
        },
      },
    };

    if (options.primaryType) {
      body.includedType = options.primaryType;
    }

    if (pageToken) {
      body.pageToken = pageToken;
    }

    const data = await fetchGoogleJson(`${GOOGLE_PLACES_BASE_URL}/places:searchText`, {
      method: 'POST',
      fieldMask,
      body,
      timeoutMs: 3000,
    });

    const places = data.places || [];
    allPlaces.push(...places);
    pageToken = data.nextPageToken || null;

    // No more pages, or first page wasn't full (no point paginating)
    if (!pageToken || places.length < 20) break;
  }

  return allPlaces;
}

async function getPlaceDetails(placeId) {
  const normalizedPlaceId = normalizePlaceId(placeId);
  if (!normalizedPlaceId) return null;

  const data = await fetchGoogleJson(`${GOOGLE_PLACES_BASE_URL}/places/${normalizedPlaceId}`, {
    fieldMask: [
      'id',
      'displayName',
      'formattedAddress',
      'location',
      'rating',
      'priceLevel',
      'currentOpeningHours',
      'businessStatus',
      'internationalPhoneNumber',
      'websiteUri',
      'googleMapsUri',
      'photos',
    ].join(','),
    timeoutMs: 3500,
  });

  return data || null;
}

async function getPlacePhotoUrl(photoName) {
  if (!photoName) return null;

  const normalizedName = String(photoName).replace(/^\//, '');
  const data = await fetchGoogleJson(
    `${GOOGLE_PLACES_BASE_URL}/${normalizedName}/media?maxWidthPx=800&skipHttpRedirect=true`,
    {
      timeoutMs: 3500,
    }
  );

  return data.photoUri || null;
}

function parseDurationSeconds(value) {
  if (!value) return null;
  const parsed = parseFloat(String(value).replace(/s$/, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function computeRoute({ origin, destination, travelMode = 'DRIVE' }) {
  const data = await fetchGoogleJson(GOOGLE_ROUTES_BASE_URL, {
    method: 'POST',
    fieldMask: [
      'routes.distanceMeters',
      'routes.duration',
      'routes.polyline.geoJsonLinestring',
      'routes.viewport',
    ].join(','),
    body: {
      origin: {
        location: {
          latLng: {
            latitude: origin.lat,
            longitude: origin.lng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.lat,
            longitude: destination.lng,
          },
        },
      },
      travelMode,
      routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'GEO_JSON_LINESTRING',
    },
    timeoutMs: 4500,
  });

  const route = data.routes && data.routes[0];
  if (!route) return null;

  const coordinates =
    route.polyline &&
    route.polyline.geoJsonLinestring &&
    Array.isArray(route.polyline.geoJsonLinestring.coordinates)
      ? route.polyline.geoJsonLinestring.coordinates.map((point) => ({
          lng: point[0],
          lat: point[1],
        }))
      : [];

  return {
    distanceMeters: route.distanceMeters || null,
    durationSeconds: parseDurationSeconds(route.duration),
    polyline: coordinates,
    viewport: route.viewport || null,
  };
}

const GOOGLE_DISTANCE_MATRIX_BASE_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

async function getDistanceMatrix(origin, destinations, mode = 'driving') {
  if (!destinations || destinations.length === 0) return [];

  const apiKey = getServerApiKey();
  if (!apiKey) return destinations.map(() => null);

  const BATCH_SIZE = 25;
  const results = [];

  for (let i = 0; i < destinations.length; i += BATCH_SIZE) {
    const batch = destinations.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams({
      origins: `${origin.lat},${origin.lng}`,
      destinations: batch.map((d) => `${d.lat},${d.lng}`).join('|'),
      mode,
      key: apiKey,
    });

    let data;
    try {
      data = await fetchJsonWithTimeout(
        `${GOOGLE_DISTANCE_MATRIX_BASE_URL}?${params.toString()}`,
        { headers: { 'User-Agent': USER_AGENT } },
        5000
      );
    } catch (err) {
      results.push(...batch.map(() => null));
      continue;
    }

    if (data.status !== 'OK') {
      results.push(...batch.map(() => null));
      continue;
    }

    const row = data.rows && data.rows[0];
    if (!row) {
      results.push(...batch.map(() => null));
      continue;
    }

    (row.elements || []).forEach((el) => {
      results.push(el.status === 'OK' && el.distance ? el.distance.value : null);
    });
  }

  return results;
}

module.exports = {
  autocompletePlaces,
  computeRoute,
  geocodeAddress,
  geocodePlaceId,
  getBrowserApiKey,
  getDistanceMatrix,
  getPlaceDetails,
  getPlacePhotoUrl,
  getServerApiKey,
  hasServerApiKey,
  normalizePlaceId,
  reverseGeocode,
  searchNearbyRestaurants,
  validateAddress,
};
