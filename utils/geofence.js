/**
 * Geofence validation for attendance punches.
 *
 * Default office boundary: the four-corner area supplied for mobile check-in.
 * Override with OFFICE_POLYGON_COORDS as:
 *   lat,lng;lat,lng;lat,lng;lat,lng
 */

const DEFAULT_OFFICE_POLYGON = Object.freeze([
  { latitude: 28.641398, longitude: 77.456097 },
  { latitude: 28.64074, longitude: 77.455454 },
  { latitude: 28.640503, longitude: 77.455742 },
  { latitude: 28.64116, longitude: 77.456457 },
]);

const EARTH_RADIUS_METERS = 6_371_000;
const DEGREES_TO_METERS_LAT = 111_320;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function parseOfficePolygon(value) {
  if (!value) return DEFAULT_OFFICE_POLYGON;

  const points = String(value)
    .split(';')
    .map((pair) => {
      const [latitude, longitude] = pair.split(',').map((part) => Number(part.trim()));
      return { latitude, longitude };
    })
    .filter(
      (point) =>
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        point.latitude >= -90 &&
        point.latitude <= 90 &&
        point.longitude >= -180 &&
        point.longitude <= 180
    );

  return points.length >= 3 ? points : DEFAULT_OFFICE_POLYGON;
}

const OFFICE_POLYGON = Object.freeze(parseOfficePolygon(process.env.OFFICE_POLYGON_COORDS));
const OFFICE_CENTER = Object.freeze({
  latitude: OFFICE_POLYGON.reduce((sum, point) => sum + point.latitude, 0) / OFFICE_POLYGON.length,
  longitude: OFFICE_POLYGON.reduce((sum, point) => sum + point.longitude, 0) / OFFICE_POLYGON.length,
});

/**
 * Compute the distance in metres between two geographic points.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Convert a geographic point to a local metre-based plane around the office.
 * This is accurate enough for a small premises-sized polygon.
 */
function toLocalMeters(point) {
  const latScale = DEGREES_TO_METERS_LAT;
  const lngScale = DEGREES_TO_METERS_LAT * Math.cos(toRadians(OFFICE_CENTER.latitude));

  return {
    x: (point.longitude - OFFICE_CENTER.longitude) * lngScale,
    y: (point.latitude - OFFICE_CENTER.latitude) * latScale,
  };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function distanceToPolygon(latitude, longitude) {
  const point = toLocalMeters({ latitude, longitude });
  let nearest = Number.POSITIVE_INFINITY;

  for (let i = 0; i < OFFICE_POLYGON.length; i += 1) {
    const start = toLocalMeters(OFFICE_POLYGON[i]);
    const end = toLocalMeters(OFFICE_POLYGON[(i + 1) % OFFICE_POLYGON.length]);
    nearest = Math.min(nearest, distanceToSegment(point, start, end));
  }

  return nearest;
}

function pointOnBoundary(latitude, longitude) {
  return distanceToPolygon(latitude, longitude) <= 1;
}

function pointInPolygon(latitude, longitude) {
  if (pointOnBoundary(latitude, longitude)) return true;

  let inside = false;
  for (let i = 0, j = OFFICE_POLYGON.length - 1; i < OFFICE_POLYGON.length; j = i, i += 1) {
    const a = OFFICE_POLYGON[i];
    const b = OFFICE_POLYGON[j];
    const intersects =
      a.longitude > longitude !== b.longitude > longitude &&
      latitude <
        ((b.latitude - a.latitude) * (longitude - a.longitude)) / (b.longitude - a.longitude) +
          a.latitude;

    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Check whether the supplied coordinates fall within the configured office polygon.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{ allowed: boolean, distance: number, boundaryDistance: number, shape: string }}
 */
export function isWithinOffice(latitude, longitude) {
  const allowed = pointInPolygon(latitude, longitude);
  return {
    allowed,
    distance: Math.round(
      haversineDistance(latitude, longitude, OFFICE_CENTER.latitude, OFFICE_CENTER.longitude)
    ),
    boundaryDistance: Math.round(allowed ? 0 : distanceToPolygon(latitude, longitude)),
    shape: 'polygon',
  };
}
