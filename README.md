# Places - Geoapify

Map provider for [Places](https://community.obsidian.md/plugins/places) using [Geoapify](https://www.geoapify.com/), with vector maps, POI search, elevation replacement, directions, isochrones, and track snapping.

This is not a stand-alone plugin, to use, install along side [Places](https://community.obsidian.md/plugins/places). Refer to the [sandbox](https://sandbox.obsidian.stanton.dev/places/) for examples.

## Network requests

| Area                 | Request                                                      |
| -------------------- | ------------------------------------------------------------ |
| Map tiles and styles | Loads the selected map style, its glyphs, sprites, and tiles |
| POI search           | Resolves a search term to place suggestions and coordinates  |
| Directions           | Builds a route between the waypoints in a block              |
| Isochrones           | Builds reachability polygons around a center point           |
| Elevation            | Reads elevation along a track                                |
| Track snapping       | Aligns a recorded track to the road or path network          |

## Background tasks

None.

## Dependencies

| Library                                                                                          | Purpose                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [maplibre-gl](https://github.com/maplibre/maplibre-gl-js)                                        | GL map engine                                  |
| [places-shared](https://github.com/bobstanton/places-shared)                                     | Shared map, overlay, routing, and utility code |
| [places-shared/obsidian/maplibre](https://github.com/bobstanton/places-shared/obsidian/maplibre) | Shared map rendering                           |
