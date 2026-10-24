import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayLocal, isValidRating, isValidDate, parseOverpass, parseNominatim, summarize, escapeHtml, distanceMeters,
} from '../js/util.js';

test('todayLocal uses local calendar date', () => {
  assert.equal(todayLocal(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('ratings are whole numbers 1-5 only', () => {
  for (const r of [1, 2, 3, 4, 5]) assert.ok(isValidRating(r));
  for (const r of [0, 6, 3.5, '4', null, undefined, NaN]) assert.ok(!isValidRating(r));
});

test('dates: real, past or today, not future', () => {
  const today = '2026-10-24';
  assert.ok(isValidDate('2026-10-24', today));
  assert.ok(isValidDate('2009-02-28', today));
  assert.ok(!isValidDate('2026-10-25', today));
  assert.ok(!isValidDate('2026-02-30', today));
  assert.ok(!isValidDate('10/24/2026', today));
  assert.ok(!isValidDate('', today));
});

test('parseOverpass maps tags, handles ways, dedupes and sorts by distance', () => {
  const origin = { lat: 40.0, lon: -75.0 };
  const json = {
    elements: [
      { type: 'way', id: 2, center: { lat: 40.01, lon: -75.0 }, tags: { name: 'Far Diner', amenity: 'restaurant' } },
      {
        type: 'node', id: 1, lat: 40.001, lon: -75.0,
        tags: {
          name: 'Near Cafe', amenity: 'cafe', cuisine: 'coffee_shop;bagel', 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Town', phone: '555',
        },
      },
      { type: 'node', id: 1, lat: 40.001, lon: -75.0, tags: { name: 'Near Cafe' } },
      { type: 'node', id: 3, lat: 40.0, lon: -75.0, tags: { amenity: 'restaurant' } }, // no name
    ],
  };
  const out = parseOverpass(json, origin);
  assert.deepEqual(out.map((p) => p.id), ['osm:node/1', 'osm:way/2']);
  assert.equal(out[0].cuisine, 'coffee shop, bagel');
  assert.equal(out[0].address, '12 Main St, Town');
  assert.equal(out[0].phone, '555');
  assert.ok(out[0].distance < out[1].distance);
});

test('parseNominatim maps search results', () => {
  const [p] = parseNominatim([{
    osm_type: 'node', osm_id: 9, lat: '42.36', lon: '-71.05', name: "Joe's", type: 'restaurant',
    address: { house_number: '1', road: 'Elm', city: 'Boston', state: 'MA' }, extratags: { cuisine: 'pizza' },
  }]);
  assert.equal(p.id, 'osm:node/9');
  assert.equal(p.address, '1 Elm, Boston, MA');
  assert.equal(p.cuisine, 'pizza');
  assert.equal(p.lat, 42.36);
});

test('summarize computes averages and last visit', () => {
  const [a, b] = summarize(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    [
      { restaurantId: 'a', date: '2025-01-01', rating: 3 },
      { restaurantId: 'a', date: '2026-03-01', rating: 5, photos: ['p'] },
    ],
  );
  assert.equal(a.avgRating, 4);
  assert.equal(a.visitCount, 2);
  assert.equal(a.lastVisit, '2026-03-01');
  assert.equal(a.coverPhoto, 'p');
  assert.equal(b.avgRating, null);
});

test('escapeHtml and distance', () => {
  assert.equal(escapeHtml('<b>"Tom\'s" & co</b>'), '&lt;b&gt;&quot;Tom&#39;s&quot; &amp; co&lt;/b&gt;');
  assert.ok(Math.abs(distanceMeters(0, 0, 0, 1) - 111195) < 10);
});
