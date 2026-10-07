import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { WebView } from "react-native-webview";
import { colors, radii, spacing, typography } from "../theme";
import { api } from "../api/client";
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

/** One answer from GET /api/places/search. `place` and `pickup` are spots WolbiRides knows; `map` came from the outside map service. */
interface PlaceResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  source: "place" | "pickup" | "map";
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
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
<style>html,body,#map{height:100%;margin:0}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js"></script>
<script>
  var map = L.map('map', { zoomControl: false }).setView([${center.lat}, ${center.lng}], 15);
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
  addBaseMap(map);
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
 * Shows an OpenFreeMap vector map in a WebView rather than react-native-maps/Google Maps — no API key needed.
 * Search as you type goes through the WolbiRides backend (/places/search), the same as web.
 */
export default function LocationPickerModal({
  visible, title, center, zoneId, value, onConfirm, onClose,
}: {
  visible: boolean;
  title: string;
  center: LatLng;
  zoneId?: string; // the service area to search in; the backend knows its boundary
  value: LatLng | null;
  onConfirm: (pos: LatLng) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(value?.label && value.label !== PINNED_LABEL ? value.label : "");
  const [resolving, setResolving] = useState(false);
  const lookupId = useRef(0);
  const searchId = useRef(0);
  const skipNextSearch = useRef(false); // the box was filled by picking a result or tapping the map, not by typing
  const [results, setResults] = useState<PlaceResult[]>([]);
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
    const id = ++searchId.current;
    setSearching(true);
    try {
      const params: Record<string, string | number> = { q: text, lat: center.lat, lng: center.lng };
      if (zoneId) params.zone = zoneId;
      const { data } = await api.get<{ results: PlaceResult[] }>("/places/search", { params });
      if (id !== searchId.current) return; // a newer search has started; this answer is out of date
      setResults(data.results ?? []);
    } catch {
      if (id !== searchId.current) return;
      setResults([]);
    } finally {
      if (id === searchId.current) {
        setSearching(false);
        setSearched(true);
      }
    }
  }

  // Search as the passenger types: wait for a short pause so a fast typist sends one request, not ten.
  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    const text = query.trim();
    if (text.length < 2) { searchId.current++; setResults([]); setSearching(false); setSearched(false); return; }
    const timer = setTimeout(runSearch, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function applyDraft(pos: LatLng) {
    setDraft(pos);
    webviewRef.current?.injectJavaScript(`window.setMarker && window.setMarker(${pos.lat}, ${pos.lng}, true); true;`);
  }

  function pickResult(result: PlaceResult) {
    lookupId.current++; // a search result already has its name; drop any lookup still in flight
    searchId.current++;
    setResolving(false);
    const label = result.source === "map" ? shortLabel(result.label) : result.name;
    const picked: LatLng = { lat: round6(result.lat), lng: round6(result.lng), label };
    skipNextSearch.current = true;
    setQuery(result.name);
    setResults([]);
    setSearched(false);
    applyDraft(picked);
  }

  async function handleMapPick(lat: number, lng: number) {
    const id = ++lookupId.current;
    const pos = { lat: round6(lat), lng: round6(lng) };
    searchId.current++;
    skipNextSearch.current = query !== "";
    setQuery("");
    setResults([]);
    setDraft(pos);
    setResolving(true);
    // A tapped point has no name of its own: look one up, so the booking shows a place, not coordinates.
    const name = await reverseGeocode(pos.lat, pos.lng);
    if (id !== lookupId.current) return; // tapped somewhere else meanwhile
    setResolving(false);
    setDraft({ ...pos, label: name ? shortLabel(name) : PINNED_LABEL });
    skipNextSearch.current = (name ?? "") !== query;
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
        <FlatList data={results} keyExtractor={(item, i) => item.id + i} style={styles.results}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.result} onPress={() => pickResult(item)}>
              <Text style={styles.resultText}>{item.name}</Text>
              {item.label !== item.name && (
                <Text style={styles.resultSub} numberOfLines={1}>
                  {item.label.startsWith(item.name) ? item.label.slice(item.name.length).replace(/^,\s*/, "") : item.label}
                </Text>
              )}
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
  resultText: { fontSize: 14, fontWeight: "600", color: colors.ink },
  resultSub: { fontSize: 12.5, color: colors.inkMuted, marginTop: 2 },
  empty: { fontSize: 13.5, color: colors.inkMuted, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  map: { flex: 1, margin: spacing.md, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  footer: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
});
