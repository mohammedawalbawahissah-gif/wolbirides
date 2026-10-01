import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { WebView } from "react-native-webview";
import { colors, radii, spacing, typography } from "../theme";
import { PINNED_LABEL, reverseGeocode, shortLabel } from "../geocode";
import { Button } from "./ui";

export interface LatLng {
  lat: number;
  lng: number;
  label?: string;
}

export interface Bounds {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}

interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
}

// Six decimal places is ~11cm of precision — plenty for ride-hailing, and matches
// the backend's DecimalField(max_digits=9, decimal_places=6).
function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

function mapHtml(center: LatLng) {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{height:100%;margin:0}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var map = L.map('map', { zoomControl: false }).setView([${center.lat}, ${center.lng}], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
  var marker = null;
  window.setMarker = function (lat, lng, fly) {
    var pos = [lat, lng];
    if (!marker) { marker = L.marker(pos).addTo(map); } else { marker.setLatLng(pos); }
    if (fly) map.flyTo(pos, 16, { duration: 0.5 }); else map.setView(pos, 16);
  };
  map.on('click', function (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ lat: e.latlng.lat, lng: e.latlng.lng }));
  });
</script></body></html>`;
}

/**
 * Full-screen location picker, mirroring the web app's LocationPickerModal:
 * search by name (e.g. "Citadel Hostel") with an explicit Search button, pick
 * a result, or fine-tune by tapping the map. Opened from the Pickup/Destination
 * field rather than an always-visible inline map, so the booking screen stays
 * short until a location is actually being chosen.
 *
 * Uses OpenStreetMap tiles in a WebView (see PinPickerMap.tsx) rather than
 * react-native-maps/Google Maps — no API key decided yet (PRD Section 12).
 * Search reuses OSM's own free Nominatim geocoder, the same as web.
 */
export default function LocationPickerModal({
  visible, title, center, bounds, value, onConfirm, onClose,
}: {
  visible: boolean;
  title: string;
  center: LatLng;
  bounds?: Bounds;
  value: LatLng | null;
  onConfirm: (pos: LatLng) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(value?.label && value.label !== PINNED_LABEL ? value.label : "");
  const [resolving, setResolving] = useState(false);
  const lookupId = useRef(0);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(value);
  const webviewRef = useRef<WebView>(null);
  const html = useMemo(() => mapHtml(value ?? center), [visible]);

  useEffect(() => {
    if (visible) {
      setDraft(value); setQuery(value?.label && value.label !== PINNED_LABEL ? value.label : "");
      setResults([]); setSearched(false); setResolving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the modal opens
  }, [visible]);

  async function runSearch() {
    const text = query.trim();
    if (text.length < 2) return;
    setSearching(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ format: "json", q: text, limit: "6", addressdetails: "0" });
      if (bounds) {
        params.set("viewbox", `${bounds.min_lng},${bounds.max_lat},${bounds.max_lng},${bounds.min_lat}`);
        params.set("bounded", "1");
      }
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      setResults(await res.json());
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function applyDraft(pos: LatLng) {
    setDraft(pos);
    webviewRef.current?.injectJavaScript(`window.setMarker && window.setMarker(${pos.lat}, ${pos.lng}, true); true;`);
  }

  function pickResult(result: GeocodeResult) {
    lookupId.current++; // a search result already has its name; drop any lookup still in flight
    setResolving(false);
    const picked: LatLng = { lat: round6(Number(result.lat)), lng: round6(Number(result.lon)), label: shortLabel(result.display_name) };
    setQuery(result.display_name);
    setResults([]);
    applyDraft(picked);
  }

  async function handleMapPick(lat: number, lng: number) {
    const id = ++lookupId.current;
    const pos = { lat: round6(lat), lng: round6(lng) };
    setQuery("");
    setResults([]);
    setDraft(pos);
    setResolving(true);
    // A tapped point has no name of its own: look one up, so the booking shows a place, not coordinates.
    const name = await reverseGeocode(pos.lat, pos.lng);
    if (id !== lookupId.current) return; // tapped somewhere else meanwhile
    setResolving(false);
    setDraft({ ...pos, label: name ? shortLabel(name) : PINNED_LABEL });
    setQuery(name ?? "");
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={styles.close}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <TextInput style={styles.input} value={query} placeholder="Search a place, e.g. Citadel Hostel"
          placeholderTextColor={colors.inkMuted}
          onChangeText={(t) => { setQuery(t); setSearched(false); }} onSubmitEditing={runSearch} returnKeyType="search" />
        <Button title={searching ? "Searching…" : "Search"} variant="gold" onPress={runSearch}
          disabled={searching || query.trim().length < 2} />
      </View>

      {results.length > 0 && (
        <FlatList data={results} keyExtractor={(_, i) => String(i)} style={styles.results}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.result} onPress={() => pickResult(item)}>
              <Text style={styles.resultText}>{item.display_name}</Text>
            </TouchableOpacity>
          )}
        />
      )}
      {searched && !searching && results.length === 0 && (
        <Text style={styles.empty}>No matches. Try a different name, or tap the map below.</Text>
      )}
      {searching && <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.gold} />}

      <View style={styles.map}>
        <WebView
          ref={webviewRef}
          originWhitelist={["*"]}
          source={{ html }}
          onLoadEnd={() => { if (draft) webviewRef.current?.injectJavaScript(`window.setMarker && window.setMarker(${draft.lat}, ${draft.lng}, false); true;`); }}
          onMessage={(event) => {
            try {
              const pos = JSON.parse(event.nativeEvent.data);
              if (typeof pos.lat === "number" && typeof pos.lng === "number") handleMapPick(pos.lat, pos.lng);
            } catch {
              // ignore malformed messages
            }
          }}
          style={{ flex: 1 }}
        />
      </View>

      <View style={styles.footer}>
        <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
        <Button title={resolving ? "Finding place name…" : "Use this location"} variant="gold"
          onPress={() => draft && onConfirm({ ...draft, label: draft.label || PINNED_LABEL })} disabled={!draft || resolving} style={{ flex: 1 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, paddingTop: spacing.xl },
  headerTitle: { ...typography.h1, fontSize: 20 },
  close: { fontSize: 20, color: colors.inkMuted, padding: spacing.xs },
  searchRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, alignItems: "flex-start" },
  input: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radii.sm, paddingVertical: 10,
    paddingHorizontal: 12, fontSize: 15, backgroundColor: colors.paperRaised, color: colors.ink },
  results: { maxHeight: 200, marginTop: spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  result: { paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  resultText: { fontSize: 14, color: colors.ink },
  empty: { fontSize: 13.5, color: colors.inkMuted, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  map: { flex: 1, margin: spacing.md, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  footer: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
});
