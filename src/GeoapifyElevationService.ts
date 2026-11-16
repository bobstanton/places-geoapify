import { loggedRequestUrl as requestUrl } from "places-shared/utils";
import { type Meters, meters } from "places-shared/units";
import type { Coordinate } from "places-shared/geo";
import type { IPlaceExtensionSettings } from "places-shared/settings";
import { ElevationServiceBase, formatProviderApiError } from "places-shared/services";
import { getUnknownArrayProperty } from "places-geoapify/core";

export class GeoapifyElevationService extends ElevationServiceBase {
  constructor(settings: IPlaceExtensionSettings) {
    super(settings);
  }

  protected async getElevationForPoints(coordinates: Coordinate[]): Promise<Meters[]> {
    const elevations: Meters[] = [];

    for (let offset = 0; offset < coordinates.length; offset += 1000) {
      const batch = coordinates.slice(offset, offset + 1000);
      const params = new URLSearchParams({ apiKey: this.extensionSettings.apiKey ?? '' });
      const response = await requestUrl({
        url: `https://api.geoapify.com/v1/geodata/elevation?${String(params)}`,
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({
          locations: batch.map(point => [point.longitude, point.latitude]),
          format: 'json', units: 'metric',
        }),
        throw: false,
      });

      if (response.status >= 400) {
        throw new Error(formatProviderApiError({
          provider: 'Geoapify', operation: 'elevation', status: response.status,
          json: response.json, text: response.text,
        }));
      }

      const results = getUnknownArrayProperty(response.json, 'results');

      if (results.length !== batch.length) {
        throw new Error(`Geoapify returned ${results.length} elevations for ${batch.length} locations`);
      }

      for (const [index, result] of results.entries()) {
        const elevation: unknown = typeof result === 'object' && result !== null && 'elevation' in result
          ? result.elevation : undefined;

        if (typeof elevation !== 'number' || !Number.isFinite(elevation)) {
          throw new Error(`Geoapify returned no elevation for point ${offset + index + 1}`);
        }

        elevations.push(meters(elevation));
      }
    }

    return elevations;
  }

  getProviderName(): string {
    return 'geoapify';
  }

  protected getProviderDisplayName(): string {
    return 'Geoapify';
  }
}
