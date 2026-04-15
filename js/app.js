const AUTH_TOKEN_KEY = 'rrc_auth_token';
const AUTH_USER_KEY = 'rrc_auth_user';

let isGuest = true;
let authToken = null;
let currentUser = null;
let currentUserLoc = null;
let locationIsAutoDetected = false;

document.addEventListener('DOMContentLoaded', () => {
    hydrateAuth();
    initFilters();
    initAuthBar();
    initLocation();

    document.getElementById('btn-spin').addEventListener('click', onSpinClicked);
    document.getElementById('btn-auth-guest').addEventListener('click', onAuthGuestClicked);
    document.getElementById('btn-auth-user').addEventListener('click', onLoadFiltersClicked);
    document.getElementById('btn-itinerary').addEventListener('click', () => {
        const mapSection = document.getElementById('map-section');
        mapSection.classList.remove('hidden');
        setTimeout(() => mapSection.classList.add('show'), 10);
        mapSection.scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('btn-share').addEventListener('click', () => {
        if (window.currentWinner && typeof shareRestaurant === 'function') {
            shareRestaurant(window.currentWinner);
        } else {
            showToast('Spin the wheel first to share a restaurant.');
        }
    });

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

    const coordMatch = address.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
        return {
            lat: parseFloat(coordMatch[1]),
            lng: parseFloat(coordMatch[2]),
            displayName: address,
        };
    }

    const params = new URLSearchParams({ q: address });
    const data = await apiRequest(`/api/location/geocode?${params.toString()}`);
    return data.location || null;
}

async function onSpinClicked() {
    const button = document.getElementById('btn-spin');
    button.disabled = true;
    button.innerText = 'Fetching...';

    try {
        const restaurants = await fetchRestaurants(collectFiltersFromUi());

        if (!restaurants || restaurants.length === 0) {
            showToast('No restaurants match your filters. Try widening your search.');
            return;
        }

        window.ITEMS = restaurants;
        if (typeof drawPlaceholderWheel === 'function') drawPlaceholderWheel();

        button.innerText = 'Spinning...';
        const winner = await window.spin();

        if (winner) {
            displayWinner(winner);
        }
    } catch (err) {
        showToast(err.message || 'Error finding restaurants.');
        console.error(err);
    } finally {
        button.disabled = false;
        button.innerText = '✦ Spin the wheel';
    }
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
}

function setPriceButtonsUpTo(maxPrice) {
    document.querySelectorAll('.price-btn').forEach((button) => {
        const buttonValue = parseInt(button.dataset.val, 10);
        button.classList.toggle('active', buttonValue <= maxPrice);
    });
}

function displayWinner(restaurant) {
    window.currentWinner = restaurant;

    document.getElementById('res-name').innerText = restaurant.name;
    document.getElementById('res-rating').innerText = `${restaurant.rating || 'N/A'} ⭐`;

    const priceStr = Array(parseInt(restaurant.priceLevel, 10) || 1).fill('$').join('');
    document.getElementById('res-price').innerText = priceStr;
    document.getElementById('res-addr').innerText = restaurant.address || 'Address unavailable';

    refreshPostSpinPrompts();

    const resultSection = document.getElementById('result-display');
    resultSection.classList.remove('hidden');
    setTimeout(() => resultSection.classList.add('show'), 50);

    updateMapPreview(restaurant);

    if (restaurant.lat && restaurant.lng) {
        document.getElementById(
            'btn-open-itinerary'
        ).href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            `${restaurant.lat},${restaurant.lng}`
        )}`;
    }
}

function updateMapPreview(restaurant) {
    const mapFrame = document.getElementById('map-widget');
    if (!mapFrame || !restaurant || restaurant.lat === undefined || restaurant.lng === undefined) {
        return;
    }

    const lat = Number(restaurant.lat);
    const lng = Number(restaurant.lng);
    const delta = 0.01;
    const bbox = [
        lng - delta,
        lat - delta,
        lng + delta,
        lat + delta,
    ].join('%2C');

    mapFrame.src =
        `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}` +
        `&layer=mapnik&marker=${lat}%2C${lng}`;
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

async function fetchRestaurants(filters) {
    let lat = null;
    let lng = null;

    if (locationIsAutoDetected && currentUserLoc) {
        lat = currentUserLoc.lat;
        lng = currentUserLoc.lng;
    } else if (filters.location) {
        const coords = await geocodeAddress(filters.location);
        if (coords) {
            lat = coords.lat;
            lng = coords.lng;
        }

        if (!lat && currentUserLoc) {
            lat = currentUserLoc.lat;
            lng = currentUserLoc.lng;
        }
    } else if (currentUserLoc) {
        lat = currentUserLoc.lat;
        lng = currentUserLoc.lng;
    }

    if (lat === null || lng === null) {
        throw new Error('Could not determine your location. Please enter an address manually.');
    }

    const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
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

    const data = await apiRequest(`/api/restaurants/search?${params.toString()}`);
    return data.restaurants || [];
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
