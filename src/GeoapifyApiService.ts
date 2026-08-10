import { scalarToString, loggedRequestUrl as requestUrl } from "places-shared/utils";
import { Place } from "places-shared/place";
import { Coordinate, PlacesBoundingBox } from "places-shared/geo";
import { IPlaceExtensionSettings } from "places-shared/settings";
import { IPlacesService, lookupPlaceWithNearOrInQuery } from "places-shared/services";
import { logger } from "places-shared/utils";
import { GeocoderAutocomplete, type CountyCode } from '@geoapify/geocoder-autocomplete';

function getUnknownArrayProperty(value: unknown, key: string): unknown[] {
  if (typeof value !== 'object' || value === null || !(key in value)) return [];
  const property: unknown = (value as Record<string, unknown>)[key];
  return Array.isArray(property) ? property : [];
}

interface GeoapifyFeature {
  geometry: {
    coordinates: number[];
  };
  bbox?: GeoapifyBoundingBox;
  properties: GeoapifyProperties;
}

type GeoapifyBoundingBox = number[] | {
  lon1?: number;
  lat1?: number;
  lon2?: number;
  lat2?: number;
  minLon?: number;
  minLat?: number;
  maxLon?: number;
  maxLat?: number;
};

interface GeoapifyProperties {
  name?: string;
  formatted?: string;
  housenumber?: unknown;
  street?: unknown;
  suburb?: unknown;
  city?: unknown;
  municipality?: unknown;
  state?: unknown;
  state_district?: unknown;
  county?: unknown;
  postcode?: unknown;
  country?: unknown;
  datasource?: {
    sourcename?: string;
    attribution?: string;
  };
  result_type?: string;
  category?: string;
  type?: string;
  place_type?: string;
  bbox?: GeoapifyBoundingBox;
}

interface GeoapifyReverseResult {
  lat?: number;
  lon?: number;
  properties?: GeoapifyProperties;
}

// Geoapify types most address fields as unknown and omits the ones it has no
// value for. scalarToString yields "" for non-scalar values.
export function formatGeoapifyAddress(props: GeoapifyProperties): string {
  const firstOf = (...keys: Array<keyof GeoapifyProperties>): string => {
    for (const key of keys) {
      const text = scalarToString(props[key]).trim();
      if (text) return text;
    }
    return "";
  };

  const houseNumber = firstOf("housenumber");
  const street = firstOf("street");
  const city = firstOf("city", "municipality");
  const suburb = firstOf("suburb");

  const parts = [
    houseNumber && street ? `${houseNumber} ${street}` : street,
    suburb === city ? "" : suburb,
    city,
    firstOf("state", "state_district"),
    firstOf("postcode"),
    firstOf("country"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : scalarToString(props.formatted);
}

export class GeoapifyApiService implements IPlacesService {
  extensionSettings: IPlaceExtensionSettings;
  private geocoder: GeocoderAutocomplete;

  constructor(extensionSettings: IPlaceExtensionSettings) {
    this.extensionSettings = extensionSettings;
    
    this.geocoder = new GeocoderAutocomplete(createDiv(), this.extensionSettings.apiKey);
    
    if (this.extensionSettings.country) {
      this.geocoder.addFilterByCountry([this.extensionSettings.country as CountyCode]);
    }
  }

  async lookupPlace(query: string): Promise<Place[]> {
    if (!this.extensionSettings.apiKey) {
      return [];
    }

    return lookupPlaceWithNearOrInQuery(query, {
      search: (searchText, proximity) => this.executeSearch(searchText, proximity),
      geocodeLocation: async (location) => {
        const bounds = await this.geocodeLocationBounds(location);
        return bounds ? { bounds } : null;
      },
      searchInBounds: (searchText, bounds) => this.lookupPlaceInBounds(searchText, bounds),
      filterBoundedResults: true
    });
  }

  async lookupPlaceInBounds(query: string, bounds: PlacesBoundingBox): Promise<Place[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    if (!this.extensionSettings.apiKey) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        text: query.trim(),
        limit: '10',
        apiKey: this.extensionSettings.apiKey,
        filter: "rect:" + bounds.minLng + "," + bounds.minLat + "," + bounds.maxLng + "," + bounds.maxLat
      });

      const url = `https://api.geoapify.com/v1/geocode/search?${String(params)}`;
      logger.scope('Places').debug('[Geoapify] lookupPlaceInBounds URL:', url);

      const response = await requestUrl({ url });

      if (response.status >= 400) {
        logger.scope('Places').error("Geoapify bounded search error:", response.status);
        return [];
      }

      const features = getUnknownArrayProperty(response.json, 'features');
      return features.map((feature) => this.convertToPlace(feature)).filter((place): place is Place => place !== null);
    } catch (error) {
      logger.scope('Places').error("Geoapify bounded search error:", error);
      throw error;
    }
  }

  private async geocodeLocationBounds(location: string): Promise<PlacesBoundingBox | null> {
    const params = new URLSearchParams({
      text: location,
      limit: '1',
      apiKey: this.extensionSettings.apiKey
    });

    if (this.extensionSettings.country && typeof this.extensionSettings.country === 'string') {
      params.append('filter', "countrycode:" + this.extensionSettings.country.toLowerCase());
    }

    const response = await requestUrl({ url: `https://api.geoapify.com/v1/geocode/search?${String(params)}` });

    if (response.status >= 400) {
      logger.scope('Places').error("Geoapify location geocode error:", response.status);
      return null;
    }

    const feature = getUnknownArrayProperty(response.json, 'features')[0];
    if (!this.isGeoapifyFeature(feature)) {
      return null;
    }

    const bounds = this.extractBoundingBox(feature.bbox ?? feature.properties?.bbox);
    if (bounds?.isValid()) {
      return bounds;
    }

    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) {
      return null;
    }

    return PlacesBoundingBox.fromCoordinates([{ longitude: coords[0], latitude: coords[1] }], 2.0);
  }

  private extractBoundingBox(value: GeoapifyBoundingBox | undefined): PlacesBoundingBox | null {
    if (!value) {
      return null;
    }

    if (Array.isArray(value) && value.length >= 4 && value.every((item) => typeof item === 'number')) {
      const [minLng, minLat, maxLng, maxLat] = value;
      return new PlacesBoundingBox(minLat, minLng, maxLat, maxLng);
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      const minLng = value.lon1 ?? value.minLon;
      const minLat = value.lat1 ?? value.minLat;
      const maxLng = value.lon2 ?? value.maxLon;
      const maxLat = value.lat2 ?? value.maxLat;

      if ([minLng, minLat, maxLng, maxLat].every((item) => typeof item === 'number')) {
        return new PlacesBoundingBox(minLat, minLng, maxLat, maxLng);
      }
    }

    return null;
  }

  private async executeSearch(searchText: string, proximityBias?: { longitude: number; latitude: number }): Promise<Place[]> {
    const params = new URLSearchParams({
      text: searchText,
      limit: '10',
      apiKey: this.extensionSettings.apiKey
    });

    if (proximityBias) {
      params.append('bias', "proximity:" + proximityBias.longitude + "," + proximityBias.latitude);
    }

    if (this.extensionSettings.country && typeof this.extensionSettings.country === 'string') {
      params.append('filter', "countrycode:" + this.extensionSettings.country.toLowerCase());
    }

    const paramsString = String(params);
    const url = `https://api.geoapify.com/v1/geocode/search?${paramsString}`;

    const response = await requestUrl({ url });

    if (response.status >= 400) {
      logger.scope('Places').error("Geoapify Geocoding API error:", response.status);
      return [];
    }

    const features = getUnknownArrayProperty(response.json, 'features');
    return features.map((feature) => this.convertToPlace(feature)).filter((place): place is Place => place !== null);
  }


  private convertToPlace(feature: unknown): Place | null {
    if (!this.isGeoapifyFeature(feature)) {
      return null;
    }

    const [longitude, latitude] = feature.geometry.coordinates;
    const props = feature.properties;

    return {
      name: props.name || "",
      latitude,
      longitude,
      address: formatGeoapifyAddress(props),
      city: typeof props.city === 'string' ? props.city : (typeof props.municipality === 'string' ? props.municipality : ""),
      state: typeof props.state === 'string' ? props.state : (typeof props.state_district === 'string' ? props.state_district : ""),
      postalCode: typeof props.postcode === 'string' ? props.postcode : "",
      country: typeof props.country === 'string' ? props.country : "",
      website: "",
      tags: this.extractTags(props),
      source: "geoapify",
      attribution: props.datasource?.attribution || "© Geoapify © OpenStreetMap contributors"
    };
  }

  private isGeoapifyFeature(obj: unknown): obj is GeoapifyFeature {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const feature = obj as Partial<GeoapifyFeature>;
    return Boolean(
      feature.properties
      && typeof feature.properties === 'object'
      && feature.geometry
      && typeof feature.geometry === 'object'
      && Array.isArray(feature.geometry.coordinates)
      && feature.geometry.coordinates.length >= 2
      && typeof feature.geometry.coordinates[0] === 'number'
      && typeof feature.geometry.coordinates[1] === 'number'
    );
  }

  private isGeoapifyReverseResult(obj: unknown): obj is GeoapifyReverseResult {
    return typeof obj === 'object' && obj !== null;
  }


  private extractTags(props: GeoapifyProperties): string[] {
    const tags: string[] = [];
    
    if (props.datasource?.sourcename) {
      tags.push(props.datasource.sourcename);
    }
    
    if (props.result_type) {
      tags.push(props.result_type);
    }
    
    if (props.category) {
      tags.push(props.category);
    }
    
    if (props.type) {
      tags.push(props.type);
    }

    if (props.place_type) {
      tags.push(props.place_type);
    }

    return tags.filter(tag => tag && typeof tag === 'string');
  }

  async lookupPlaceByCoordinates(coordinate: Coordinate): Promise<Place[]> {
    if (!this.extensionSettings.apiKey) {
      return [];
    }

    try {
      const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${coordinate.latitude}&lon=${coordinate.longitude}&apiKey=${this.extensionSettings.apiKey}&format=json&limit=10&type=amenity`;
      
      const response = await requestUrl({ url });
      
      if (response.status >= 400) {
        logger.scope('Places').error("Geoapify reverse geocoding API error:", response.status);
        return [];
      }
      
      const results = getUnknownArrayProperty(response.json, 'results');

      if (results.length > 0) {
        return results.map((result): Place | null => {
          if (!this.isGeoapifyReverseResult(result)) {
            return null;
          }
          const props = result.properties || {};

          return {
            name: props.name || "",
            latitude: result.lat || coordinate.latitude,
            longitude: result.lon || coordinate.longitude,
            address: formatGeoapifyAddress(props),
            city: typeof props.city === 'string' ? props.city : (typeof props.municipality === 'string' ? props.municipality : ""),
            state: typeof props.state === 'string' ? props.state : (typeof props.county === 'string' ? props.county : (typeof props.state_district === 'string' ? props.state_district : "")),
            postalCode: typeof props.postcode === 'string' ? props.postcode : "",
            country: typeof props.country === 'string' ? props.country : "",
            website: "",
            tags: this.extractTags(props),
            source: "geoapify",
            attribution: props.datasource?.attribution || "© Geoapify © OpenStreetMap contributors"
          };
        }).filter((place: Place | null): place is Place => {
          return place !== null && !place.name.includes("Unnamed Location") && place.name.trim() !== "";
        });
      }
      
      return [];
    } catch (error) {
      logger.scope('Places').error("Geoapify reverse geocoding error:", error);
      throw error;
    }
  }
}
