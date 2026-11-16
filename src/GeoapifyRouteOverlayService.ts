import { GeoapifyRouteOverlayService as CoreGeoapifyRouteOverlayService } from 'places-geoapify/core';
import { loggedRouteHttpClient } from "places-shared/services";
import type { IPlaceExtensionSettings } from "places-shared/settings";

export class GeoapifyRouteOverlayService extends CoreGeoapifyRouteOverlayService {
  constructor(settings: IPlaceExtensionSettings) {
    super(settings, loggedRouteHttpClient);
  }
}
