import { App, Platform } from "obsidian";
import { type UnitsSystem } from "places-shared/units";
import { TileCache } from "places-shared/map";
import { IPlaceExtensionSettings, type ResolvedMapConfig } from "places-shared/settings";
import { logger, loggedRequestUrl as requestUrl } from "places-shared/utils";
import { MapLibreProviderBase, setGlRuntime, installMaplibreWorker } from "places-maplibre-base";
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import maplibreWorkerCode from "maplibre-worker-bundle";

const GEOAPIFY_STYLES = [
  'osm-bright',
  'osm-bright-grey',
  'osm-bright-smooth',
  'klokantech-basic',
  'osm-liberty',
  'osm-carto',
  'positron',
  'positron-blue',
  'dark-matter',
  'dark-matter-brown',
  'dark-matter-dark-grey',
  'dark-matter-purple',
  'dark-matter-yellow'
];

// Obsidian mobile cannot reliably fetch Geoapify style, TileJSON, and vector
// tile resources directly from MapLibre. The mobile path resolves the style
// through requestUrl() and rewrites runtime tile URLs to this protocol.
const GEOAPIFY_PROTOCOL = 'geoapify-tile';

export class GeoapifyMapBlockProcessor extends MapLibreProviderBase {
  private static protocolRegistered = false;

  constructor(app: App, extensionSettings: IPlaceExtensionSettings, units: UnitsSystem, developerMode = false) {
    super(app, extensionSettings, units, developerMode);
    installMaplibreWorker(maplibregl, maplibreWorkerCode);
    setGlRuntime(maplibregl);
  }

protected getStyleUrl(style: string): string | undefined {
    return this.buildStyleUrl(style);
  }

  protected getSupportedStyles(): string[] {
    return GEOAPIFY_STYLES;
  }

  protected getProviderClassName(): string {
    return 'geoapify';
  }


  protected override async prepareStyle(blockSettings: ResolvedMapConfig): Promise<string | StyleSpecification | undefined> {
    const styleUrl = this.buildStyleUrl(blockSettings.style);
    if (!styleUrl) return undefined;
    if (!Platform.isMobileApp) return super.prepareStyle(blockSettings);

    this.ensureGeoapifyProtocol();

    try {
      logger.scope('Geoapify').debug('Mobile: starting style pre-fetch');
      const styleSpec = await this.fetchAndResolveStyle(styleUrl);
      logger.scope('Geoapify').debug('Mobile: style pre-fetch complete, initialising map');
      return styleSpec;
    } catch (e) {
      logger.scope('Geoapify').error('Mobile style pre-fetch failed, falling back to URL', String(e));
      return styleUrl;
    }
  }

  private buildStyleUrl(style: string): string | undefined {
    const selectedStyle = style;
    const apiKey = this.extensionSettings.apiKey;
    if (!GEOAPIFY_STYLES.includes(selectedStyle)) return undefined;
    return `https://maps.geoapify.com/v1/styles/${selectedStyle}/style.json?apiKey=${apiKey}`;
  }

  private ensureGeoapifyProtocol(): void {
    if (GeoapifyMapBlockProcessor.protocolRegistered) return;
    GeoapifyMapBlockProcessor.protocolRegistered = true;

    this.addMapLibreProtocol(GEOAPIFY_PROTOCOL, async (params: { url: string }) => {
      const url = params.url.replace(`${GEOAPIFY_PROTOCOL}://`, 'https://');
      const response = await this.fetchGeoapifyCacheableResource(url);
      return { data: response.arrayBuffer };
    });
  }

  private async fetchAndResolveStyle(styleUrl: string): Promise<StyleSpecification> {
    logger.scope('Geoapify').debug('Mobile: fetching style JSON via requestUrl');
    const styleResponse = await this.fetchGeoapifyCacheableResource(styleUrl, 'application/json');
    const styleSpec = JSON.parse(new TextDecoder().decode(styleResponse.arrayBuffer)) as StyleSpecification;

    if (!styleSpec.sources) return styleSpec;

    for (const [sourceId, source] of Object.entries(styleSpec.sources)) {
      const src = source as Record<string, unknown>;

      if (typeof src.url === 'string' && src.url.startsWith('http')) {
        try {
          logger.scope('Geoapify').debug(`Mobile: fetching TileJSON for source "${sourceId}"`);
          const tileJsonResponse = await this.fetchGeoapifyCacheableResource(src.url, 'application/json');
          const tileJson = JSON.parse(new TextDecoder().decode(tileJsonResponse.arrayBuffer)) as Record<string, unknown>;

          if (Array.isArray(tileJson.tiles)) {
            src.tiles = (tileJson.tiles as string[]).map(u =>
              u.startsWith('https://') ? u.replace('https://', `${GEOAPIFY_PROTOCOL}://`) : u
            );
            delete src.url;
            if (tileJson.minzoom !== undefined) src.minzoom = tileJson.minzoom;
            if (tileJson.maxzoom !== undefined) src.maxzoom = tileJson.maxzoom;
            if (tileJson.attribution !== undefined) src.attribution = tileJson.attribution;
            logger.scope('Geoapify').debug(`Mobile: inlined ${(src.tiles as string[]).length} tile URL(s) for "${sourceId}"`);
          }
        } catch (e) {
          logger.scope('Geoapify').error(`Mobile: TileJSON fetch failed for source "${sourceId}"`, String(e));
        }
      } else if (Array.isArray(src.tiles)) {
        src.tiles = (src.tiles as string[]).map(u =>
          u.startsWith('https://maps.geoapify.com/') ? u.replace('https://', `${GEOAPIFY_PROTOCOL}://`) : u
        );
      }
    }

    return styleSpec;
  }

  private fetchGeoapifyCacheableResource(url: string, fallbackContentType?: string) {
    const fetcher = async () => {
      const response = await requestUrl({ url });
      return {
        arrayBuffer: response.arrayBuffer,
        contentType: response.headers['content-type'] || fallbackContentType,
      };
    };

    return TileCache.isProviderEnabled('geoapify')
      ? TileCache.getOrFetch(url, fetcher)
      : fetcher();
  }
}
