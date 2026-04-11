// Mapbox helpers — polyline encoding, static API URL, privacy crop.
// Pure functions, no side effects.

const EARTH_RADIUS_M = 6371000;

/**
 * Haversine distance between two lat/lng points in meters.
 */
export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return EARTH_RADIUS_M * c;
}

/**
 * Google polyline encoding algorithm. Takes [{lat,lng},...] returns a string.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function encodePolyline(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  let lat = 0;
  let lng = 0;
  let out = "";

  for (const p of points) {
    const latE5 = Math.round(p.lat * 1e5);
    const lngE5 = Math.round(p.lng * 1e5);
    out += encodeSigned(latE5 - lat);
    out += encodeSigned(lngE5 - lng);
    lat = latE5;
    lng = lngE5;
  }
  return out;
}

function encodeSigned(num) {
  let sgn = num < 0 ? ~(num << 1) : num << 1;
  let out = "";
  while (sgn >= 0x20) {
    out += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  out += String.fromCharCode(sgn + 63);
  return out;
}

/**
 * Crop the start and end of a GPS path by `radiusM` meters (privacy).
 * Returns a new array. If fewer than 2 points remain, returns [].
 */
export function privacyCrop(path, radiusM = 100) {
  if (!Array.isArray(path) || path.length < 2) return [];
  if (!radiusM || radiusM <= 0) return path.slice();

  // Forward walk: drop points until cumulative distance > radiusM
  let startIdx = 0;
  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    cum += haversineMeters(path[i - 1], path[i]);
    if (cum > radiusM) {
      startIdx = i;
      break;
    }
  }

  // Backward walk: drop points from the end
  let endIdx = path.length - 1;
  cum = 0;
  for (let i = path.length - 2; i >= 0; i--) {
    cum += haversineMeters(path[i + 1], path[i]);
    if (cum > radiusM) {
      endIdx = i;
      break;
    }
  }

  if (endIdx <= startIdx + 1) return [];
  return path.slice(startIdx, endIdx + 1);
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Drops points whose perpendicular distance to the chord between their
 * neighbors is below `epsilonMeters`. Preserves the first and last points.
 *
 * Distances are computed in a local flat-meter projection anchored at the
 * first point. Accurate enough for GPS traces up to tens of kilometers.
 */
export function rdpSimplify(points, epsilonMeters) {
  if (!Array.isArray(points) || points.length < 3) {
    return Array.isArray(points) ? points.slice() : [];
  }
  const origin = points[0];
  const latRad = (origin.lat * Math.PI) / 180;
  const M_PER_DEG_LAT = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const projected = points.map((p) => ({
    x: (p.lng - origin.lng) * mPerDegLng,
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  }));

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative stack-based RDP to avoid recursion limits on long traces.
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const a = projected[lo];
    const b = projected[hi];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    let maxD2 = 0;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const p = projected[i];
      let d2;
      if (segLen2 === 0) {
        const ex = p.x - a.x;
        const ey = p.y - a.y;
        d2 = ex * ex + ey * ey;
      } else {
        // Perpendicular distance squared from p to line (a,b).
        const num = dy * p.x - dx * p.y + b.x * a.y - b.y * a.x;
        d2 = (num * num) / segLen2;
      }
      if (d2 > maxD2) {
        maxD2 = d2;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxD2 > epsilonMeters * epsilonMeters) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

// Mapbox Static Images API hard-caps request URLs at 8192 characters. We
// leave headroom for the host, style path, dimensions, and access token.
const MAPBOX_URL_BUDGET = 7800;

function buildMapboxUrl(path, token, width, height) {
  const encoded = encodeURIComponent(encodePolyline(path));
  const pathSpec = `path-5+9ffb00-0.85(${encoded})`;
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pathSpec}/auto/${width}x${height}@2x?access_token=${token}`;
}

/**
 * Build a Mapbox Static API URL for the given path.
 * Returns null if path is too short to render.
 *
 * For long paths (hours of 1Hz GPS), simplifies via RDP with a binary-searched
 * epsilon until the full URL fits inside Mapbox's 8192-char limit. Short paths
 * are encoded verbatim.
 */
export function mapboxStaticUrl(path, token, { width = 900, height = 500 } = {}) {
  if (!token || !Array.isArray(path) || path.length < 2) return null;

  let url = buildMapboxUrl(path, token, width, height);
  if (url.length <= MAPBOX_URL_BUDGET) return url;

  // Binary-search RDP epsilon (in meters) until the encoded URL fits. The
  // upper bound is intentionally large so even pathological inputs converge.
  let lo = 0.5;
  let hi = 20000;
  let best = null;
  for (let iter = 0; iter < 22; iter++) {
    const mid = (lo + hi) / 2;
    const cand = rdpSimplify(path, mid);
    if (cand.length < 2) {
      hi = mid;
      continue;
    }
    const candUrl = buildMapboxUrl(cand, token, width, height);
    if (candUrl.length <= MAPBOX_URL_BUDGET) {
      best = candUrl;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (best) return best;

  // Degenerate fallback: keep only the endpoints. Guaranteed to fit.
  return buildMapboxUrl([path[0], path[path.length - 1]], token, width, height);
}

/**
 * Compute total distance of a path in meters.
 */
export function pathTotalMeters(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i]);
  }
  return total;
}
