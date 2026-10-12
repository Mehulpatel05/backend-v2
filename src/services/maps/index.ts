import { MapsProvider } from './types';
import { OlaMapsProvider } from './ola_provider';

export * from './types';
export * from './ola_provider';

export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function getMapsProvider(
  apiKey?: string,
  providerName: string = 'ola'
): MapsProvider {
  const effectiveKey =
    apiKey ||
    (typeof process !== 'undefined' ? process.env.OLA_MAPS_API_KEY : '') ||
    '';

  if (providerName.toLowerCase() === 'ola' || effectiveKey) {
    return new OlaMapsProvider(effectiveKey);
  }

  return new OlaMapsProvider(effectiveKey);
}
