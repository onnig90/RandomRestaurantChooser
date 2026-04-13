const fetch = require('node-fetch');

class RestaurantDAO {
  constructor() {
    this.apiBaseUrl = process.env.GOOGLE_PLACES_BASE_URL;
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY;
  }

  async GetRestaurants(location, filter) {
    const { lat, lng } = location;
    const params = new URLSearchParams({
      location: `${lat},${lng}`,
      radius: filter.maxDistance || 5000,
      type: 'restaurant',
      key: this.apiKey,
    });

    if (filter.cuisine) params.set('keyword', filter.cuisine);
    if (filter.openHours === 'now') params.set('opennow', 'true');
    if (filter.priceRange) {
      params.set('minprice', filter.priceRange);
      params.set('maxprice', filter.priceRange);
    }

    const url = `${this.apiBaseUrl}/nearbysearch/json?${params.toString()}`;
    const response = await fetch(url);

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
        (r) => r.rating !== null && r.rating >= filter.minRating
      );
    }

    return restaurants;
  }
}

module.exports = RestaurantDAO;
