import { App } from "obsidian";
import { type UnitsSystem } from "places-shared/units";
import { IPlaceExtensionSettings } from "places-shared/settings";
import { MapLibreProviderBase, setGlRuntime, installMaplibreWorker } from "places-shared/obsidian/maplibre";
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerCode from "maplibre-worker-bundle";
import { GEOAPIFY_STYLES, geoapifyStyleUrl } from "places-geoapify/core";

const GEOAPIFY_STYLE_IDS = GEOAPIFY_STYLES.map((style) => style.value);

export class GeoapifyMapBlockProcessor extends MapLibreProviderBase {
  constructor(app: App, extensionSettings: IPlaceExtensionSettings, units: UnitsSystem, developerMode = false) {
    super(app, extensionSettings, units, developerMode);
    installMaplibreWorker(maplibregl, maplibreWorkerCode);
    setGlRuntime(maplibregl);
  }

  protected getStyleUrl(style: string): string | undefined {
    return geoapifyStyleUrl(style, this.extensionSettings.apiKey ?? '');
  }

  protected getSupportedStyles(): string[] {
    return GEOAPIFY_STYLE_IDS;
  }

  protected getProviderClassName(): string {
    return 'geoapify';
  }
}
