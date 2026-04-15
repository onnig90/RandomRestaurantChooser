const {
  findPlaceByNameAndLocation,
  getPlaceDetails,
  getPlacePhotoUrl,
  normalizePlaceId,
} = require('../../lib/googleMaps');

function mapPriceLevel(value) {
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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const query = req.query || {};
    let placeId = query.placeId ? normalizePlaceId(query.placeId) : '';

    if (!placeId && query.name && query.lat && query.lng) {
      const lat = parseFloat(query.lat);
      const lng = parseFloat(query.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        placeId = await findPlaceByNameAndLocation(String(query.name), lat, lng);
      }
    }

    if (!placeId) {
      return res.status(400).json({ error: 'placeId or name+lat+lng is required' });
    }

    const place = await getPlaceDetails(placeId);
    if (!place) {
      return res.status(404).json({ error: 'Place not found' });
    }

    const photoName = Array.isArray(place.photos) && place.photos[0] ? place.photos[0].name : null;
    let photoUrl = null;
    if (photoName) {
      try {
        photoUrl = await getPlacePhotoUrl(photoName);
      } catch (err) {
        console.warn('Place photo lookup failed:', err.message);
      }
    }

    return res.status(200).json({
      place: {
        placeId: place.id || placeId,
        name: place.displayName && place.displayName.text ? place.displayName.text : null,
        address: place.formattedAddress || null,
        lat: place.location ? place.location.latitude : null,
        lng: place.location ? place.location.longitude : null,
        rating: typeof place.rating === 'number' ? place.rating : null,
        priceLevel: mapPriceLevel(place.priceLevel),
        isOpenNow:
          place.currentOpeningHours && typeof place.currentOpeningHours.openNow === 'boolean'
            ? place.currentOpeningHours.openNow
            : null,
        businessStatus: place.businessStatus || null,
        phone: place.internationalPhoneNumber || null,
        website: place.websiteUri || null,
        googleMapsUri: place.googleMapsUri || null,
        openingHoursText:
          place.currentOpeningHours && Array.isArray(place.currentOpeningHours.weekdayDescriptions)
            ? place.currentOpeningHours.weekdayDescriptions
            : [],
        photoUrl,
        source: 'google',
      },
    });
  } catch (err) {
    console.error('restaurants/details error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};
