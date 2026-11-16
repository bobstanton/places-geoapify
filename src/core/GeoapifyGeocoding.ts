import { scalarToString } from "places-shared/utils";
import type { Place } from "places-shared/place";
import { PlacesBoundingBox } from "places-shared/geo";
import { asRecord, nonBlankText, type GeocodingSearchResult } from "places-shared/services";

export function getUnknownArrayProperty(value: unknown, key: string): unknown[] {
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

export interface GeoapifyProperties {
  name?: string;
  formatted?: string;
  address_line1?: string;
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

interface GeoapifyReverseResult extends GeoapifyProperties {
  lat?: number;
  lon?: number;
}

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

export function geoapifyBoundingBox(value: GeoapifyBoundingBox | undefined): PlacesBoundingBox | null {
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

export function geoapifyFeatureToPlace(feature: unknown): Place | null {
  if (!isGeoapifyFeature(feature)) {
    return null;
  }

  const [longitude, latitude] = feature.geometry.coordinates;

  return geoapifyPlace(feature.properties, latitude, longitude);
}

export function geoapifyPlace(props: GeoapifyProperties, latitude: number, longitude: number): Place {
  return {
    name: nonBlankText(props.name) ?? nonBlankText(props.address_line1) ?? formatGeoapifyAddress(props),
    latitude,
    longitude,
    address: formatGeoapifyAddress(props),
    city: typeof props.city === 'string' ? props.city : (typeof props.municipality === 'string' ? props.municipality : ""),
    state: typeof props.state === 'string' ? props.state : (typeof props.state_district === 'string' ? props.state_district : ""),
    postalCode: typeof props.postcode === 'string' ? props.postcode : "",
    country: typeof props.country === 'string' ? props.country : "",
    website: "",
    tags: geoapifyTags(props),
    source: "geoapify",
    attribution: props.datasource?.attribution || "© Geoapify © OpenStreetMap contributors"
  };
}

export function isGeoapifyFeature(obj: unknown): obj is GeoapifyFeature {
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

export function isGeoapifyReverseResult(obj: unknown): obj is GeoapifyReverseResult {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const row = obj as GeoapifyReverseResult;

  return (row.lat === undefined || Number.isFinite(row.lat))
    && (row.lon === undefined || Number.isFinite(row.lon));
}

export function geoapifyTags(props: GeoapifyProperties): string[] {
  return [props.datasource?.sourcename, props.result_type, props.category, props.type, props.place_type]
    .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag));
}

export function buildGeoapifySearchUrl(query: string, apiKey: string, options: {
  country?: string; limit?: number; filter?: string; proximity?: { longitude: number; latitude: number }; format?: 'json';
} = {}): string {
  const params = new URLSearchParams({ text: query, limit: String(options.limit ?? 10), apiKey });

  if (options.proximity) params.set('bias', `proximity:${options.proximity.longitude},${options.proximity.latitude}`);

  if (options.filter) params.set('filter', options.filter);
  else if (options.country && typeof options.country === 'string') params.set('filter', `countrycode:${options.country.toLowerCase()}`);

  if (options.format) params.set('format', options.format);

  return `https://api.geoapify.com/v1/geocode/search?${String(params)}`;
}

export function readGeoapifySearchResults(value: unknown): GeocodingSearchResult[] {
  return getUnknownArrayProperty(value, 'results').flatMap((entry) => {
    const row = asRecord(entry);
    const lat = Number(row.lat);
    const lon = Number(row.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

    return [{
      name: nonBlankText(row.name) ?? nonBlankText(row.address_line1) ?? nonBlankText(row.formatted) ?? 'Place',
      lat, lon,
      address: nonBlankText(row.formatted),
      tags: [nonBlankText(row.category)].filter((tag): tag is string => tag !== undefined),
      source: 'geoapify',
    }];
  });
}
