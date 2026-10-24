// Pure helpers (no DOM, no storage) so they can be unit tested in Node.

const pad = (n) => String(n).padStart(2, '0');

// Today's date as YYYY-MM-DD in the *local* time zone.
// (toISOString() would use UTC and can be off by a day in the evening.)
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isValidRating(r) {
  return Number.isInteger(r) && r >= 1 && r <= 5;
}

// A real calendar date in YYYY-MM-DD form, not in the future.
export function isValidDate(s, today = todayLocal()) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
  return s <= today; // lexical compare works for zero-padded ISO dates
}

export function formatDate(s, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Great-circle distance in meters.
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistance(m) {
  if (m == null) return '';
  const miles = m / 1609.344;
  return miles < 0.1 ? `${Math.round(m * 3.281)} ft` : `${miles.toFixed(1)} mi`;
}

const cleanCuisine = (c) => (c ? c.split(';').map((s) => s.trim().replace(/_/g, ' ')).filter(Boolean).join(', ') : '');

export function formatAddress(tags = {}) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'];
  const region = [tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(' ');
  return [street, city, region].filter(Boolean).join(', ');
}

// OpenStreetMap Overpass API response -> restaurant candidates sorted by distance.
export function parseOverpass(json, origin) {
  const seen = new Set();
  const out = [];
  for (const el of json?.elements ?? []) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!tags.name || lat == null || lon == null) continue;
    const id = `osm:${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: 'osm',
      name: tags.name,
      cuisine: cleanCuisine(tags.cuisine),
      kind: (tags.amenity ?? '').replace(/_/g, ' '),
      address: formatAddress(tags),
      phone: tags.phone ?? tags['contact:phone'] ?? '',
      website: tags.website ?? tags['contact:website'] ?? '',
      lat,
      lon,
      distance: origin ? distanceMeters(origin.lat, origin.lon, lat, lon) : null,
    });
  }
  return out.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
}

// OpenStreetMap Nominatim (jsonv2) search response -> restaurant candidates.
export function parseNominatim(json, origin) {
  return (Array.isArray(json) ? json : []).map((r) => {
    const a = r.address ?? {};
    const x = r.extratags ?? {};
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city ?? a.town ?? a.village ?? a.suburb ?? '';
    const region = [a.state, a.postcode].filter(Boolean).join(' ');
    return {
      id: `osm:${r.osm_type}/${r.osm_id}`,
      source: 'osm',
      name: r.name || (r.display_name ?? '').split(',')[0],
      cuisine: cleanCuisine(x.cuisine),
      kind: (r.type ?? '').replace(/_/g, ' '),
      address: [street, city, region].filter(Boolean).join(', ') || r.display_name || '',
      phone: x.phone ?? x['contact:phone'] ?? '',
      website: x.website ?? x['contact:website'] ?? '',
      lat,
      lon,
      distance: origin ? distanceMeters(origin.lat, origin.lon, lat, lon) : null,
    };
  }).filter((p) => p.name);
}

// Join restaurants with their visits: average rating, visit count, last visit.
export function summarize(restaurants, visits) {
  const byPlace = new Map();
  for (const v of visits) {
    if (!byPlace.has(v.restaurantId)) byPlace.set(v.restaurantId, []);
    byPlace.get(v.restaurantId).push(v);
  }
  return restaurants.map((r) => {
    const vs = (byPlace.get(r.id) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const avg = vs.length ? vs.reduce((s, v) => s + v.rating, 0) / vs.length : null;
    return {
      ...r,
      visitCount: vs.length,
      avgRating: avg,
      lastVisit: vs[0]?.date ?? null,
      coverPhoto: vs.find((v) => v.photos?.length)?.photos[0] ?? null,
    };
  });
}
