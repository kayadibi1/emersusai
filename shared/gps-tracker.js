// GPS tracker — wraps watchPosition with jitter filter and pause support.
// Emits accepted points via onPoint callback.

import { haversineMeters } from "/shared/mapbox.js";

const MIN_POINT_DELTA_M = 3;       // ignore points closer than 3m
const MAX_REASONABLE_SPEED = 50;   // m/s — drop implausible jumps
const MIN_INTERVAL_MS = 3000;      // throttle to one accepted point per 3s

/**
 * Start watching position.
 * @param {Object} opts
 * @param {(point: {lat, lng, t, alt?}, acc?: number) => void} opts.onPoint
 * @param {(err: GeolocationPositionError) => void} opts.onError
 * @returns {GpsTrackerHandle}
 */
export function startGpsTracker({ onPoint, onError }) {
  let watchId = null;
  let paused = false;
  let lastAcceptedPoint = null;
  let lastAcceptedAt = 0;
  let totalDistanceM = 0;
  let pauseMarkerPending = false;

  function handlePosition(pos) {
    if (paused) {
      pauseMarkerPending = true;
      return;
    }

    const now = Date.now();
    const point = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      t: now,
    };
    if (pos.coords.altitude != null) {
      point.alt = pos.coords.altitude;
    }

    // Throttle
    if (now - lastAcceptedAt < MIN_INTERVAL_MS) return;

    if (lastAcceptedPoint) {
      const distM = haversineMeters(lastAcceptedPoint, point);
      const dtS = (now - lastAcceptedPoint.t) / 1000;

      // Jitter filter
      if (distM < MIN_POINT_DELTA_M) return;
      if (dtS > 0 && distM / dtS > MAX_REASONABLE_SPEED) return;

      // If we were paused and this is the first point after resume,
      // mark the point and DON'T add the jump distance
      if (pauseMarkerPending) {
        point.pause_resume = true;
        pauseMarkerPending = false;
      } else {
        totalDistanceM += distM;
      }
    }

    lastAcceptedPoint = point;
    lastAcceptedAt = now;
    onPoint(point, pos.coords.accuracy);
  }

  function handleError(err) {
    if (onError) onError(err);
  }

  function start() {
    if (!("geolocation" in navigator)) {
      handleError(new Error("Geolocation API unavailable"));
      return;
    }
    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    });
  }

  function stop() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function pause() {
    paused = true;
  }

  function resume() {
    paused = false;
  }

  function getTotalDistanceM() {
    return totalDistanceM;
  }

  start();

  return {
    stop,
    pause,
    resume,
    getTotalDistanceM,
    isPaused: () => paused,
  };
}

/**
 * Compute a rolling pace (seconds per km) over the last N seconds of a path.
 * Returns null if insufficient data.
 */
export function rollingPaceSecPerKm(path, windowSeconds = 30) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const now = path[path.length - 1].t;
  const cutoff = now - windowSeconds * 1000;

  // Find window start
  let startIdx = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].t <= cutoff) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === path.length - 1) return null;

  let distM = 0;
  for (let i = startIdx + 1; i < path.length; i++) {
    if (path[i].pause_resume) continue;
    distM += haversineMeters(path[i - 1], path[i]);
  }
  const elapsedS = (path[path.length - 1].t - path[startIdx].t) / 1000;
  if (distM < 5) return null; // too little data to estimate
  const secPerKm = elapsedS / (distM / 1000);
  return Math.round(secPerKm);
}

/**
 * Format pace in seconds per km as "M:SS" string.
 */
export function formatPace(secPerKm) {
  if (secPerKm == null || !isFinite(secPerKm)) return "--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
