import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors, radii } from "../theme";

interface Point { lat: number; lng: number }

/**
 * Live trip map, mirroring the web TripMap: pickup, destination and the driver's
 * position (Leaflet + an OpenFreeMap vector map in a WebView, no API key).
 * The map is built once; driver moves are injected, so it doesn't reload on every ping.
 */
function html(pickup: Point, destination: Point) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
<style>html,body,#map{height:100%;margin:0}.pin{border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js"></script>
<script>
  var map = L.map('map', { zoomControl: false });
  // Sharp vector map (OpenFreeMap: free for commercial use, no key). If it can't load, or the phone has no WebGL,
  // fall back to the plain OpenStreetMap tiles so the screen is never blank.
  function addBaseMap(map) {
    var vec = null, loaded = false, done = false;
    function raster() { L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map); }
    function fallBack() { if (loaded || done) return; done = true; try { if (vec) map.removeLayer(vec); } catch (e) {} raster(); }
    try {
      if (!(window.maplibregl && L.maplibreGL)) { done = true; return raster(); }
      vec = L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty',
        attributionControl: { customAttribution: 'OpenFreeMap &copy; OpenMapTiles Data from OpenStreetMap' } });
      vec.addTo(map);
      var gl = vec.getMaplibreMap();
      gl.once('load', function () { loaded = true; });
      gl.on('error', function (e) { if (!e.tile && !e.sourceId) fallBack(); });
      setTimeout(fallBack, 8000);
    } catch (e) { fallBack(); }
  }
  function dot(c, s) { return L.divIcon({ className: '', html: '<div class="pin" style="width:'+s+'px;height:'+s+'px;background:'+c+'"></div>', iconSize: [s, s] }); }
  var p = [${pickup.lat}, ${pickup.lng}], d = [${destination.lat}, ${destination.lng}];
  L.marker(p, { icon: dot('#C9A227', 16) }).addTo(map);
  L.marker(d, { icon: dot('#16233F', 16) }).addTo(map);
  L.polyline([p, d], { color: '#16233F', weight: 3, opacity: 0.35, dashArray: '6 6' }).addTo(map);
  map.fitBounds([p, d], { padding: [40, 40] });
  addBaseMap(map);
  var driver = null;
  window.setDriver = function (lat, lng) {
    var pos = [lat, lng];
    if (!driver) { driver = L.marker(pos, { icon: L.divIcon({ className: '', html: '<div style="font-size:26px">🛺</div>', iconSize: [30, 30] }) }).addTo(map); }
    else { driver.setLatLng(pos); }
    map.fitBounds([p, d, pos], { padding: [40, 40] });
  };
</script></body></html>`;
}

export default function TripMapView({ pickup, destination, driver }: { pickup: Point; destination: Point; driver: Point | null }) {
  const ref = useRef<WebView>(null);
  const source = useMemo(() => ({ html: html(pickup, destination) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickup.lat, pickup.lng, destination.lat, destination.lng]);

  useEffect(() => {
    if (driver) ref.current?.injectJavaScript(`window.setDriver && window.setDriver(${driver.lat}, ${driver.lng}); true;`);
  }, [driver?.lat, driver?.lng]);

  return (
    <View style={styles.box} accessibilityLabel="Map of your trip">
      <WebView ref={ref} originWhitelist={["*"]} source={source} scrollEnabled={false}
        onLoadEnd={() => driver && ref.current?.injectJavaScript(`window.setDriver(${driver.lat}, ${driver.lng}); true;`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 220, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
});
