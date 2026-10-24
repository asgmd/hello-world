// Restaurant lookup via OpenStreetMap (free, no API key needed).
import { parseOverpass, parseNominatim } from './util.js';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const FOOD = 'restaurant|cafe|fast_food|bar|pub|ice_cream|food_court|biergarten';

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device does not support location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Location permission was denied. Allow location for this site, or search by name instead.'
        : 'Could not get your location. Try again, or search by name instead.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

export async function nearby({ lat, lon }, radius = 1000) {
  const query = `[out:json][timeout:20];nwr["amenity"~"^(${FOOD})$"]["name"](around:${radius},${lat},${lon});out tags center 300;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }) });
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      return parseOverpass(await res.json(), { lat, lon }).slice(0, 60);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Could not load nearby restaurants. ${lastErr?.message ?? ''}`.trim());
}

// Search anywhere by name (and optionally city), e.g. "Joe's Pizza, Boston".
export async function search(q, origin) {
  const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', extratags: '1', limit: '15' });
  if (origin) {
    // Prefer (but don't restrict to) results within ~50 km of the family.
    const d = 0.5;
    params.set('viewbox', [origin.lon - d, origin.lat + d, origin.lon + d, origin.lat - d].join(','));
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return parseNominatim(await res.json(), origin);
}
