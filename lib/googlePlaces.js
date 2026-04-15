const fetch = require('node-fetch');
const OpeningHours = require('opening_hours');

const USER_AGENT =
  'RandomRestaurantChooser/1.0 (+https://github.com/xandersbackyard/RandomRestaurantChooser)';
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE = new Map();
const GOOGLE_PLACES_V1_BASE_URL = 'https://places.googleapis.com/v1';
const GOOGLE_PLACES_V1_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.priceLevel',
  'places.currentOpeningHours',
  'places.businessStatus',
  'places.types',
].join(',');
const GOOGLE_CUISINE_TYPE_MAP = {
  pizza: 'pizza_restaurant',
  sushi: 'sushi_restaurant',
  mexican: 'mexican_restaurant',
  burgers: 'hamburger_restaurant',
  thai: 'thai_restaurant',
  italian: 'italian_restaurant',
  chinese: 'chinese_restaurant',
};

let googleFailureCooldownUntil = 0;

function getCachedEntry(cacheKey) {
  const entry = SEARCH_CACHE.get(cacheKey);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > SEARCH_CACHE_TTL_MS) {
    SEARCH_CACHE.delete(cacheKey);
    return null;
  }

  return entry;
}

function setCachedEntry(cacheKey, restaurants) {
  SEARCH_CACHE.set(cacheKey, {
    cachedAt: Date.now(),
    restaurants,
  });
}

function createCacheKey(location, filter) {
  return JSON.stringify({
    lat: Number(location.lat).toFixed(4),
    lng: Number(location.lng).toFixed(4),
    cuisine: filter.cuisine || null,
    minPrice: filter.minPrice,
    maxPrice: filter.maxPrice,
    minRating: filter.minRating,
    maxDistance: filter.maxDistance || 5000,
    openHours: filter.openHours || null,
  });
}

function normalizeCuisine(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
}

function mapGooglePriceLevel(value) {
  switch (value) {
    case 'PRICE_LEVEL_FREE':
      return 0;
    case 'PRICE_LEVEL_INEXPENSIVE':
      return 1;
    case 'PRICE_LEVEL_MODERATE':
      return 2;
    case 'PRICE_LEVEL_EXPENSIVE':
      return 3;
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return 4;
    default:
      return null;
  }
}

function normalizeRestaurantName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(restaurant|resto|grill|kitchen|cafe|café|bar)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineDistanceMeters(origin, destination) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(destination.lat - origin.lat);
  const deltaLng = toRadians(destination.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function matchesCuisine(restaurant, cuisineFilter) {
  if (!cuisineFilter) return true;

  const normalizedNeedle = normalizeCuisine(cuisineFilter);
  const candidates = [
    restaurant.name,
    restaurant.primaryType,
    ...(restaurant.cuisines || []),
  ]
    .map(normalizeCuisine)
    .filter(Boolean);

  return candidates.some((candidate) => candidate.includes(normalizedNeedle));
}

function parsePriceLevel(tags) {
  const raw = tags && tags['price:range'];
  if (!raw) return null;

  const matches = String(raw).match(/\$/g);
  if (matches && matches.length > 0) {
    return Math.min(matches.length, 4);
  }

  const numeric = parseInt(raw, 10);
  if (!Number.isNaN(numeric)) {
    return Math.max(1, Math.min(numeric, 4));
  }

  return null;
}

function formatAddress(tags) {
  if (!tags) return 'Address unavailable';
  if (tags['addr:full']) return tags['addr:full'];

  const streetParts = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean);
  const localityParts = [tags['addr:city'], tags['addr:postcode'], tags['addr:country']].filter(Boolean);
  const parts = [];

  if (streetParts.length > 0) parts.push(streetParts.join(' '));
  if (localityParts.length > 0) parts.push(localityParts.join(', '));
  if (parts.length > 0) return parts.join(', ');

  return tags.name || 'Address unavailable';
}

function osmElementToRestaurant(element) {
  const tags = element.tags || {};
  const lat = element.lat !== undefined ? element.lat : element.center && element.center.lat;
  const lng = element.lon !== undefined ? element.lon : element.center && element.center.lon;

  if (!tags.name || lat === undefined || lng === undefined) {
    return null;
  }

  return {
    name: tags.name,
    address: formatAddress(tags),
    rating: null,
    priceLevel: parsePriceLevel(tags),
    openHours: getOsmOpenState(tags),
    place_id: `osm:${element.type}:${element.id}`,
    lat,
    lng,
    permanentlyClosed: isOsmPermanentlyClosed(tags),
    chainKey: normalizeRestaurantName(tags.brand || tags.name),
    primaryType: tags.amenity || null,
    cuisines: String(tags.cuisine || '')
      .split(/[;,]/)
      .map(normalizeCuisine)
      .filter(Boolean),
  };
}

function isOsmPermanentlyClosed(tags) {
  if (!tags) return false;

  const closedFlags = [
    'disused',
    'abandoned',
    'demolished',
    'construction',
    'closed',
    'was:amenity',
    'disused:amenity',
    'abandoned:amenity',
  ];

  if (closedFlags.some((key) => key in tags)) {
    return true;
  }

  const openingHours = String(tags.opening_hours || '').trim().toLowerCase();
  if (openingHours === 'closed' || openingHours === 'off') {
    return true;
  }

  if (String(tags.shop || '').trim().toLowerCase() === 'vacant') {
    return true;
  }

  return false;
}

function getOsmOpenState(tags) {
  if (!tags || isOsmPermanentlyClosed(tags)) {
    return false;
  }

  const rawOpeningHours = String(tags.opening_hours || '').trim();
  if (!rawOpeningHours) {
    return null;
  }

  try {
    const schedule = new OpeningHours(rawOpeningHours);
    return schedule.getState(new Date());
  } catch (err) {
    return null;
  }
}

function shouldCooldownGoogle(err) {
  const message = String((err && err.message) || '').toLowerCase();
  return (
    err.status === 401 ||
    err.status === 403 ||
    message.includes('permission_denied') ||
    message.includes('request_denied') ||
    message.includes('api key') ||
    message.includes('billing') ||
    message.includes('not authorized') ||
    message.includes('not enabled')
  );
}

function finalizeRestaurants(location, restaurants, filter) {
  const exactMaxDistance = filter.maxDistance || 5000;

  let normalized = restaurants
    .filter(Boolean)
    .filter((restaurant) => !restaurant.permanentlyClosed)
    .map((restaurant) => ({
      ...restaurant,
      distanceMeters: Math.round(haversineDistanceMeters(location, restaurant)),
    }))
    .filter((restaurant) => Number.isFinite(restaurant.distanceMeters))
    .filter((restaurant) => restaurant.distanceMeters <= exactMaxDistance);

  if (filter.cuisine) {
    const cuisineFiltered = normalized.filter((restaurant) =>
      matchesCuisine(restaurant, filter.cuisine)
    );

    if (cuisineFiltered.length > 0) {
      normalized = cuisineFiltered;
    }
  }

  if (filter.openHours === 'now') {
    normalized = normalized.filter((restaurant) => restaurant.openHours !== false);
  }

  if (filter.minPrice !== null) {
    normalized = normalized.filter(
      (restaurant) => restaurant.priceLevel === null || restaurant.priceLevel >= filter.minPrice
    );
  }

  if (filter.maxPrice !== null) {
    normalized = normalized.filter(
      (restaurant) => restaurant.priceLevel === null || restaurant.priceLevel <= filter.maxPrice
    );
  }

  if (filter.minRating) {
    normalized = normalized.filter(
      (restaurant) => restaurant.rating !== null && restaurant.rating >= filter.minRating
    );
  }

  normalized.sort((left, right) => {
    if (left.distanceMeters !== right.distanceMeters) {
      return left.distanceMeters - right.distanceMeters;
    }

    const leftOpenWeight = left.openHours === true ? 2 : left.openHours === null ? 1 : 0;
    const rightOpenWeight = right.openHours === true ? 2 : right.openHours === null ? 1 : 0;

    if (leftOpenWeight !== rightOpenWeight) {
      return rightOpenWeight - leftOpenWeight;
    }

    const leftRating = left.rating === null ? -1 : left.rating;
    const rightRating = right.rating === null ? -1 : right.rating;

    if (leftRating !== rightRating) {
      return rightRating - leftRating;
    }

    return left.name.localeCompare(right.name);
  });

  const duplicateCounts = new Map();
  normalized.forEach((restaurant) => {
    const chainKey = restaurant.chainKey || normalizeRestaurantName(restaurant.name);
    duplicateCounts.set(chainKey, (duplicateCounts.get(chainKey) || 0) + 1);
  });

  const seenChains = new Set();
  return normalized.filter((restaurant) => {
    const chainKey = restaurant.chainKey || normalizeRestaurantName(restaurant.name);
    const duplicateCount = duplicateCounts.get(chainKey) || 0;

    if (duplicateCount <= 1) {
      return true;
    }

    if (seenChains.has(chainKey)) {
      return false;
    }

    seenChains.add(chainKey);
    return true;
  });
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutError = new Error('Search provider timed out');
      timeoutError.code = 'PROVIDER_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

class RestaurantDAO {
  constructor() {
    this.legacyApiBaseUrl =
      process.env.GOOGLE_PLACES_BASE_URL || 'https://maps.googleapis.com/maps/api/place';
    this.v1ApiBaseUrl = process.env.GOOGLE_PLACES_V1_BASE_URL || GOOGLE_PLACES_V1_BASE_URL;
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY || null;
    this.overpassEndpoints = [
      process.env.OVERPASS_BASE_URL,
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
    ].filter(Boolean);
  }

  async GetRestaurants(location, filter) {
    const cacheKey = createCacheKey(location, filter);
    const cachedEntry = getCachedEntry(cacheKey);
    if (cachedEntry) {
      return cachedEntry.restaurants;
    }

    try {
      if (this.apiKey && Date.now() >= googleFailureCooldownUntil) {
        const restaurants = await this.getRestaurantsFromGoogle(location, filter);
        setCachedEntry(cacheKey, restaurants);
        return restaurants;
      }
    } catch (err) {
      if (shouldCooldownGoogle(err)) {
        googleFailureCooldownUntil = Date.now() + 15 * 60 * 1000;
      }

      console.warn('Google Places failed, falling back to OpenStreetMap search:', err.message);
    }

    try {
      const restaurants = await this.getRestaurantsFromOpenStreetMap(location, filter);
      setCachedEntry(cacheKey, restaurants);
      return restaurants;
    } catch (err) {
      if (cachedEntry) {
        console.warn('Restaurant search failed, serving cached results:', err.message);
        return cachedEntry.restaurants;
      }

      throw err;
    }
  }

  async getRestaurantsFromGoogle(location, filter) {
    const googleErrors = [];

    try {
      return await this.getRestaurantsFromGoogleV1(location, filter);
    } catch (err) {
      googleErrors.push(err);
    }

    try {
      return await this.getRestaurantsFromGoogleLegacy(location, filter);
    } catch (err) {
      googleErrors.push(err);
    }

    const message = googleErrors.map((err) => err.message).filter(Boolean).join(' | ');
    const wrappedError = new Error(message || 'Google Places request failed');
    wrappedError.status = googleErrors[googleErrors.length - 1]
      ? googleErrors[googleErrors.length - 1].status || 502
      : 502;
    throw wrappedError;
  }

  async getRestaurantsFromGoogleV1(location, filter) {
    const { lat, lng } = location;
    const cuisineType = GOOGLE_CUISINE_TYPE_MAP[filter.cuisine] || 'restaurant';
    const url = `${this.v1ApiBaseUrl}/places:searchNearby`;
    const response = await fetchJsonWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': GOOGLE_PLACES_V1_FIELD_MASK,
        },
        body: JSON.stringify({
          includedTypes: [cuisineType],
          maxResultCount: 20,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: {
                latitude: lat,
                longitude: lng,
              },
              radius: Math.max(1, Math.min(filter.maxDistance || 5000, 50000)),
            },
          },
        }),
      },
      3500
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        (data && data.error && data.error.message) || 'Google Places v1 request failed'
      );
      err.status = response.status;
      throw err;
    }

    const restaurants = (data.places || [])
      .map((place) => {
        const name = place.displayName && place.displayName.text;
        const latitude = place.location && place.location.latitude;
        const longitude = place.location && place.location.longitude;

        if (!name || latitude === undefined || longitude === undefined) {
          return null;
        }

        return {
          name,
          address: place.formattedAddress || 'Address unavailable',
          rating: typeof place.rating === 'number' ? place.rating : null,
          priceLevel: mapGooglePriceLevel(place.priceLevel),
          openHours:
            place.currentOpeningHours && typeof place.currentOpeningHours.openNow === 'boolean'
              ? place.currentOpeningHours.openNow
              : null,
          place_id: place.id || null,
          lat: latitude,
          lng: longitude,
          permanentlyClosed: place.businessStatus === 'CLOSED_PERMANENTLY',
          chainKey: normalizeRestaurantName(name),
          primaryType: Array.isArray(place.types) && place.types.length > 0 ? place.types[0] : null,
          cuisines: Array.isArray(place.types)
            ? place.types.map(normalizeCuisine).filter(Boolean)
            : [],
        };
      })
      .filter(Boolean);

    return finalizeRestaurants(location, restaurants, filter);
  }

  async getRestaurantsFromGoogleLegacy(location, filter) {
    const { lat, lng } = location;
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: filter.maxDistance || 5000,
      type: 'restaurant',
      key: this.apiKey,
    });

    if (filter.cuisine) params.set('keyword', filter.cuisine);
    if (filter.openHours === 'now') params.set('opennow', 'true');
    if (filter.minPrice !== null) params.set('minprice', filter.minPrice);
    if (filter.maxPrice !== null) params.set('maxprice', filter.maxPrice);

    const url = `${this.legacyApiBaseUrl}/nearbysearch/json?${params.toString()}`;
    const response = await fetchJsonWithTimeout(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
        },
      },
      3000
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        data && data.error_message ? data.error_message : 'Google Places legacy request failed'
      );
      err.status = response.status;
      throw err;
    }

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      const err = new Error(
        data.error_message ? `Google Places error: ${data.error_message}` : `Google Places error: ${data.status}`
      );
      err.status = 502;
      throw err;
    }

    const restaurants = (data.results || []).map((place) => ({
      name: place.name,
      address: place.vicinity,
      rating: place.rating || null,
      priceLevel: place.price_level !== undefined ? place.price_level : null,
      openHours: place.opening_hours ? place.opening_hours.open_now : null,
      place_id: place.place_id,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      permanentlyClosed: place.business_status === 'CLOSED_PERMANENTLY',
      chainKey: normalizeRestaurantName(place.name),
      primaryType: Array.isArray(place.types) && place.types.length > 0 ? place.types[0] : null,
      cuisines: Array.isArray(place.types) ? place.types.map(normalizeCuisine).filter(Boolean) : [],
    }));

    return finalizeRestaurants(location, restaurants, filter);
  }

  async getRestaurantsFromOpenStreetMap(location, filter) {
    const { lat, lng } = location;
    const maxRadius = Math.max(500, Math.min(filter.maxDistance || 5000, 15000));
    const radiusSteps = [...new Set([Math.min(maxRadius, 2500), maxRadius])].filter(Boolean);
    let lastError = null;

    for (const radius of radiusSteps) {
      try {
        const query = `
[out:json][timeout:8];
(
  node["amenity"~"restaurant|fast_food"](around:${radius},${lat},${lng});
  way["amenity"~"restaurant|fast_food"](around:${radius},${lat},${lng});
  relation["amenity"~"restaurant|fast_food"](around:${radius},${lat},${lng});
);
out center tags;
`;

        const requests = this.overpassEndpoints.map(async (endpoint) => {
          const response = await fetchJsonWithTimeout(
            endpoint,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': USER_AGENT,
              },
              body: new URLSearchParams({ data: query }).toString(),
            },
            5500
          );

          if (!response.ok) {
            throw new Error(`OpenStreetMap search failed (${response.status})`);
          }

          return response.json();
        });

        const data = await Promise.any(requests);
        const restaurants = (data.elements || []).map(osmElementToRestaurant).filter(Boolean);
        const finalized = finalizeRestaurants(
          location,
          restaurants.map(({ cuisines, ...restaurant }) => restaurant),
          filter
        ).slice(0, 40);

        if (finalized.length > 0 || radius === maxRadius) {
          return finalized;
        }
      } catch (err) {
        lastError = err;
      }
    }

    const wrappedError = new Error(
      lastError ? lastError.message : 'Restaurant search is temporarily unavailable'
    );
    wrappedError.status = lastError && lastError.status ? lastError.status : 502;
    throw wrappedError;
  }
}

module.exports = RestaurantDAO;
