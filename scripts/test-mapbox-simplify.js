// Tests for GPS path simplification in shared/mapbox.js.
// Ensures mapboxStaticUrl() stays under Mapbox's ~8KB URL length limit
// even for long-distance activities (hours-long 1Hz GPS traces).
//
// Run: node scripts/test-mapbox-simplify.js

import assert from "node:assert/strict";
import {
  rdpSimplify,
  mapboxStaticUrl,
  encodePolyline,
} from "../shared/mapbox.js";

// --- rdpSimplify ---------------------------------------------------------

// Collinear points should collapse to just the endpoints.
{
  const line = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0, lng: 0.002 },
    { lat: 0, lng: 0.003 },
    { lat: 0, lng: 0.004 },
  ];
  const out = rdpSimplify(line, 1); // 1 meter tolerance
  assert.equal(out.length, 2, "collinear line should simplify to endpoints");
  assert.deepEqual(out[0], line[0]);
  assert.deepEqual(out[1], line[line.length - 1]);
}

// A sharp corner should be preserved.
{
  const lshape = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0, lng: 0.002 }, // corner
    { lat: 0.001, lng: 0.002 },
    { lat: 0.002, lng: 0.002 },
  ];
  const out = rdpSimplify(lshape, 1);
  assert.ok(out.length >= 3, `corner should be preserved (got ${out.length})`);
  // First and last must be preserved.
  assert.deepEqual(out[0], lshape[0]);
  assert.deepEqual(out[out.length - 1], lshape[lshape.length - 1]);
  // The corner (index 2) should appear somewhere in the output.
  const hasCorner = out.some(
    (p) => p.lat === 0 && Math.abs(p.lng - 0.002) < 1e-9,
  );
  assert.ok(hasCorner, "L-shape corner must be retained");
}

// Empty / tiny inputs are passed through safely.
{
  assert.deepEqual(rdpSimplify([], 1), []);
  assert.deepEqual(rdpSimplify([{ lat: 1, lng: 2 }], 1), [{ lat: 1, lng: 2 }]);
  const two = [
    { lat: 0, lng: 0 },
    { lat: 1, lng: 1 },
  ];
  assert.deepEqual(rdpSimplify(two, 1), two);
}

// --- mapboxStaticUrl: URL length under Mapbox's limit --------------------

const FAKE_TOKEN =
  "pk.eyJ1IjoidGVzdCIsImEiOiJjbGV4YW1wbGVleGFtcGxlZXhhbXBsZXgifQ.aAbBcCdDeEfFgGhHiIjJkK";

// Build a dense, wiggly 7200-point synthetic path (≈ 2h at 1Hz).
// Mix of long straight segments (which RDP can collapse) and high-frequency
// wiggles (which it cannot) — a realistic worst case.
function makeLongPath(n) {
  const path = [];
  let lat = 37.7749;
  let lng = -122.4194;
  for (let i = 0; i < n; i++) {
    // Drift roughly NE
    lat += 0.00002;
    lng += 0.00002;
    // Add small sinusoidal wiggle so RDP can't collapse to a line
    lat += Math.sin(i * 0.3) * 0.00001;
    lng += Math.cos(i * 0.25) * 0.00001;
    path.push({ lat, lng });
  }
  return path;
}

{
  const longPath = makeLongPath(7200);
  const url = mapboxStaticUrl(longPath, FAKE_TOKEN);
  assert.ok(url, "should return a URL for a long path");
  assert.ok(
    url.length <= 8192,
    `URL length ${url.length} exceeds Mapbox 8192-char limit`,
  );
  // Sanity: the URL should still look like a valid static-map request.
  assert.ok(url.startsWith("https://api.mapbox.com/styles/"));
  assert.ok(url.includes("path-5+9ffb00-0.85("));
  assert.ok(url.includes(`access_token=${FAKE_TOKEN}`));
}

// Extreme case: 20000 points should still fit.
{
  const hugePath = makeLongPath(20000);
  const url = mapboxStaticUrl(hugePath, FAKE_TOKEN);
  assert.ok(url.length <= 8192, `huge path URL length ${url.length} > 8192`);
}

// --- mapboxStaticUrl: short paths unchanged ------------------------------

// A short path (well under budget) should encode without simplification loss:
// every original point should round-trip through the URL intact.
{
  const shortPath = [
    { lat: 37.7749, lng: -122.4194 },
    { lat: 37.7750, lng: -122.4195 },
    { lat: 37.7751, lng: -122.4196 },
    { lat: 37.7752, lng: -122.4197 },
  ];
  const url = mapboxStaticUrl(shortPath, FAKE_TOKEN);
  const expectedEncoded = encodeURIComponent(encodePolyline(shortPath));
  assert.ok(
    url.includes(expectedEncoded),
    "short path should be encoded verbatim without simplification",
  );
}

// --- mapboxStaticUrl: guards -------------------------------------------

assert.equal(mapboxStaticUrl([], FAKE_TOKEN), null);
assert.equal(mapboxStaticUrl([{ lat: 0, lng: 0 }], FAKE_TOKEN), null);
assert.equal(mapboxStaticUrl([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], null), null);

console.log("mapbox simplify tests: OK");
