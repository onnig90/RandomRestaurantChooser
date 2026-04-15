const fetch = require('node-fetch');

const USER_AGENT =
  'RandomRestaurantChooser/1.0 (+https://github.com/xandersbackyard/RandomRestaurantChooser)';
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE = new Map();

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
    openHours: tags.opening_hours || null,
    place_id: `osm:${element.type}:${element.id}`,
    lat,
    lng,
    cuisines: String(tags.cuisine || '')
      .split(/[;,]/)
      .map(normalizeCuisine)
      .filter(Boolean),
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

class RestaurantDAO {
  constructor() {
    this.apiBaseUrl =
      process.env.GOOGLE_PLACES_BASE_URL || 'https://maps.googleapis.com/maps/api/place';
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
      if (this.apiKey) {
        const restaurants = await this.getRestaurantsFromGoogle(location, filter);
        setCachedEntry(cacheKey, restaurants);
        return restaurants;
      }
    } catch (err) {
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

    const url = `${this.apiBaseUrl}/nearbysearch/json?${params.toString()}`;
    const response = await fetchJsonWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    }, 2000);

    if (!response.ok) {
      const err = new Error('Google Places API request failed');
      err.status = 502;
      throw err;
    }

    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      const err = new Error(`Google Places error: ${data.status}`);
      err.status = 502;
      throw err;
    }

    let restaurants = (data.results || []).map((place) => ({
      name: place.name,
      address: place.vicinity,
      rating: place.rating || null,
      priceLevel: place.price_level !== undefined ? place.price_level : null,
      openHours: place.opening_hours ? place.opening_hours.open_now : null,
      place_id: place.place_id,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
    }));

    if (filter.minRating) {
      restaurants = restaurants.filter(
        (restaurant) => restaurant.rating !== null && restaurant.rating >= filter.minRating
      );
    }

    return restaurants;
  }

  async getRestaurantsFromOpenStreetMap(location, filter) {
    const { lat, lng } = location;
    const radius = Math.max(500, Math.min(filter.maxDistance || 5000, 15000));
    const cuisineNeedle = normalizeCuisine(filter.cuisine);
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
        4500
      );

      if (!response.ok) {
        throw new Error(`OpenStreetMap search failed (${response.status})`);
      }

      return response.json();
    });

    let data;

    try {
      data = await Promise.any(requests);
    } catch (err) {
      const aggregateErrors = err && err.errors ? err.errors : [];
      const lastError = aggregateErrors[aggregateErrors.length - 1];
      const wrappedError = new Error(
        lastError ? lastError.message : 'Restaurant search is temporarily unavailable'
      );
      wrappedError.status = 502;
      throw wrappedError;
    }

    let restaurants = (data.elements || [])
      .map(osmElementToRestaurant)
      .filter(Boolean);

    if (cuisineNeedle) {
      const filtered = restaurants.filter((restaurant) => {
        const cuisines = restaurant.cuisines || [];
        return (
          cuisines.some((value) => value.includes(cuisineNeedle)) ||
          normalizeCuisine(restaurant.name).includes(cuisineNeedle)
        );
      });

      if (filtered.length > 0) {
        restaurants = filtered;
      }
    }

    return restaurants
      .map(({ cuisines, ...restaurant }) => restaurant)
      .slice(0, 40);
  }
}

module.exports = RestaurantDAO;
