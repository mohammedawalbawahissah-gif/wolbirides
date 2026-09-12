import { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors, radii, spacing } from "../theme";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Renders Leaflet + OpenStreetMap inside a WebView rather than using
 * react-native-maps. This is a deliberate mirror of the web app's choice
 * (components/PinPicker.tsx there): react-native-maps' PROVIDER_GOOGLE
 * needs an API key that hasn't been decided yet (PRD Section 12), and its
 * default Android provider also falls back to Google Maps. A WebView
 * running the exact same Leaflet page style keeps pickup/destination
 * selection working identically across web and mobile with zero API keys,
 * and means the map HTML itself only has to be built once.
 */
function buildMapHtml(center: LatLng, marker: LatLng | null) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map', { zoomControl: false }).setView([${center.lat}, ${center.lng}], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    let marker = null;
    ${marker ? `marker = L.marker([${marker.lat}, ${marker.lng}]).addTo(map);` : ""}

    map.on('click', function (e) {
      if (marker) { map.removeLayer(marker); }
      marker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
      window.ReactNativeWebView.postMessage(JSON.stringify({ lat: e.latlng.lat, lng: e.latlng.lng }));
    });
  </script>
</body>
</html>`;
}

export default function PinPickerMap({
  center,
  value,
  onChange,
  label,
}: {
  center: LatLng;
  value: LatLng | null;
  onChange: (pos: LatLng) => void;
  label: string;
}) {
  const webviewRef = useRef<WebView>(null);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.mapBox}>
        <WebView
          ref={webviewRef}
          originWhitelist={["*"]}
          source={{ html: buildMapHtml(center, value) }}
          onMessage={(event) => {
            try {
              const pos = JSON.parse(event.nativeEvent.data);
              onChange(pos);
            } catch {
              // ignore malformed messages
            }
          }}
          style={styles.webview}
        />
      </View>
      <Text style={styles.hint}>Tap the map to set your {label.toLowerCase()}.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.inkMuted, marginBottom: spacing.xs },
  mapBox: {
    height: 220,
    borderRadius: radii.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  webview: { flex: 1 },
  hint: { fontSize: 12, color: colors.inkMuted, marginTop: spacing.xs },
});
