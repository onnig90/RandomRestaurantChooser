const AUTH_TOKEN_KEY = 'rrc_auth_token';
const AUTH_USER_KEY = 'rrc_auth_user';
const SEARCH_RESULT_CACHE_TTL_MS = 3 * 60 * 1000;
const AUTOCOMPLETE_DEBOUNCE_MS = 250;

let isGuest = true;
let authToken = null;
let currentUser = null;
let currentUserLoc = null;
let locationIsAutoDetected = false;
let lastUiSearchKey = null;
let lastSearchKey = null;
let lastSearchResults = null;
let lastSearchAt = 0;
let lastResolvedOrigin = null;
let currentLocationSelection = null;
let autocompleteTimer = null;
let autocompleteRequestId = 0;
let lastAutocompletePredictions = [];
let placeDetailsPromiseCache = new Map();
let routePromiseCache = new Map();
let geocodeCache = new Map();
let publicConfigPromise = null;
let googleMapsPromise = null;

document.addEventListener('DOMContentLoaded', () => {
    hydrateAuth();
    initFilters();
    initAuthBar();
    initLocation();
    initLocationAutocomplete();

    document.getElementById('btn-spin').addEventListener('click', onSpinClicked);
    document.getElementById('btn-auth-guest').addEventListener('click', onAuthGuestClicked);
    document.getElementById('btn-auth-user').addEventListener('click', onLoadFiltersClicked);
    document.getElementById('btn-itinerary').addEventListener('click', onItineraryClicked);
    document.getElementById('btn-share').addEventListener('click', onShareClicked);
    document.getElementById('btn-signup-prompt').addEventListener('click', onAuthGuestClicked);
    document.getElementById('btn-save-filters').addEventListener('click', onSaveFiltersClicked);

    document.getElementById('distance-input').addEventListener('input', (event) => {
        document.getElementById('distance-val').innerText = `${event.target.value} km`;
    });

    document.querySelectorAll('.price-btn').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.currentTarget.classList.toggle('active');
        });
    });

    document.addEventListener('click', (event) => {
        const autocompleteContainer = document.getElementById('location-autocomplete');
        if (!autocompleteContainer.contains(event.target) && event.target.id !== 'location-input') {
            hideAutocomplete();
        }
    });
});

function hydrateAuth() {
    try {
        authToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
        const rawUser = window.localStorage.getItem(AUTH_USER_KEY);
        currentUser = rawUser ? JSON.parse(rawUser) : null;
        isGuest = !(authToken && currentUser);
    } catch (err) {
        console.error('Failed to restore auth session', err);
        authToken = null;
        currentUser = null;
        isGuest = true;
    }
}

function persistAuth(token, user) {
    authToken = token;
    currentUser = user;
    isGuest = false;

    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

    initAuthBar();
    refreshPostSpinPrompts();
}

function clearAuth() {
    authToken = null;
    currentUser = null;
    isGuest = true;

    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    window.localStorage.removeItem(AUTH_USER_KEY);

    initAuthBar();
    refreshPostSpinPrompts();
}

function initAuthBar() {
    const guestButton = document.getElementById('btn-auth-guest');
    const userButton = document.getElementById('btn-auth-user');

    guestButton.classList.remove('hidden');

    if (isGuest) {
        guestButton.innerText = 'Sign up / Log in to save your filters';
        userButton.classList.add('hidden');
        return;
    }

    guestButton.innerText = 'Log out';
    userButton.innerText = currentUser && currentUser.name
        ? `Load filters for ${currentUser.name}`
        : 'Load filters';
    userButton.classList.remove('hidden');
}

function refreshPostSpinPrompts() {
    const guestPrompt = document.getElementById('guest-post-spin-prompt');
    const userPrompt = document.getElementById('user-post-spin-prompt');

    if (!guestPrompt || !userPrompt) return;

    if (isGuest) {
        guestPrompt.classList.remove('hidden');
        userPrompt.classList.add('hidden');
    } else {
        guestPrompt.classList.add('hidden');
        userPrompt.classList.remove('hidden');
    }
}

function initFilters() {
    if (typeof getSharedRestaurant !== 'function') return;

    const shared = getSharedRestaurant();
    if (shared) {
        displayWinner(shared);
    }
}

function initLocation() {
    const locationInput = document.getElementById('location-input');

    locationInput.addEventListener('input', () => {
        locationIsAutoDetected = false;
        currentLocationSelection = null;
    });

    if (!navigator.geolocation) {
        locationInput.placeholder = 'Enter your address...';
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            currentUserLoc = { lat: latitude, lng: longitude };
            locationIsAutoDetected = true;

            try {
                const location = await reverseGeocodeCoordinates(latitude, longitude);
                locationInput.value = location && location.displayName
                    ? location.displayName
                    : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                clearLocationValidation();
            } catch (err) {
                console.error('Reverse geocoding failed', err);
                locationInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            }
        },
        () => {
            locationInput.placeholder = 'Enter your address...';
            showToast('Geolocation denied. Please enter address manually.');
        }
    );
}

function initLocationAutocomplete() {
    const input = document.getElementById('location-input');

    input.addEventListener('input', () => {
        const query = input.value.trim();

        if (autocompleteTimer) {
            clearTimeout(autocompleteTimer);
        }

        if (query.length < 3 || locationIsAutoDetected) {
            hideAutocomplete();
            return;
        }

        autocompleteTimer = setTimeout(() => {
            loadAutocompleteSuggestions(query).catch((err) => {
                console.error('Autocomplete failed', err);
                hideAutocomplete();
            });
        }, AUTOCOMPLETE_DEBOUNCE_MS);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideAutocomplete();
        }
    });
}

async function loadAutocompleteSuggestions(query) {
    const requestId = ++autocompleteRequestId;
    const params = new URLSearchParams({ q: query });

    if (currentUserLoc) {
        params.set('lat', String(currentUserLoc.lat));
        params.set('lng', String(currentUserLoc.lng));
    }

    const data = await apiRequest(`/api/location/autocomplete?${params.toString()}`);
    if (requestId !== autocompleteRequestId) {
        return;
    }

    lastAutocompletePredictions = data.predictions || [];
    renderAutocomplete(lastAutocompletePredictions);
}

function renderAutocomplete(predictions) {
    const container = document.getElementById('location-autocomplete');
    container.innerHTML = '';

    if (!predictions || predictions.length === 0) {
        container.classList.add('hidden');
        return;
    }

    predictions.slice(0, 5).forEach((prediction) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'autocomplete-item';
        button.innerHTML = `
            <span class="autocomplete-primary">${escapeHtml(prediction.primaryText)}</span>
            <span class="autocomplete-secondary">${escapeHtml(prediction.secondaryText || prediction.fullText || '')}</span>
        `;
        button.addEventListener('click', () => {
            selectAutocompletePrediction(prediction);
        });
        container.appendChild(button);
    });

    container.classList.remove('hidden');
}

function selectAutocompletePrediction(prediction) {
    const input = document.getElementById('location-input');
    const label = [prediction.primaryText, prediction.secondaryText].filter(Boolean).join(', ');

    currentLocationSelection = {
        placeId: prediction.placeId,
        label: label || prediction.fullText,
    };
    input.value = currentLocationSelection.label;
    clearLocationValidation();
    hideAutocomplete();
}

function hideAutocomplete() {
    const container = document.getElementById('location-autocomplete');
    container.classList.add('hidden');
    container.innerHTML = '';
}

function showLocationValidation(message) {
    const note = document.getElementById('location-validation');
    note.innerText = message;
    note.classList.remove('hidden');
}

function clearLocationValidation() {
    const note = document.getElementById('location-validation');
    note.classList.add('hidden');
    note.innerText = '';
}

async function onAuthGuestClicked() {
    if (!isGuest) {
        clearAuth();
        showToast('You have been logged out.');
        return;
    }

    const wantsSignup = window.confirm(
        'Press OK to create a new account, or Cancel to log in to an existing one.'
    );

    try {
        if (wantsSignup) {
            const name = promptRequired('Enter your name');
            const email = promptRequired('Enter your email');
            const password = promptRequired('Create a password (minimum 8 characters)');
            if (!name || !email || !password) return;

            const phone = window.prompt('Phone number in E.164 format (optional)', '') || '';
            const location = window.prompt(
                'Default location (optional)',
                document.getElementById('location-input').value || ''
            ) || '';

            const data = await apiRequest('/api/auth/register', {
                method: 'POST',
                body: { name, email, password, phone, location },
            });

            persistAuth(data.token, data.user);
            showToast(`Welcome, ${data.user.name}!`);
            return;
        }

        const email = promptRequired('Enter your email');
        const password = promptRequired('Enter your password');
        if (!email || !password) return;

        const data = await apiRequest('/api/auth/login', {
            method: 'POST',
            body: { email, password },
        });

        persistAuth(data.token, data.user);
        showToast(`Welcome back, ${data.user.name}!`);
    } catch (err) {
        showToast(err.message || 'Authentication failed.');
    }
}

async function onLoadFiltersClicked() {
    if (isGuest || !authToken) {
        showToast('Log in first to load saved filters.');
        return;
    }

    try {
        const data = await apiRequest('/api/filters', {
            method: 'GET',
            requiresAuth: true,
        });

        const filters = data.filters || [];
        if (filters.length === 0) {
            showToast('No saved filters found for this account.');
            return;
        }

        const selectedFilter = chooseFilter(filters);
        if (!selectedFilter) return;

        applySavedFilter(selectedFilter);
        showToast(`Loaded ${selectedFilter.label || 'saved'} filter.`);
    } catch (err) {
        showToast(err.message || 'Failed to load filters.');
    }
}

async function onSaveFiltersClicked() {
    if (isGuest || !authToken) {
        showToast('Log in first to save your filters.');
        return;
    }

    const filters = collectFiltersFromUi();
    const label = window.prompt(
        'Name this filter',
        filters.cuisine !== 'any' ? `${filters.cuisine} ${filters.distance}km` : `Nearby ${filters.distance}km`
    );

    if (label === null) return;

    const activePrices = filters.prices || [];
    const priceRange = activePrices.length > 0 ? Math.max(...activePrices) : null;
    const isDefault = window.confirm('Make this your default filter?');

    try {
        await apiRequest('/api/filters/save', {
            method: 'POST',
            requiresAuth: true,
            body: {
                cuisine: filters.cuisine === 'any' ? null : filters.cuisine,
                priceRange: priceRange !== null ? String(priceRange) : null,
                minRating: null,
                maxDistance: filters.distance * 1000,
                openHours: filters.openNow ? 'now' : null,
                label: label.trim() || null,
                isDefault,
            },
        });

        showToast('Filter saved.');
    } catch (err) {
        showToast(err.message || 'Failed to save filters.');
    }
}

async function reverseGeocodeCoordinates(lat, lng) {
    const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
    });

    const data = await apiRequest(`/api/location/geocode?${params.toString()}`);
    return data.location || null;
}

async function geocodeAddress(address) {
    if (!address) return null;

    const normalizedAddress = String(address).trim();
    const cacheKey = currentLocationSelection && currentLocationSelection.placeId
        ? `place:${currentLocationSelection.placeId}`
        : `text:${normalizedAddress.toLowerCase()}`;

    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    const coordMatch = normalizedAddress.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
        const coordinates = {
            lat: parseFloat(coordMatch[1]),
            lng: parseFloat(coordMatch[2]),
            displayName: normalizedAddress,
            placeId: null,
        };
        geocodeCache.set(cacheKey, coordinates);
        return coordinates;
    }

    const params = new URLSearchParams();
    if (currentLocationSelection && currentLocationSelection.placeId) {
        params.set('placeId', currentLocationSelection.placeId);
    } else {
        params.set('q', normalizedAddress);
    }

    const data = await apiRequest(`/api/location/geocode?${params.toString()}`);
    const location = data.location || null;

    if (data.validation && data.validation.hasSuggestion && data.validation.suggestedAddress) {
        showLocationValidation(`Using verified address: ${data.validation.suggestedAddress}`);
    } else {
        clearLocationValidation();
    }

    if (location) {
        geocodeCache.set(cacheKey, location);
    }

    return location;
}

const LOADING_DOTS_HTML = '<span class="btn-loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';

async function onSpinClicked() {
    const button = document.getElementById('btn-spin');
    button.disabled = true;
    button.innerHTML = LOADING_DOTS_HTML;

    try {
        const filters = collectFiltersFromUi();
        const restaurants = await fetchRestaurants(filters, createUiSearchKey(filters));

        if (!restaurants || restaurants.length === 0) {
            showToast('No restaurants match your filters. Try widening your search.');
            return;
        }

        window.ITEMS = restaurants;
        if (typeof drawPlaceholderWheel === 'function') drawPlaceholderWheel();

        button.innerHTML = LOADING_DOTS_HTML;
        const winner = await window.spin();

        if (winner) {
            displayWinner(winner);
        }
    } catch (err) {
        showToast(err.message || 'Error finding restaurants.');
        console.error(err);
    } finally {
        button.disabled = false;
        button.innerHTML = '✦ Spin the wheel';
    }
}

async function onItineraryClicked() {
    if (!window.currentWinner) {
        showToast('Spin the wheel first to build an itinerary.');
        return;
    }

    const mapSection = document.getElementById('map-section');
    mapSection.classList.remove('hidden');
    setTimeout(() => mapSection.classList.add('show'), 10);
    mapSection.scrollIntoView({ behavior: 'smooth' });

    try {
        await renderItinerary(window.currentWinner);
    } catch (err) {
        console.error('Itinerary rendering failed', err);
        renderFallbackMap(window.currentWinner);
    }
}

function onShareClicked() {
    if (window.currentWinner && typeof shareRestaurant === 'function') {
        shareRestaurant(window.currentWinner);
    } else {
        showToast('Spin the wheel first to share a restaurant.');
    }
}

function createUiSearchKey(filters) {
    const activePrices = Array.isArray(filters.prices)
        ? [...filters.prices].sort((left, right) => left - right)
        : [];
    const locationKey = locationIsAutoDetected && currentUserLoc
        ? `geo:${currentUserLoc.lat.toFixed(4)},${currentUserLoc.lng.toFixed(4)}`
        : currentLocationSelection && currentLocationSelection.placeId
            ? `place:${currentLocationSelection.placeId}`
            : `text:${String(filters.location || '').trim().toLowerCase()}`;

    return JSON.stringify({
        locationKey,
        cuisine: filters.cuisine || 'any',
        distance: filters.distance || 5,
        prices: activePrices,
        openNow: Boolean(filters.openNow),
    });
}

function collectFiltersFromUi() {
    return {
        location: document.getElementById('location-input').value,
        cuisine: document.getElementById('cuisine-select').value,
        distance: parseInt(document.getElementById('distance-input').value, 10),
        prices: Array.from(document.querySelectorAll('.price-btn.active')).map((button) =>
            parseInt(button.dataset.val, 10)
        ),
        openNow: document.getElementById('open-now-toggle').checked,
    };
}

function chooseFilter(filters) {
    if (filters.length === 1) {
        return filters[0];
    }

    const defaultIndex = Math.max(
        0,
        filters.findIndex((filter) => filter.is_default)
    );
    const list = filters
        .map((filter, index) => `${index + 1}. ${filter.label || 'Saved filter'}`)
        .join('\n');

    const selection = window.prompt(
        `Choose a saved filter:\n${list}`,
        String(defaultIndex + 1)
    );

    if (selection === null) return null;

    const parsedIndex = parseInt(selection, 10);
    if (Number.isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > filters.length) {
        return filters[defaultIndex];
    }

    return filters[parsedIndex - 1];
}

function applySavedFilter(filter) {
    document.getElementById('cuisine-select').value = filter.cuisine || 'any';

    const distanceKm = filter.max_distance
        ? Math.max(1, Math.round(parseInt(filter.max_distance, 10) / 1000))
        : 5;
    document.getElementById('distance-input').value = distanceKm;
    document.getElementById('distance-val').innerText = `${distanceKm} km`;

    const openNow = filter.open_hours === 'now';
    document.getElementById('open-now-toggle').checked = openNow;

    const parsedPrice = parseInt(filter.price_range, 10);
    if (!Number.isNaN(parsedPrice)) {
        setPriceButtonsUpTo(parsedPrice);
    }

    lastUiSearchKey = null;
}

function setPriceButtonsUpTo(maxPrice) {
    document.querySelectorAll('.price-btn').forEach((button) => {
        const buttonValue = parseInt(button.dataset.val, 10);
        button.classList.toggle('active', buttonValue <= maxPrice);
    });
}

function displayWinner(restaurant) {
    window.currentWinner = restaurant;

    resetWinnerSupplementaryUi();

    document.getElementById('res-name').innerText = restaurant.name;
    document.getElementById('res-rating').innerText = restaurant.rating ? `${restaurant.rating} ⭐` : 'Rating unavailable';
    document.getElementById('res-price').innerText = formatPriceLevel(restaurant.priceLevel);
    document.getElementById('res-addr').innerText = restaurant.address || 'Address unavailable';
    document.getElementById('res-status').innerText = buildRestaurantStatus(restaurant);
    document.getElementById('res-status').classList.remove('hidden');

    refreshPostSpinPrompts();

    const resultSection = document.getElementById('result-display');
    resultSection.classList.remove('hidden');
    setTimeout(() => resultSection.classList.add('show'), 50);

    updateExternalItineraryLink(restaurant);
    renderFallbackMap(restaurant);

    hydrateWinnerDetails(restaurant).catch((err) => {
        console.error('Winner enrichment failed', err);
    });
}

function resetWinnerSupplementaryUi() {
    document.getElementById('res-photo-wrap').classList.add('hidden');
    document.getElementById('res-photo').removeAttribute('src');
    document.getElementById('res-website').classList.add('hidden');
    document.getElementById('res-phone').classList.add('hidden');
    document.getElementById('res-hours').classList.add('hidden');
    document.getElementById('res-hours').innerHTML = '';
    document.getElementById('res-travel').classList.add('hidden');
    document.getElementById('route-summary').classList.add('hidden');
    document.getElementById('route-summary').innerText = '';
}

async function hydrateWinnerDetails(restaurant) {
    let enrichedRestaurant = restaurant;

    if (restaurant.source === 'google' && restaurant.placeId) {
        const details = await getRestaurantDetails(restaurant.placeId);
        if (details) {
            enrichedRestaurant = {
                ...restaurant,
                ...details,
            };
            window.currentWinner = enrichedRestaurant;
            applyWinnerDetails(enrichedRestaurant);
        }
    }

    const route = await ensureRouteForRestaurant(enrichedRestaurant);
    if (route) {
        applyRouteSummary(route, enrichedRestaurant);
    }
}

function applyWinnerDetails(restaurant) {
    if (restaurant.photoUrl) {
        document.getElementById('res-photo').src = restaurant.photoUrl;
        document.getElementById('res-photo-wrap').classList.remove('hidden');
    }

    if (restaurant.website) {
        const link = document.getElementById('res-website');
        link.href = restaurant.website;
        link.classList.remove('hidden');
    }

    if (restaurant.phone) {
        const phone = document.getElementById('res-phone');
        phone.innerText = restaurant.phone;
        phone.classList.remove('hidden');
    }

    if (Array.isArray(restaurant.openingHoursText) && restaurant.openingHoursText.length > 0) {
        const hours = document.getElementById('res-hours');
        hours.innerHTML = restaurant.openingHoursText
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('');
        hours.classList.remove('hidden');
    }

    document.getElementById('res-status').innerText = buildRestaurantStatus(restaurant);
    updateExternalItineraryLink(restaurant);
}

function applyRouteSummary(route, restaurant) {
    const summary = buildRouteSummary(route, restaurant);
    if (!summary) return;

    const travel = document.getElementById('res-travel');
    travel.innerText = summary;
    travel.classList.remove('hidden');

    const routeSummary = document.getElementById('route-summary');
    routeSummary.innerText = summary;
    routeSummary.classList.remove('hidden');
}

function buildRestaurantStatus(restaurant) {
    const statusParts = [];

    if (restaurant.businessStatus === 'CLOSED_PERMANENTLY') {
        statusParts.push('Permanently closed');
    } else if (restaurant.isOpenNow === true) {
        statusParts.push('Open now');
    } else if (restaurant.isOpenNow === false) {
        statusParts.push('Currently closed');
    }

    if (Number.isFinite(restaurant.distanceMeters)) {
        statusParts.push(formatDistance(restaurant.distanceMeters));
    }

    if (restaurant.source === 'fallback') {
        statusParts.push('Backup place data');
    }

    return statusParts.join(' • ') || 'Restaurant details ready';
}

function formatPriceLevel(priceLevel) {
    if (priceLevel === null || priceLevel === undefined) {
        return 'Price unavailable';
    }

    if (priceLevel === 0) {
        return 'Free';
    }

    return Array(Math.max(1, parseInt(priceLevel, 10) || 1)).fill('$').join('');
}

function formatDistance(distanceMeters) {
    if (!Number.isFinite(distanceMeters)) return '';
    if (distanceMeters < 1000) {
        return `${distanceMeters} m away`;
    }

    const distanceKm = distanceMeters / 1000;
    return `${distanceKm >= 10 ? distanceKm.toFixed(0) : distanceKm.toFixed(1)} km away`;
}

function formatDuration(durationSeconds) {
    if (!Number.isFinite(durationSeconds)) return '';

    const minutes = Math.round(durationSeconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function buildRouteSummary(route, restaurant) {
    if (!route) return '';

    const parts = [];
    if (Number.isFinite(route.durationSeconds)) {
        parts.push(`${formatDuration(route.durationSeconds)} drive`);
    }
    if (Number.isFinite(route.distanceMeters)) {
        parts.push(formatDistance(route.distanceMeters));
    } else if (Number.isFinite(restaurant.distanceMeters)) {
        parts.push(formatDistance(restaurant.distanceMeters));
    }

    return parts.join(' • ');
}

function updateExternalItineraryLink(restaurant) {
    const button = document.getElementById('btn-open-itinerary');
    button.href = buildDirectionsUrl(restaurant);
}

function buildDirectionsUrl(restaurant) {
    if (!restaurant || restaurant.lat === undefined || restaurant.lng === undefined) {
        return '#';
    }

    const params = new URLSearchParams({
        api: '1',
        destination: `${restaurant.lat},${restaurant.lng}`,
    });

    if (lastResolvedOrigin && Number.isFinite(lastResolvedOrigin.lat) && Number.isFinite(lastResolvedOrigin.lng)) {
        params.set('origin', `${lastResolvedOrigin.lat},${lastResolvedOrigin.lng}`);
    }

    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function renderItinerary(restaurant) {
    const route = await ensureRouteForRestaurant(restaurant);
    if (route) {
        applyRouteSummary(route, restaurant);
    }

    try {
        const rendered = await renderGoogleMap(restaurant, route);
        if (!rendered) {
            renderFallbackMap(restaurant);
        }
    } catch (err) {
        console.error('Google map render failed', err);
        renderFallbackMap(restaurant);
    }
}

async function renderGoogleMap(restaurant, route) {
    const maps = await loadGoogleMaps();
    if (!maps) {
        return false;
    }

    const mapCanvas = document.getElementById('map-canvas');
    const mapFrame = document.getElementById('map-widget');
    mapFrame.classList.add('hidden');
    mapCanvas.classList.remove('hidden');
    mapCanvas.innerHTML = '';

    const { Map } = await maps.importLibrary('maps');
    const { AdvancedMarkerElement } = await maps.importLibrary('marker');

    const center = {
        lat: Number(restaurant.lat),
        lng: Number(restaurant.lng),
    };

    const map = new Map(mapCanvas, {
        center,
        zoom: 13,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
    });

    const bounds = new google.maps.LatLngBounds();

    if (lastResolvedOrigin && Number.isFinite(lastResolvedOrigin.lat) && Number.isFinite(lastResolvedOrigin.lng)) {
        const originPosition = {
            lat: Number(lastResolvedOrigin.lat),
            lng: Number(lastResolvedOrigin.lng),
        };
        new AdvancedMarkerElement({
            map,
            position: originPosition,
            title: 'Starting point',
        });
        bounds.extend(originPosition);
    }

    new AdvancedMarkerElement({
        map,
        position: center,
        title: restaurant.name,
    });
    bounds.extend(center);

    if (route && Array.isArray(route.polyline) && route.polyline.length > 1) {
        const polyline = new google.maps.Polyline({
            path: route.polyline.map((point) => ({
                lat: point.lat,
                lng: point.lng,
            })),
            geodesic: true,
            strokeColor: '#E8C547',
            strokeOpacity: 0.9,
            strokeWeight: 5,
        });
        polyline.setMap(map);
        route.polyline.forEach((point) => bounds.extend(point));
    }

    if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 60);
    }

    return true;
}

function renderFallbackMap(restaurant) {
    const mapCanvas = document.getElementById('map-canvas');
    const mapFrame = document.getElementById('map-widget');
    mapCanvas.classList.add('hidden');
    mapFrame.classList.remove('hidden');

    if (!Number.isFinite(restaurant.lat) || !Number.isFinite(restaurant.lng)) {
        mapFrame.src = 'about:blank';
        return;
    }

    loadPublicConfig()
        .then((config) => {
            if (
                config.googleMapsBrowserApiKey &&
                lastResolvedOrigin &&
                Number.isFinite(lastResolvedOrigin.lat) &&
                Number.isFinite(lastResolvedOrigin.lng) &&
                Number.isFinite(restaurant.lat) &&
                Number.isFinite(restaurant.lng)
            ) {
                const params = new URLSearchParams({
                    key: config.googleMapsBrowserApiKey,
                    origin: `${lastResolvedOrigin.lat},${lastResolvedOrigin.lng}`,
                    destination: `${restaurant.lat},${restaurant.lng}`,
                    mode: 'driving',
                });
                mapFrame.src = `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
                return;
            }

            const destination = `${restaurant.lat},${restaurant.lng}`;
            mapFrame.src = `https://www.google.com/maps?q=${encodeURIComponent(destination)}&z=15&output=embed`;
        })
        .catch((err) => {
            console.error('Fallback map config failed', err);
            const destination = `${restaurant.lat},${restaurant.lng}`;
            mapFrame.src = `https://www.google.com/maps?q=${encodeURIComponent(destination)}&z=15&output=embed`;
        });
}

async function getRestaurantDetails(placeId) {
    if (!placeId) return null;
    if (!placeDetailsPromiseCache.has(placeId)) {
        placeDetailsPromiseCache.set(
            placeId,
            apiRequest(`/api/restaurants/details?placeId=${encodeURIComponent(placeId)}`)
                .then((data) => data.place || null)
                .catch((err) => {
                    placeDetailsPromiseCache.delete(placeId);
                    throw err;
                })
        );
    }

    return placeDetailsPromiseCache.get(placeId);
}

async function ensureRouteForRestaurant(restaurant) {
    if (!restaurant || !lastResolvedOrigin) {
        return null;
    }

    const routeKey = [
        lastResolvedOrigin.lat,
        lastResolvedOrigin.lng,
        restaurant.placeId || 'fallback',
        restaurant.lat,
        restaurant.lng,
    ].join(':');

    if (!routePromiseCache.has(routeKey)) {
        const params = new URLSearchParams({
            originLat: String(lastResolvedOrigin.lat),
            originLng: String(lastResolvedOrigin.lng),
            travelMode: 'DRIVE',
        });

        if (restaurant.placeId) {
            params.set('placeId', restaurant.placeId);
        }
        if (Number.isFinite(restaurant.lat) && Number.isFinite(restaurant.lng)) {
            params.set('destinationLat', String(restaurant.lat));
            params.set('destinationLng', String(restaurant.lng));
        }

        routePromiseCache.set(
            routeKey,
            apiRequest(`/api/restaurants/route?${params.toString()}`)
                .then((data) => data.route || null)
                .catch((err) => {
                    routePromiseCache.delete(routeKey);
                    throw err;
                })
        );
    }

    try {
        return await routePromiseCache.get(routeKey);
    } catch (err) {
        console.warn('Route lookup failed', err.message);
        return null;
    }
}

async function loadPublicConfig() {
    if (!publicConfigPromise) {
        publicConfigPromise = apiRequest('/api/config/public')
            .catch((err) => {
                publicConfigPromise = null;
                throw err;
            });
    }

    return publicConfigPromise;
}

async function loadGoogleMaps() {
    if (window.google && window.google.maps) {
        return window.google.maps;
    }

    if (!googleMapsPromise) {
        googleMapsPromise = loadPublicConfig()
            .then((config) => {
                if (!config.googleMapsBrowserApiKey) {
                    return null;
                }

                return new Promise((resolve, reject) => {
                    const existing = document.getElementById('google-maps-js');
                    if (existing) {
                        existing.addEventListener('load', () => resolve(window.google.maps));
                        existing.addEventListener('error', reject);
                        return;
                    }

                    const script = document.createElement('script');
                    script.id = 'google-maps-js';
                    script.async = true;
                    script.src =
                        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
                            config.googleMapsBrowserApiKey
                        )}&v=weekly`;
                    script.addEventListener('load', () => resolve(window.google.maps));
                    script.addEventListener('error', reject);
                    document.head.appendChild(script);
                });
            })
            .catch((err) => {
                googleMapsPromise = null;
                throw err;
            });
    }

    return googleMapsPromise;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

async function fetchRestaurants(filters, uiSearchKey) {
    const hasFreshUiCachedResults =
        uiSearchKey &&
        lastUiSearchKey === uiSearchKey &&
        Array.isArray(lastSearchResults) &&
        lastSearchResults.length > 0 &&
        Date.now() - lastSearchAt < SEARCH_RESULT_CACHE_TTL_MS;

    if (hasFreshUiCachedResults) {
        return lastSearchResults;
    }

    const resolvedOrigin = await resolveCurrentOrigin(filters);
    if (!resolvedOrigin) {
        throw new Error('Could not determine your location. Please enter an address manually.');
    }

    lastResolvedOrigin = resolvedOrigin;

    const params = new URLSearchParams({
        lat: String(resolvedOrigin.lat),
        lng: String(resolvedOrigin.lng),
    });

    if (filters.cuisine && filters.cuisine !== 'any') {
        params.set('cuisine', filters.cuisine);
    }
    if (filters.distance) {
        params.set('maxDistance', String(filters.distance * 1000));
    }
    if (filters.prices && filters.prices.length > 0) {
        params.set('minPrice', String(Math.min(...filters.prices)));
        params.set('maxPrice', String(Math.max(...filters.prices)));
    }
    if (filters.openNow) {
        params.set('openNow', 'true');
    }

    const searchKey = params.toString();
    const hasFreshCachedResults =
        lastSearchKey === searchKey &&
        Array.isArray(lastSearchResults) &&
        lastSearchResults.length > 0 &&
        Date.now() - lastSearchAt < SEARCH_RESULT_CACHE_TTL_MS;

    if (hasFreshCachedResults) {
        return lastSearchResults;
    }

    try {
        const data = await apiRequest(`/api/restaurants/search?${searchKey}`);
        lastUiSearchKey = uiSearchKey || null;
        lastSearchKey = searchKey;
        lastSearchResults = data.restaurants || [];
        lastSearchAt = Date.now();

        return data.restaurants || [];
    } catch (err) {
        if (
            ((uiSearchKey && lastUiSearchKey === uiSearchKey) || lastSearchKey === searchKey) &&
            Array.isArray(lastSearchResults) &&
            lastSearchResults.length > 0
        ) {
            showToast('Using your last restaurant list while search refreshes.');
            return lastSearchResults;
        }

        throw err;
    }
}

async function resolveCurrentOrigin(filters) {
    if (locationIsAutoDetected && currentUserLoc) {
        return {
            lat: currentUserLoc.lat,
            lng: currentUserLoc.lng,
            displayName: document.getElementById('location-input').value || 'Current location',
            placeId: null,
        };
    }

    if (filters.location) {
        const coords = await geocodeAddress(filters.location);
        if (coords) {
            return coords;
        }
    }

    if (currentUserLoc) {
        return {
            lat: currentUserLoc.lat,
            lng: currentUserLoc.lng,
            displayName: document.getElementById('location-input').value || 'Current location',
            placeId: null,
        };
    }

    return null;
}

async function apiRequest(url, { method = 'GET', body, requiresAuth = false } = {}) {
    const headers = {};

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    if (requiresAuth) {
        if (!authToken) {
            throw new Error('Please log in first.');
        }

        headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const payload = await response
        .json()
        .catch(() => ({ error: `Request failed with status ${response.status}` }));

    if (!response.ok) {
        if (response.status === 401 && requiresAuth) {
            clearAuth();
        }

        throw new Error(payload.error || `Request failed with status ${response.status}`);
    }

    return payload;
}

function promptRequired(message) {
    const value = window.prompt(message, '');
    if (value === null) return null;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
