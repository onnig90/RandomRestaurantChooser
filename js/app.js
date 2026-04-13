let isGuest = true;
let currentUserLoc = null;
let locationIsAutoDetected = false;
let mapPin = null;
let googleMap = null;

document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initAuthBar();
    initLocation();
    
    document.getElementById('btn-spin').addEventListener('click', onSpinClicked);
    document.getElementById('btn-itinerary').addEventListener('click', () => {
        const ms = document.getElementById('map-section');
        ms.classList.remove('hidden');
        setTimeout(() => ms.classList.add('show'), 10);
        ms.scrollIntoView({ behavior: 'smooth' });
    });
    
    document.getElementById('btn-share').addEventListener('click', () => {
        if (window.currentWinner && typeof shareRestaurant === 'function') {
            shareRestaurant(window.currentWinner);
        }
    });

    // Distance slider update
    document.getElementById('distance-input').addEventListener('input', (e) => {
        document.getElementById('distance-val').innerText = `${e.target.value} km`;
    });

    // Price toggle logic
    document.querySelectorAll('.price-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.classList.toggle('active');
        });
    });
});

function initAuthBar() {
    if (isGuest) {
        document.getElementById('btn-auth-guest').classList.remove('hidden');
        document.getElementById('btn-auth-user').classList.add('hidden');
    } else {
        document.getElementById('btn-auth-guest').classList.add('hidden');
        document.getElementById('btn-auth-user').classList.remove('hidden');
    }
}

function initFilters() {
    if (typeof getSharedRestaurant === 'function') {
        const shared = getSharedRestaurant();
        if (shared) {
            displayWinner(shared);
        }
    }
}

function initLocation() {
    const locInput = document.getElementById('location-input');

    // Mark location as manually edited when the user types in the field
    locInput.addEventListener('input', () => {
        locationIsAutoDetected = false;
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                currentUserLoc = { lat: latitude, lng: longitude };
                locationIsAutoDetected = true;

                if (window.google && google.maps && google.maps.Geocoder) {
                    const geocoder = new google.maps.Geocoder();
                    geocoder.geocode({ location: currentUserLoc }, (results, status) => {
                        if (status === 'OK' && results[0]) {
                            locInput.value = results[0].formatted_address;
                        } else {
                            locInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                        }
                    });
                } else {
                    locInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                }
            },
            (error) => {
                locInput.placeholder = 'Enter your address...';
                showToast("Geolocation denied. Please enter address manually.");
            }
        );
    } else {
        locInput.placeholder = 'Enter your address...';
    }
}

async function onSpinClicked() {
    const btn = document.getElementById('btn-spin');
    btn.disabled = true;
    btn.innerText = 'Fetching...';

    // 1. Gather filters
    const filters = {
        location: document.getElementById('location-input').value,
        cuisine: document.getElementById('cuisine-select').value,
        distance: parseInt(document.getElementById('distance-input').value, 10),
        prices: Array.from(document.querySelectorAll('.price-btn.active')).map(b => parseInt(b.dataset.val, 10)),
        openNow: document.getElementById('open-now-toggle').checked
    };

    // 2. Fetch from backend
    try {
        const restaurants = await fetchRestaurants(filters);
        
        if (!restaurants || restaurants.length === 0) {
            showToast("No restaurants match your filters — try widening your search");
            btn.disabled = false;
            btn.innerText = '✦ Spin the wheel';
            return;
        }

        // 3. Load items into wheel scope
        window.ITEMS = restaurants;
        if (typeof drawPlaceholderWheel === 'function') drawPlaceholderWheel();

        // 4. Trigger Spin Animation
        btn.innerText = 'Spinning...';
        const winner = await window.spin();
        
        if (winner) {
            displayWinner(winner);
        }
    } catch (err) {
        showToast("Error finding restaurants");
        console.error(err);
    }

    btn.disabled = false;
    btn.innerText = '✦ Spin the wheel';
}

function displayWinner(restaurant) {
    window.currentWinner = restaurant;
    
    // Update Result View text
    document.getElementById('res-name').innerText = restaurant.name;
    document.getElementById('res-rating').innerText = `${restaurant.rating || 'N/A'} ⭐`;
    
    const priceStr = Array(parseInt(restaurant.priceLevel) || 1).fill('$').join('');
    document.getElementById('res-price').innerText = priceStr;
    document.getElementById('res-addr').innerText = restaurant.address;
    
    // Auth specific prompts
    if (isGuest) {
        document.getElementById('guest-post-spin-prompt').classList.remove('hidden');
        document.getElementById('user-post-spin-prompt').classList.add('hidden');
    } else {
        document.getElementById('guest-post-spin-prompt').classList.add('hidden');
        document.getElementById('user-post-spin-prompt').classList.remove('hidden');
    }

    // Reveal result details
    const resSec = document.getElementById('result-display');
    resSec.classList.remove('hidden');
    setTimeout(() => resSec.classList.add('show'), 50);

    // Update Map
    const mapSec = document.getElementById('map-section');
    if (googleMap && restaurant.lat && restaurant.lng) {
        const pos = { lat: restaurant.lat, lng: restaurant.lng };
        googleMap.panTo(pos);
        if (mapPin) mapPin.setMap(null);
        mapPin = new google.maps.Marker({
            position: pos,
            map: googleMap,
            title: restaurant.name
        });
        
        const encAddr = encodeURIComponent(restaurant.address);
        document.getElementById('btn-open-itinerary').href = `https://www.google.com/maps/dir/?api=1&destination=${encAddr}`;
    }
}

window.initMapPlaceholder = function() {
    const mapDiv = document.getElementById('map-widget');
    if (!mapDiv) return;
    
    const defaultCenter = currentUserLoc || { lat: 40.7128, lng: -74.0060 };
    
    googleMap = new google.maps.Map(mapDiv, {
        center: defaultCenter,
        zoom: 14,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
            { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
            { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
            { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
        ]
    });
};

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.classList.add('hidden'), 300);
    }, 3000);
}

// Real backend integration
async function fetchRestaurants(filters) {
    let lat = null;
    let lng = null;

    // If the location was auto-detected (not manually edited), use the coords directly.
    // Only geocode when the user has typed a custom address.
    if (locationIsAutoDetected && currentUserLoc) {
        lat = currentUserLoc.lat;
        lng = currentUserLoc.lng;
    } else if (filters.location && window.google && google.maps && google.maps.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const results = await new Promise(resolve => {
            geocoder.geocode({ address: filters.location }, (res, status) => {
                resolve(status === 'OK' ? res : null);
            });
        });
        if (results && results[0]) {
            lat = results[0].geometry.location.lat();
            lng = results[0].geometry.location.lng();
        }
        // Geocode failed — fall back to last known GPS coords
        if (!lat && currentUserLoc) {
            lat = currentUserLoc.lat;
            lng = currentUserLoc.lng;
        }
    } else if (currentUserLoc) {
        lat = currentUserLoc.lat;
        lng = currentUserLoc.lng;
    }

    if (!lat || !lng) {
        throw new Error("Could not determine your location. Please enter an address manually.");
    }

    const params = new URLSearchParams({ lat, lng });
    if (filters.cuisine && filters.cuisine !== 'any') {
        params.set('cuisine', filters.cuisine);
    }
    if (filters.distance) {
        params.set('maxDistance', filters.distance * 1000); // km to meters
    }
    if (filters.prices && filters.prices.length > 0) {
        params.set('minPrice', Math.min(...filters.prices));
        params.set('maxPrice', Math.max(...filters.prices));
    }
    if (filters.openNow) {
        params.set('openNow', 'true');
    }

    const res = await fetch(`/api/restaurants/search?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch restaurants");

    const data = await res.json();
    return data.restaurants || [];
}
