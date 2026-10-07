import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

/**
 * The picture under the pins. Normally a sharp vector map (OpenFreeMap: free for commercial use, no key, drawn
 * on the phone/computer so labels stay crisp when zoomed). If it can't load in 8 seconds, or the device has no
 * WebGL, it quietly falls back to the plain OpenStreetMap tiles so the screen is never left blank.
 * Set VITE_MAP_STYLE_URL at build time to use another MapLibre style (for example a paid provider's).
 */
const STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || "https://tiles.openfreemap.org/styles/liberty";
const RASTER_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const RASTER_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const GIVE_UP_MS = 8000;

export default function BaseMap() {
  const map = useMap();

  useEffect(() => {
    let layer: L.Layer | null = null;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function swap(next: L.Layer) {
      if (layer) {
        try { map.removeLayer(layer); } catch { /* already gone */ }
      }
      layer = next;
      next.addTo(map);
    }
    function addRaster() {
      if (!disposed) swap(L.tileLayer(RASTER_URL, { attribution: RASTER_ATTRIBUTION }));
    }

    (async () => {
      try {
        const [{ maplibreGL }] = await Promise.all([
          import("@maplibre/maplibre-gl-leaflet"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        if (disposed) return;
        const vector = maplibreGL({ style: STYLE_URL, attributionControl: { customAttribution: VECTOR_ATTRIBUTION } } as never);
        swap(vector);
        const gl = vector.getMaplibreMap();
        let loaded = false;
        const fallBack = () => {
          if (loaded || disposed || layer !== vector) return;
          clearTimeout(timer);
          addRaster();
        };
        gl.once("load", () => { loaded = true; clearTimeout(timer); });
        // A single missing tile is normal; what matters is the style itself (or its fonts/icons) failing to load.
        gl.on("error", (e) => { if (!(e as { tile?: unknown; sourceId?: string }).tile && !(e as { sourceId?: string }).sourceId) fallBack(); });
        timer = setTimeout(fallBack, GIVE_UP_MS);
      } catch {
        addRaster(); // no WebGL, or the map code failed to load
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      if (layer) {
        try { map.removeLayer(layer); } catch { /* map already torn down */ }
      }
    };
  }, [map]);

  return null;
}
