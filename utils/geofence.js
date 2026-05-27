/**
 * Geofence validation using the Haversine formula.
 *
 * Default office: Prem Industries India Limited
 * Coordinates:    28.6404991, 77.4557106
 * Radius:         200 metres
 */

const OFFICE_LAT = Number(process.env.OFFICE_LAT) || 28.6404991;
const OFFICE_LNG = Number(process.env.OFFICE_LNG) || 77.4557106;
const OFFICE_RADIUS = Number(process.env.OFFICE_RADIUS_METERS) || 200;

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

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
 * Check whether the supplied coordinates fall within the configured office radius.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{ allowed: boolean, distance: number, radius: number }}
 */
export function isWithinOffice(latitude, longitude) {
  const distance = Math.round(haversineDistance(latitude, longitude, OFFICE_LAT, OFFICE_LNG));
  return {
    allowed: distance <= OFFICE_RADIUS,
    distance,
    radius: OFFICE_RADIUS,
  };
}
