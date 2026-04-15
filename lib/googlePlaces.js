const fetch = require('node-fetch');
const OpeningHours = require('opening_hours');
const {
  searchNearbyRestaurants,
  getDistanceMatrix,
} = require('./googleMaps');

const USER_AGENT =
  'RandomRestaurantChooser/1.0 (+https://github.com/xandersbackyard/RandomRestaurantChooser)';
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE = new Map();
const GOOGLE_CUISINE_TYPE_MAP = {
  pizza: 'pizza_restaurant',
  sushi: 'sushi_restaurant',
  mexican: 'mexican_restaurant',
  burgers: 'hamburger_restaurant',
  thai: 'thai_restaurant',
  italian: 'italian_restaurant',
  chinese: 'chinese_restaurant',
};

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

function osmElementToRestaurant(element) {
  const tags = element.tags || {};
  const lat = element.lat !== undefined ? element.lat : element.center && element.center.lat;
  const lng = element.lon !== undefined ? element.lon : element.center && element.center.lon;

  if (!tags.name || lat === undefined || lng === undefined) {
    return null;
  }

  return {
    placeId: null,
    place_id: null,
    name: tags.name,
    address: formatAddress(tags),
    rating: null,
    priceLevel: parsePriceLevel(tags),
    isOpenNow: getOsmOpenState(tags),
    openHours: getOsmOpenState(tags),
    businessStatus: isOsmPermanentlyClosed(tags) ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL',
    lat,
    lng,
    source: 'fallback',
    googleMapsUri: null,
    permanentlyClosed: isOsmPermanentlyClosed(tags),
    chainKey: normalizeRestaurantName(tags.brand || tags.name),
    primaryType: tags.amenity || null,
    cuisines: String(tags.cuisine || '')
      .split(/[;,]/)
      .map(normalizeCuisine)
      .filter(Boolean),
  };
}

function mapGooglePlaceToRestaurant(place) {
  const name = place.displayName && place.displayName.text ? place.displayName.text : null;
  const latitude = place.location && place.location.latitude;
  const longitude = place.location && place.location.longitude;

  if (!name || latitude === undefined || longitude === undefined) {
    return null;
  }

  const isOpenNow =
    place.currentOpeningHours && typeof place.currentOpeningHours.openNow === 'boolean'
      ? place.currentOpeningHours.openNow
      : null;
  const businessStatus = place.businessStatus || 'BUSINESS_STATUS_UNSPECIFIED';

  return {
    placeId: place.id || null,
    place_id: place.id || null,
    name,
    address: place.formattedAddress || 'Address unavailable',
    rating: typeof place.rating === 'number' ? place.rating : null,
    priceLevel: mapGooglePriceLevel(place.priceLevel),
    isOpenNow,
    openHours: isOpenNow,
    businessStatus,
    lat: latitude,
    lng: longitude,
    source: 'google',
    googleMapsUri: place.googleMapsUri || null,
    permanentlyClosed: businessStatus === 'CLOSED_PERMANENTLY',
    chainKey: normalizeRestaurantName(name),
    primaryType: Array.isArray(place.types) && place.types.length > 0 ? place.types[0] : null,
    cuisines: Array.isArray(place.types) ? place.types.map(normalizeCuisine).filter(Boolean) : [],
  };
}

function finalizeRestaurants(location, restaurants, filter) {
  const exactMaxDistance = filter.maxDistance || 5000;

  let normalized = restaurants
    .filter(Boolean)
    .filter((restaurant) => !restaurant.permanentlyClosed)
    .filter((restaurant) => restaurant.businessStatus !== 'CLOSED_TEMPORARILY')
    .map((restaurant) => ({
      ...restaurant,
      distanceMeters: Math.round(haversineDistanceMeters(location, restaurant)),
    }))
    .filter((restaurant) => Number.isFinite(restaurant.distanceMeters))
    .filter((restaurant) => restaurant.distanceMeters <= exactMaxDistance);

  if (filter.cuisine) {
    normalized = normalized.filter((restaurant) =>
      matchesCuisine(restaurant, filter.cuisine)
    );
  }

  if (filter.openHours === 'now') {
    normalized = normalized.filter((restaurant) => restaurant.isOpenNow !== false);
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

    const leftOpenWeight = left.isOpenNow === true ? 2 : left.isOpenNow === null ? 1 : 0;
    const rightOpenWeight = right.isOpenNow === true ? 2 : right.isOpenNow === null ? 1 : 0;
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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenStreetMap search failed (${response.status})`);
    }

    return response.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutErr = new Error('Fallback search timed out');
      timeoutErr.status = 504;
      throw timeoutErr;
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyRouteDistanceFilter(location, restaurants, maxDistanceMeters) {
  if (restaurants.length === 0) return restaurants;

  let routeDistances;
  try {
    routeDistances = await getDistanceMatrix(
      location,
      restaurants.map((r) => ({ lat: r.lat, lng: r.lng }))
    );
  } catch (err) {
    console.warn('Distance Matrix failed, keeping Haversine filter:', err.message);
    return restaurants;
  }

  return restaurants
    .map((r, i) => ({
      ...r,
      routeDistanceMeters: routeDistances[i] !== null ? routeDistances[i] : r.distanceMeters,
    }))
    .filter((r) => r.routeDistanceMeters <= maxDistanceMeters);
}

class RestaurantDAO {
  constructor() {
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
      const rawPlaces = await searchNearbyRestaurants(location, {
        primaryType: GOOGLE_CUISINE_TYPE_MAP[filter.cuisine] || null,
        radius: filter.maxDistance || 5000,
      });

      const candidates = finalizeRestaurants(
        location,
        rawPlaces.map(mapGooglePlaceToRestaurant).filter(Boolean),
        filter
      );

      const restaurants = await applyRouteDistanceFilter(location, candidates, filter.maxDistance || 5000);
      setCachedEntry(cacheKey, restaurants);
      return restaurants;
    } catch (err) {
      console.warn('Google Places failed, falling back to OpenStreetMap search:', err.message);
    }

    const fallbackRestaurants = await this.getRestaurantsFromOpenStreetMap(location, filter);
    setCachedEntry(cacheKey, fallbackRestaurants);
    return fallbackRestaurants;
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

        const requests = this.overpassEndpoints.map((endpoint) =>
          fetchJsonWithTimeout(
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
          )
        );

        const data = await Promise.any(requests);
        const restaurants = (data.elements || []).map(osmElementToRestaurant).filter(Boolean);
        const finalized = finalizeRestaurants(location, restaurants, filter).slice(0, 40);

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
