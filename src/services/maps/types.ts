export interface AutocompleteSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
  description: string;
  lat?: number;
  lng?: number;
}

export interface ResolvedPlace {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  country?: string;
}

export interface ReverseGeocodeResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  country?: string;
}

export interface MapsProvider {
  autocomplete(
    input: string,
    locationBias?: { lat: number; lng: number },
    sessionToken?: string
  ): Promise<AutocompleteSuggestion[]>;

  getPlaceDetails(
    placeId: string,
    sessionToken?: string
  ): Promise<ResolvedPlace | null>;

  reverseGeocode(
    lat: number,
    lng: number
  ): Promise<ReverseGeocodeResult | null>;
}
