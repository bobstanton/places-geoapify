import { buildGeoapifySearchUrl, getUnknownArrayProperty, geoapifyPlace, geoapifyBoundingBox, geoapifyFeatureToPlace, isGeoapifyFeature, isGeoapifyReverseResult } from "places-geoapify/core";
export { formatGeoapifyAddress } from "places-geoapify/core";
import { loggedRequestUrl as requestUrl, redactUrl } from "places-shared/utils";
import { Place } from "places-shared/place";
import { Coordinate, PlacesBoundingBox } from "places-shared/geo";
import { IPlaceExtensionSettings } from "places-shared/settings";
import { IPlacesService, lookupPlaceWithNearOrInQuery } from "places-shared/services";
import { logger } from "places-shared/utils";
export class GeoapifyApiService implements IPlacesService {
  constructor(public extensionSettings: IPlaceExtensionSettings) {}

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
      const url = buildGeoapifySearchUrl(query.trim(), this.extensionSettings.apiKey, {
        filter: `rect:${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`,
      });

      logger.scope('Places').debug('[Geoapify] lookupPlaceInBounds URL:', redactUrl(url));

      const response = await requestUrl({ url });

      if (response.status >= 400) {
        logger.scope('Places').error("Geoapify bounded search error:", response.status);

        return [];
      }

      const features = getUnknownArrayProperty(response.json, 'features');

      return features.map((feature) => geoapifyFeatureToPlace(feature)).filter((place): place is Place => place !== null);
    } catch (error) {
      logger.scope('Places').error("Geoapify bounded search error:", error);

      throw error;
    }
  }

  private async geocodeLocationBounds(location: string): Promise<PlacesBoundingBox | null> {
    const url = buildGeoapifySearchUrl(location, this.extensionSettings.apiKey, { limit: 1, country: this.extensionSettings.country });
    const response = await requestUrl({ url });

    if (response.status >= 400) {
      logger.scope('Places').error("Geoapify location geocode error:", response.status);

      return null;
    }

    const feature = getUnknownArrayProperty(response.json, 'features')[0];

    if (!isGeoapifyFeature(feature)) {
      return null;
    }

    const bounds = geoapifyBoundingBox(feature.bbox ?? feature.properties?.bbox);

    if (bounds?.isValid()) {
      return bounds;
    }

    const coords = feature.geometry?.coordinates;

    if (!coords || coords.length < 2) {
      return null;
    }

    return PlacesBoundingBox.fromCoordinates([{ longitude: coords[0], latitude: coords[1] }], 2.0);
  }

  private async executeSearch(searchText: string, proximityBias?: { longitude: number; latitude: number }): Promise<Place[]> {
    const url = buildGeoapifySearchUrl(searchText, this.extensionSettings.apiKey, { proximity: proximityBias, country: this.extensionSettings.country });

    const response = await requestUrl({ url });

    if (response.status >= 400) {
      logger.scope('Places').error("Geoapify Geocoding API error:", response.status);

      return [];
    }

    const features = getUnknownArrayProperty(response.json, 'features');

    return features.map((feature) => geoapifyFeatureToPlace(feature)).filter((place): place is Place => place !== null);
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
          if (!isGeoapifyReverseResult(result)) {
            return null;
          }

          const props = result;

          return {
            ...geoapifyPlace(props, result.lat ?? coordinate.latitude, result.lon ?? coordinate.longitude),
            state: typeof props.state === 'string' ? props.state : (typeof props.county === 'string' ? props.county : (typeof props.state_district === 'string' ? props.state_district : "")),
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
