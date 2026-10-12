import { MapsProvider, AutocompleteSuggestion, ResolvedPlace, ReverseGeocodeResult } from './types';

export class OlaMapsProvider implements MapsProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async autocomplete(
    input: string,
    locationBias?: { lat: number; lng: number },
    sessionToken?: string
  ): Promise<AutocompleteSuggestion[]> {
    if (!input || input.trim().length === 0) {
      return [];
    }

    let url = `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(input.trim())}&api_key=${encodeURIComponent(this.apiKey)}`;

    if (locationBias && typeof locationBias.lat === 'number' && typeof locationBias.lng === 'number') {
      url += `&location=${locationBias.lat},${locationBias.lng}`;
    }

    if (sessionToken && sessionToken.trim().length > 0) {
      url += `&session_token=${encodeURIComponent(sessionToken.trim())}`;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as any;
      const predictions = data?.predictions || [];

      return predictions.map((p: any) => ({
        placeId: p.place_id || p.reference || '',
        mainText: p.structured_formatting?.main_text || p.terms?.[0]?.value || p.description || '',
        secondaryText: p.structured_formatting?.secondary_text || '',
        description: p.description || '',
        lat: p.geometry?.location?.lat,
        lng: p.geometry?.location?.lng,
      }));
    } catch (_) {
      return [];
    }
  }

  async getPlaceDetails(
    placeId: string,
    sessionToken?: string
  ): Promise<ResolvedPlace | null> {
    if (!placeId || placeId.trim().length === 0) {
      return null;
    }

    let url = `https://api.olamaps.io/places/v1/details?place_id=${encodeURIComponent(placeId.trim())}&api_key=${encodeURIComponent(this.apiKey)}`;

    if (sessionToken && sessionToken.trim().length > 0) {
      url += `&session_token=${encodeURIComponent(sessionToken.trim())}`;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as any;
      const res = data?.result;
      if (!res) {
        return null;
      }

      let detectedCity = '';
      let detectedState = '';
      let detectedCountry = '';

      if (Array.isArray(res.address_components)) {
        for (const comp of res.address_components) {
          const types: string[] = comp.types || [];
          if (types.includes('locality') || types.includes('postal_town')) {
            detectedCity = comp.long_name || comp.short_name || detectedCity;
          } else if (!detectedCity && types.includes('administrative_area_level_2')) {
            detectedCity = comp.long_name || comp.short_name || detectedCity;
          }

          if (types.includes('administrative_area_level_1')) {
            detectedState = comp.long_name || comp.short_name || '';
          }

          if (types.includes('country')) {
            detectedCountry = comp.long_name || comp.short_name || '';
          }
        }
      }

      const formattedAddress = res.formatted_address || '';
      const name = res.name || formattedAddress.split(',')[0].trim() || 'Selected Area';
      const lat = Number(res.geometry?.location?.lat || 0);
      const lng = Number(res.geometry?.location?.lng || 0);

      return {
        placeId: res.place_id || placeId,
        name,
        formattedAddress,
        lat,
        lng,
        city: detectedCity,
        state: detectedState,
        country: detectedCountry,
      };
    } catch (_) {
      return null;
    }
  }

  async reverseGeocode(
    lat: number,
    lng: number
  ): Promise<ReverseGeocodeResult | null> {
    const url = `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${encodeURIComponent(this.apiKey)}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as any;
      const results = data?.results || [];
      if (results.length === 0) {
        return null;
      }

      const first = results[0];
      let detectedCity = '';
      let detectedState = '';
      let detectedCountry = '';
      let detectedArea = '';

      if (Array.isArray(first.address_components)) {
        for (const comp of first.address_components) {
          const types: string[] = comp.types || [];
          if (types.includes('sublocality') || types.includes('neighborhood') || types.includes('sublocality_level_1')) {
            detectedArea = comp.long_name || comp.short_name || detectedArea;
          }

          if (types.includes('locality') || types.includes('postal_town')) {
            detectedCity = comp.long_name || comp.short_name || detectedCity;
          } else if (!detectedCity && types.includes('administrative_area_level_2')) {
            detectedCity = comp.long_name || comp.short_name || detectedCity;
          }

          if (types.includes('administrative_area_level_1')) {
            detectedState = comp.long_name || comp.short_name || '';
          }

          if (types.includes('country')) {
            detectedCountry = comp.long_name || comp.short_name || '';
          }
        }
      }

      const formattedAddress = first.formatted_address || '';
      const name = detectedArea || first.name || formattedAddress.split(',')[0].trim() || 'Current Location';

      return {
        placeId: first.place_id || `geo_${lat}_${lng}`,
        name,
        formattedAddress,
        lat: Number(first.geometry?.location?.lat || lat),
        lng: Number(first.geometry?.location?.lng || lng),
        city: detectedCity,
        state: detectedState,
        country: detectedCountry,
      };
    } catch (_) {
      return null;
    }
  }
}
