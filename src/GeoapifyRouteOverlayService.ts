import { loggedRequestUrl as requestUrl, logger } from "places-shared/utils";
import type * as GeoJSON from "geojson";
import { type IPlaceExtensionSettings } from "places-shared/settings";
import { geoapifyRateLimits } from "./GeoapifyRateLimits";
import { type DirectionsOverlayRequest, type IsochroneOverlayRequest, type RouteOverlayCapabilities, type RouteOverlayService, type RouteTravelMode, addRouteEndpointFeatures, addRouteMetricLabelFeatures, assertProviderApiKey, buildRouteLegMetrics, buildRouteLegProperties, buildRouteWaypointProperties, decorateIsochroneFeatureProperties, executeRateLimited, formatIsochroneFeatureName, formatProviderApiError, getIsochroneStyleColor, mapTravelMode } from "places-shared/services";
import { GEOAPIFY_MODES } from "./GeoapifySnapService";

function parseFeatureCollection(value: unknown): GeoJSON.FeatureCollection {
  if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'FeatureCollection' || !('features' in value)) {
    throw new Error('Geoapify returned an invalid GeoJSON feature collection');
  }
  const features: unknown = value.features;
  if (!Array.isArray(features)) {
    throw new Error('Geoapify returned an invalid GeoJSON feature collection');
  }
  const validFeatures = features.filter((feature: unknown): feature is GeoJSON.Feature =>
    typeof feature === 'object' && feature !== null && 'type' in feature && feature.type === 'Feature' && 'geometry' in feature
  );
  if (validFeatures.length !== features.length) {
    throw new Error('Geoapify returned an invalid GeoJSON feature');
  }
  return { type: 'FeatureCollection', features: validFeatures };
}

export class GeoapifyRouteOverlayService implements RouteOverlayService {
  constructor(private extensionSettings: IPlaceExtensionSettings) {}

  getProviderName(): string {
    return "geoapify";
  }

  getCapabilities(): RouteOverlayCapabilities {
    return {
      routeOptimization: false,
      distanceIsochrones: true,
      polygonIsochrones: true,
      trafficIsochrones: true,
      trafficDirections: true,
    };
  }

  async getDirectionsOverlay(request: DirectionsOverlayRequest): Promise<GeoJSON.FeatureCollection> {
    assertProviderApiKey(this.extensionSettings.apiKey, "Geoapify");
    if (request.optimize) {
      throw new Error("Geoapify directions optimization is not supported by the Places directions overlay yet. Geoapify exposes this through its separate Route Planner API, which uses a different route-planning request model.");
    }

    const features: GeoJSON.Feature[] = [];

    for (let index = 0; index < request.routes.length; index++) {
      const route = request.routes[index];
      if (route.length < 2) continue;

      const params = new URLSearchParams({
        waypoints: route.map((point) => `${point.latitude},${point.longitude}`).join("|"),
        mode: mapTravelMode(request.mode, GEOAPIFY_MODES),
        // Geoapify only applies traffic to driving routes.
        ...(request.traffic && request.mode === "drive" ? { traffic: "approximated" } : {}),
        apiKey: this.extensionSettings.apiKey ?? "",
      });

      const response = await executeRateLimited(geoapifyRateLimits, "directions", () => requestUrl({ url: `https://api.geoapify.com/v1/routing?${String(params)}`, throw: false }));
      if (response.status >= 400) {
        throw new Error(formatProviderApiError({
          provider: "Geoapify",
          operation: "routing",
          status: response.status,
          json: response.json,
          text: response.text,
          requestSummary: `${request.mode}, ${route.length} waypoint${route.length === 1 ? "" : "s"}`,
        }));
      }

      const collection = parseFeatureCollection(response.json);
      for (const feature of collection.features ?? []) {
        const routeFeature = this.decorateRouteFeature(feature, route, index, request.mode, request.style, request.name);
        features.push(routeFeature);
        await addRouteEndpointFeatures(features, routeFeature, request.waypointLabelTemplate);
        await addRouteMetricLabelFeatures(features, routeFeature, request.metricLabels, request.labelTemplate, request.legLabelTemplate);
      }
    }

    return { type: "FeatureCollection", features };
  }

  async getIsochroneOverlay(request: IsochroneOverlayRequest): Promise<GeoJSON.FeatureCollection> {
    assertProviderApiKey(this.extensionSettings.apiKey, "Geoapify");
    const features: GeoJSON.Feature[] = [];

    for (const center of request.centers) {
      for (let index = 0; index < request.ranges.length; index++) {
        const range = request.ranges[index];
        const params = new URLSearchParams({
          lat: String(center.latitude),
          lon: String(center.longitude),
          mode: mapTravelMode(request.mode, GEOAPIFY_MODES),
          type: request.rangeType === "time" ? "time" : "distance",
          range: request.rangeType === "time" ? String(range * 60) : String(range),
          // Geoapify only applies traffic to driving isolines.
          ...(request.traffic && request.mode === "drive" ? { traffic: "approximated" } : {}),
          apiKey: this.extensionSettings.apiKey ?? "",
        });

        const response = await executeRateLimited(geoapifyRateLimits, "isochrones", () => requestUrl({ url: `https://api.geoapify.com/v1/isoline?${String(params)}`, throw: false }));
        if (response.status >= 400) {
          throw new Error(formatProviderApiError({
            provider: "Geoapify",
            operation: "isoline",
            status: response.status,
            json: response.json,
            text: response.text,
            requestSummary: `${request.mode}, ${request.rangeType} range ${range}`,
          }));
        }

        const collection = parseFeatureCollection(response.json);
        for (const feature of collection.features ?? []) {
          features.push(this.decorateIsochroneFeature(feature, request.name ?? center.name, request.mode, request.rangeType, range, index, request.style));
        }
      }
    }

    return { type: "FeatureCollection", features };
  }

  private decorateRouteFeature(feature: GeoJSON.Feature, route: DirectionsOverlayRequest["routes"][number], index: number, mode: RouteTravelMode, style: DirectionsOverlayRequest["style"], requestName?: string): GeoJSON.Feature {
    const properties = feature.properties ?? {};
    // Geoapify routing feature totals: `distance` (meters) and `time` (seconds).
    const distanceMeters = Number(properties.distance ?? 0);
    const durationSeconds = Number(properties.time ?? 0);
    const legs = buildRouteLegMetrics(route, extractGeoapifyLegMetrics(properties));
    const propertyName: unknown = properties.name;

    return {
      ...feature,
      properties: {
        ...properties,
        name: typeof propertyName === 'string' ? propertyName : (requestName ? `${requestName} ${index + 1}` : `Route ${index + 1}`),
        provider: "geoapify",
        mode,
        route_index: index,
        ...buildRouteWaypointProperties(route),
        ...buildRouteLegProperties(legs),
        distance_meters: distanceMeters,
        distance_text: formatDistance(distanceMeters),
        duration_seconds: durationSeconds,
        duration_text: formatDuration(durationSeconds),
        stroke: style?.color ?? "#2563eb",
        "stroke-width": style?.strokeWidth ?? 5,
        "stroke-opacity": style?.strokeOpacity ?? 0.85,
      },
    };
  }

  private decorateIsochroneFeature(feature: GeoJSON.Feature, centerName: string | undefined, mode: RouteTravelMode, rangeType: IsochroneOverlayRequest["rangeType"], range: number, index: number, style: IsochroneOverlayRequest["style"]): GeoJSON.Feature {
    const color = getIsochroneStyleColor(index, style);
    return {
      ...feature,
      properties: decorateIsochroneFeatureProperties({
        ...(feature.properties ?? {}),
        name: formatIsochroneFeatureName(centerName, mode, rangeType === "time" ? `${range} min` : formatDistance(range)),
        provider: "geoapify",
        metric: rangeType,
        contour: range,
      }, color, { ...style, fillOpacity: style?.fillOpacity ?? Math.max(0.08, 0.28 - index * 0.04) }),
    };
  }

}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

// Geoapify Routing returns feature properties with a `legs[]` array; each leg has `distance`
// (meters) and `time` (seconds). https://apidocs.geoapify.com/docs/routing/
function extractGeoapifyLegMetrics(properties: GeoJSON.GeoJsonProperties): Array<{ distanceMeters: number; durationSeconds: number }> {
  const legs: unknown = properties?.legs;
  if (!Array.isArray(legs)) {
    logger.scope("Geoapify").debug("Routing response had no legs[] array", { propertyKeys: properties ? Object.keys(properties) : [] });
    return [];
  }
  return legs.map((leg) => {
    const value = leg && typeof leg === "object" ? leg as Record<string, unknown> : {};
    if (value.distance === undefined || value.time === undefined) {
      logger.scope("Geoapify").debug("Routing leg missing expected distance/time fields", { legKeys: Object.keys(value) });
    }
    return {
      distanceMeters: Number(value.distance ?? 0),
      durationSeconds: Number(value.time ?? 0),
    };
  });
}
