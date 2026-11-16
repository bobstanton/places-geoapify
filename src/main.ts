import { App, Plugin } from "obsidian";
import { IPlaceExtensionSettings, IPlacesExtensionHostSettings } from "places-shared/settings";
import { IPlacePluginExtension, IPlacePluginExtensionExports, registerPlaceExtensionLifecycle, settingsOnlyExports, PLACES_EXTENSION_API_VERSION, type ExtensionSettingsGroup } from "places-shared/obsidian/services";
import { Utilities, configureRequestLogging } from "places-shared/utils";
import { apiKeySettingItem, countrySettingItem, settingsPageStatus, styleDropdownItem } from "places-shared/obsidian/ui";
import { buildImageAlignment } from "places-shared/obsidian/maplibre";
import { GeoapifyApiService } from "./GeoapifyApiService";
import { PROVIDER_ICON } from "./provider-icon";
import { GeoapifyMapBlockProcessor } from "./GeoapifyMapBlockProcessor";
import { GeoapifyElevationService } from "./GeoapifyElevationService";
import { GeoapifyRouteOverlayService } from "./GeoapifyRouteOverlayService";
import { GeoapifySnapService } from "./GeoapifySnapService";
import "maplibre-gl/dist/maplibre-gl.css";
import "places-shared/maplibre-styles.css";
import { GEOAPIFY_STYLES, geoapifyStyleUrl } from "places-geoapify/core";

const DEFAULT_SETTINGS: IPlaceExtensionSettings = {
  defaultStyle: "osm-bright"
};

export default class GeoapifyPlugin extends Plugin implements IPlacePluginExtension {
  onload() {
    registerPlaceExtensionLifecycle(this);
  }

  getPlaceExports(app: App, extensionSettings: IPlaceExtensionSettings, mainSettings: IPlacesExtensionHostSettings): IPlacePluginExtensionExports {
    configureRequestLogging(mainSettings.developerMode);
    Utilities.applyDefaults(extensionSettings, DEFAULT_SETTINGS);

    if (!extensionSettings.apiKey) {
      return settingsOnlyExports(this.settingsGroup(extensionSettings));
    }

    const mapBlockProcessor = new GeoapifyMapBlockProcessor(app, extensionSettings, mainSettings.units, mainSettings.developerMode);
    const placesService = new GeoapifyApiService(extensionSettings);
    const elevationService = new GeoapifyElevationService(extensionSettings);
    const routeOverlayService = new GeoapifyRouteOverlayService(extensionSettings);

    const getStyleUrl = (style?: string): string => {
      const styleId = style ?? extensionSettings.defaultStyle;
      const apiKey = typeof extensionSettings.apiKey === 'string' ? extensionSettings.apiKey : '';
      const url = geoapifyStyleUrl(styleId, apiKey);

      if (!url) throw new Error(`Unknown Geoapify map style "${styleId}". Choose a supported style in the block or in Places settings.`);

      return url;
    };

    return {
      apiVersion: PLACES_EXTENSION_API_VERSION,
      providers: [
        {
          name: "geoapify",
          mapDefaults: { style: extensionSettings.defaultStyle },
          styles: GEOAPIFY_STYLES.map(s => s.value),
          features: {
            poiDiscovery: true,
            vector: true,
            tileCache: true
          },
          map: mapBlockProcessor,
          imageAlignment: buildImageAlignment(app, 'Geoapify', getStyleUrl),
          geocoding: {
            service: placesService,
            icon: PROVIDER_ICON
          },
          elevation: elevationService,
          routeOverlay: routeOverlayService,
          snap: new GeoapifySnapService(extensionSettings)
        }
      ],
      settingsGroup: this.settingsGroup(extensionSettings)
    };
  }

  private settingsGroup(settings: IPlaceExtensionSettings): ExtensionSettingsGroup {
    return {
      heading: "Geoapify",
      ...settingsPageStatus(() => Boolean(settings.apiKey?.trim())),
      reloadOn: ["apiKey", "defaultStyle"],
      items: [
        apiKeySettingItem("Geoapify"),
        countrySettingItem(),
        styleDropdownItem({
          desc: "Default map style for Geoapify maps",
          styles: GEOAPIFY_STYLES,
          fallbackStyle: "osm-bright"
        }),
      ],
    };
  }
}
