/**
 * share.js — Client-side sharing via the Web Share API.
 *
 * Usage (Antigravity integration):
 *
 *   // After the wheel lands on a result, call:
 *   shareRestaurant(restaurant);
 *
 *   // On page load, check for a pre-filled result from a shared link:
 *   const restaurant = getSharedRestaurant();
 *   if (restaurant) { /* display the result directly *\/ }
 *
 * restaurant shape expected: { name, address, rating, priceLevel, place_id }
 */

/**
 * Encodes a restaurant into the current page URL as query params,
 * then opens the native share sheet via the Web Share API.
 *
 * Falls back to copying the link to the clipboard if the Web Share API
 * is not available (e.g. desktop browsers).
 *
 * @param {Object} restaurant
 */
function shareRestaurant(restaurant) {
  const params = new URLSearchParams({
    name: restaurant.name,
    address: restaurant.address,
  });
  if (restaurant.rating != null)     params.set('rating', restaurant.rating);
  if (restaurant.priceLevel != null) params.set('priceLevel', restaurant.priceLevel);
  if (restaurant.placeId)            params.set('placeId', restaurant.placeId);
  if (restaurant.place_id)           params.set('place_id', restaurant.place_id);
  if (restaurant.lat != null)        params.set('lat', restaurant.lat);
  if (restaurant.lng != null)        params.set('lng', restaurant.lng);

  const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  const shareText = `Let's eat at ${restaurant.name}!`;

  if (navigator.share) {
    navigator.share({ title: restaurant.name, text: shareText, url: shareUrl })
      .catch(function (err) {
        if (err.name !== 'AbortError') console.error('Share failed:', err);
      });
  } else {
    navigator.clipboard.writeText(shareUrl).then(function () {
      alert('Link copied to clipboard!');
    }).catch(function () {
      prompt('Copy this link to share:', shareUrl);
    });
  }
}

/**
 * Reads restaurant data from the current page URL query params.
 * Returns a restaurant object if a shared link is detected, otherwise null.
 *
 * Call this on page load to auto-display a shared result.
 *
 * @returns {Object|null}
 */
function getSharedRestaurant() {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('name')) return null;

  return {
    name:       params.get('name'),
    address:    params.get('address'),
    rating:     params.get('rating')     ? parseFloat(params.get('rating'))     : null,
    priceLevel: params.get('priceLevel') ? parseInt(params.get('priceLevel'), 10) : null,
    placeId:    params.get('placeId')    || params.get('place_id') || null,
    place_id:   params.get('place_id')   || params.get('placeId') || null,
    lat:        params.get('lat')        ? parseFloat(params.get('lat')) : null,
    lng:        params.get('lng')        ? parseFloat(params.get('lng')) : null,
  };
}
