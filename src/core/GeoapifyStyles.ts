import { styleIds, type BasemapStyle } from 'places-shared/map';

export const GEOAPIFY_STYLES: ReadonlyArray<BasemapStyle> = [
  { value: 'osm-bright', name: 'OSM Bright' },
  { value: 'osm-bright-grey', name: 'OSM Bright Gray' },
  { value: 'osm-bright-smooth', name: 'OSM Bright Smooth' },
  { value: 'klokantech-basic', name: 'Klokantech Basic' },
  { value: 'osm-liberty', name: 'OSM Liberty' },
  { value: 'osm-carto', name: 'OSM Carto' },
  { value: 'positron', name: 'Positron' },
  { value: 'positron-blue', name: 'Positron Blue' },
  { value: 'dark-matter', name: 'Dark Matter' },
  { value: 'dark-matter-brown', name: 'Dark Matter Brown' },
  { value: 'dark-matter-dark-grey', name: 'Dark Matter Dark Gray' },
  { value: 'dark-matter-purple', name: 'Dark Matter Purple' },
  { value: 'dark-matter-yellow', name: 'Dark Matter Yellow' },
];

export function geoapifyStyleUrl(styleId: string, apiKey: string): string | undefined {
  if (!styleIds(GEOAPIFY_STYLES).includes(styleId)) return undefined;

  return `https://maps.geoapify.com/v1/styles/${styleId}/style.json?apiKey=${encodeURIComponent(apiKey)}`;
}
