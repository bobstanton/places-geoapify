import { loggedRequestUrl as requestUrl } from "places-shared/utils";
import { IPlaceExtensionSettings } from "places-shared/settings";
import { ISnapService, SnapRequest, SnapResult, toMatchedGeometry, executeRateLimited, formatProviderApiError, formatProviderResponseShapeError, mapTravelMode, toSnappedPoint, describeUnsupportedSnapOptions, shouldSendTimestamps } from "places-shared/services";
import { geoapifyRateLimits } from "./GeoapifyRateLimits";

export const GEOAPIFY_MODES = { walk: "walk", bike: "bicycle", drive: "drive" } as const;

interface GeoapifyMatchedWaypoint {
  location?: number[];
}

export class GeoapifySnapService implements ISnapService {
  constructor(private extensionSettings: IPlaceExtensionSettings) {}

  getProviderName(): string {
    return "geoapify";
  }

  describeUnsupportedRequest(request: SnapRequest): string[] {
    return describeUnsupportedSnapOptions("Geoapify", request, { timestamps: true });
  }

  getMaxPointCount(): number {
    return 1000;
  }

  async snapPoints(request: SnapRequest): Promise<SnapResult> {
    const maxPointCount = this.getMaxPointCount();
    if (request.points.length > maxPointCount) {
      throw new Error(`Geoapify map matching accepts at most ${maxPointCount} points; this track has ${request.points.length}. Simplify or split the track before snapping.`);
    }
    const sendTimes = shouldSendTimestamps(request);
    // The Map Matching API has no per-point radius parameter; request.radiusMeters is ignored.
    const response = await executeRateLimited(geoapifyRateLimits, "snap", () => requestUrl({
      url: `https://api.geoapify.com/v1/mapmatching?apiKey=${this.extensionSettings.apiKey ?? ""}`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        mode: mapTravelMode(request.mode, GEOAPIFY_MODES),
        waypoints: request.points.map((point) => ({
          location: [point.longitude, point.latitude],
          ...(sendTimes && point.time ? { timestamp: point.time.toISOString() } : {}),
        })),
      }),
      throw: false,
    }));

    if (response.status >= 400) {
      throw new Error(formatProviderApiError({
        provider: "Geoapify",
        operation: "map matching",
        status: response.status,
        json: response.json,
        text: response.text,
        requestSummary: `${request.mode}, ${request.points.length} points`,
      }));
    }

    const collection = response.json as { features?: Array<{ geometry?: { coordinates?: unknown }; properties?: { waypoints?: GeoapifyMatchedWaypoint[] } }> };
    const feature = collection.features?.[0];
    const waypoints = feature?.properties?.waypoints;
    if (!Array.isArray(waypoints) || waypoints.length !== request.points.length) {
      throw new Error(formatProviderResponseShapeError({
        provider: "Geoapify",
        operation: "map matching",
        expected: "matched waypoints",
        expectedCount: request.points.length,
        receivedCount: Array.isArray(waypoints) ? waypoints.length : 0,
        json: response.json,
        text: response.text,
        requestSummary: `${request.mode}, ${request.points.length} points`,
      }));
    }

    return {
      points: waypoints.map((waypoint, index) => toSnappedPoint(waypoint?.location, request.points[index])),
      geometry: toMatchedGeometry(feature?.geometry?.coordinates),
    };
  }
}
