import { loggedRequestUrl as requestUrl } from "places-shared/utils";
import { Meters, meters } from "places-shared/units";
import { DistanceCalculator, Coordinate } from "places-shared/geo";
import { IPlaceExtensionSettings } from "places-shared/settings";
import { ElevationServiceBase, formatProviderApiError } from "places-shared/services";

function isElevationCoordinate(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 3 && value.every(entry => typeof entry === 'number');
}

// Elevation comes from the Geoapify Routing API with details=elevation.
export class GeoapifyElevationService extends ElevationServiceBase {
  constructor(extensionSettings: IPlaceExtensionSettings) {
    super(extensionSettings);
  }

  protected async getElevationForPoints(coordinates: Coordinate[]): Promise<Meters[]> {
    if (coordinates.length === 0) {
      return [];
    }

    const waypoints = coordinates.map(coord => `${coord.latitude},${coord.longitude}`).join('|');
    const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=walk&details=elevation&apiKey=${this.extensionSettings.apiKey}`;

    const response = await requestUrl({ url });

    if (response.status >= 400) {
      throw new Error(formatProviderApiError({
        provider: "Geoapify",
        operation: "routing",
        status: response.status,
        json: response.json,
        text: response.text
      }));
    }

    const data: unknown = response.json;
    const routeCoords = this.extractRouteCoordinates(data);

    if (!routeCoords) {
      throw new Error("Geoapify routing response contained no route geometry with elevations");
    }
    return coordinates.map(inputCoord => meters(this.findClosestElevation(inputCoord, routeCoords)));
  }

  private extractRouteCoordinates(value: unknown): number[][] | null {
    if (typeof value !== 'object' || value === null || !('features' in value)) return null;
    const features: unknown = value.features;
    if (!Array.isArray(features) || features.length === 0) return null;
    const feature: unknown = features[0];
    if (typeof feature !== 'object' || feature === null || !('geometry' in feature)) return null;
    const geometry: unknown = feature.geometry;
    if (typeof geometry !== 'object' || geometry === null || !('coordinates' in geometry)) return null;
    const routeCoordinates: unknown = geometry.coordinates;
    if (!Array.isArray(routeCoordinates)) return null;
    return routeCoordinates.every(isElevationCoordinate) ? routeCoordinates : null;
  }

  private findClosestElevation(inputCoord: Coordinate, routeCoords: number[][]): number {
    if (routeCoords.length === 0) return 0;

    let closestDistance = Infinity;
    let closestElevation = 0;

    for (const routeCoord of routeCoords) {

      if (routeCoord.length >= 3) {
        const distance = DistanceCalculator.haversineDistance(
          inputCoord.latitude, inputCoord.longitude,
          routeCoord[1], routeCoord[0]   // route uses [lng, lat] format
        ) * 1000;

        if (distance < closestDistance) {
          closestDistance = distance;
          closestElevation = routeCoord[2];
        }
      }
    }

    return closestElevation;
  }


  getProviderName(): string {
    return "geoapify";
  }

  protected getProviderDisplayName(): string {
    return "Geoapify";
  }

}
