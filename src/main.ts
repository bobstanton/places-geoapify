import { App, Plugin } from "obsidian";
import { IPlaceExtensionSettings, IPlacesExtensionHostSettings } from "places-shared/settings";
import { IPlacePluginExtension, IPlacePluginExtensionExports, registerPlaceExtensionLifecycle, settingsOnlyExports, PLACES_EXTENSION_API_VERSION, type ExtensionSettingsGroup } from "places-shared/services";
import { Utilities , configureRequestLogging } from "places-shared/utils";
import { apiKeySettingItem, countrySettingItem, styleDropdownItem } from "places-shared/ui";
import { buildImageAlignment } from "places-maplibre-base";
import { GeoapifyApiService } from "./GeoapifyApiService";
import { PROVIDER_ICON } from "./provider-icon";
import { GeoapifyMapBlockProcessor } from "./GeoapifyMapBlockProcessor";
import { GeoapifyElevationService } from "./GeoapifyElevationService";
import { GeoapifyRouteOverlayService } from "./GeoapifyRouteOverlayService";
import { GeoapifySnapService } from "./GeoapifySnapService";
import "maplibre-gl/dist/maplibre-gl.css";
import "places-maplibre-base/styles.css";

const DEFAULT_SETTINGS: IPlaceExtensionSettings = {
  defaultStyle: "osm-bright"
};

const GEOAPIFY_STYLES: Array<{ value: string; name: string }> = [
  { value: "osm-bright", name: "OSM Bright" },
  { value: "osm-bright-grey", name: "OSM Bright Grey" },
  { value: "osm-bright-smooth", name: "OSM Bright Smooth" },
  { value: "klokantech-basic", name: "Klokantech Basic" },
  { value: "osm-liberty", name: "OSM Liberty" },
  { value: "maptiler-3d", name: "MapTiler 3D" },
  { value: "toner", name: "Toner" },
  { value: "toner-grey", name: "Toner Grey" },
  { value: "positron", name: "Positron" },
  { value: "positron-blue", name: "Positron Blue" },
  { value: "dark-matter", name: "Dark Matter" },
  { value: "dark-matter-brown", name: "Dark Matter Brown" },
];

export default class GeoapifyPlugin extends Plugin implements IPlacePluginExtension {

  onload() {
    registerPlaceExtensionLifecycle(this);
  }

  getPlaceExports(app: App, extensionSettings: IPlaceExtensionSettings, mainSettings: IPlacesExtensionHostSettings): IPlacePluginExtensionExports {
    configureRequestLogging(mainSettings.developerMode);
    Utilities.applyDefaults(extensionSettings, DEFAULT_SETTINGS);

    if (!extensionSettings.apiKey) {
      return settingsOnlyExports(this.settingsGroup());
    }

    const mapBlockProcessor = new GeoapifyMapBlockProcessor(app, extensionSettings, mainSettings.units, mainSettings.developerMode);
    const placesService = new GeoapifyApiService(extensionSettings);
    const elevationService = new GeoapifyElevationService(extensionSettings);
    const routeOverlayService = new GeoapifyRouteOverlayService(extensionSettings);

    const getStyleUrl = (style?: string): string => {
      const styleId = style || extensionSettings.defaultStyle;
      const apiKey = typeof extensionSettings.apiKey === 'string' ? extensionSettings.apiKey : '';
      return `https://maps.geoapify.com/v1/styles/${styleId}/style.json?apiKey=${apiKey}`;
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
      settingsGroup: this.settingsGroup()
    };
  }

  private settingsGroup(): ExtensionSettingsGroup {
    return {
      heading: "Geoapify",
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
