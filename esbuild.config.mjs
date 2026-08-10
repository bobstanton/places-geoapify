import { broadDataUrlImageLoader, runPluginBuild, createMaplibreWorkerInlinePlugin } from "./esbuild.shared.mjs";

// Geoapify ships maplibre-gl 6, whose worker must be served from a URL. Inline the
// bundled worker so the provider can hand maplibre a blob URL at runtime.
await runPluginBuild({
  loader: broadDataUrlImageLoader,
  plugins: [await createMaplibreWorkerInlinePlugin()],
});
