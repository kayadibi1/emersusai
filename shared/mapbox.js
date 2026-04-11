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
 * Build a Mapbox Static API URL for the given path.
 * Returns null if path is too short to render.
 */
export function mapboxStaticUrl(path, token, { width = 900, height = 500 } = {}) {
  if (!token || !Array.isArray(path) || path.length < 2) return null;
  const encoded = encodeURIComponent(encodePolyline(path));
  const pathSpec = `path-5+9ffb00-0.85(${encoded})`;
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pathSpec}/auto/${width}x${height}@2x?access_token=${token}`;
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
