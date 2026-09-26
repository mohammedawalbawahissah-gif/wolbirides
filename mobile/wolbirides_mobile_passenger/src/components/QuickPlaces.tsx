import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, type ServiceZone } from "../api/client";
import { colors, radii, spacing } from "../theme";

export interface PickedPlace { lat: number; lng: number; label: string; savedAddressId?: string }
interface Saved { id: string; label: string; lat: string; lng: string }
interface Partner { id: string; name: string; lat: string; lng: string; offer_text: string }

/**
 * Same one-tap choices as the web booking screen: campus pickup points (sponsored
 * ones labelled), saved places (sent as saved_address_id so "Book my usual" learns),
 * and partner spots as destinations, labelled "Sponsored".
 */
export default function QuickPlaces({ zone, onPick, showPartners }: {
  zone: ServiceZone; onPick: (which: "pickup" | "destination", place: PickedPlace) => void; showPartners: boolean;
}) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);

  useEffect(() => {
    api.get<Saved[]>("/passengers/me/addresses").then(({ data }) => setSaved(data)).catch(() => {});
    api.get<Partner[]>(`/partners?zone_id=${zone.id}`).then(({ data }) => setPartners(data)).catch(() => {});
  }, [zone.id]);

  const points = zone.pickup_points ?? [];
  const chip = (key: string, label: string, onPress: () => void, sub?: string) => (
    <TouchableOpacity key={key} style={styles.chip} onPress={onPress} accessibilityRole="button">
      <Text style={styles.chipText}>{label}</Text>
      {!!sub && <Text style={styles.sub}>{sub}</Text>}
    </TouchableOpacity>
  );
  const savedChip = (which: "pickup" | "destination", a: Saved) =>
    chip(`${which}-${a.id}`, a.label, () => onPick(which, { lat: Number(a.lat), lng: Number(a.lng), label: a.label, savedAddressId: a.id }));

  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.sm }}>
      {(points.length > 0 || saved.length > 0) && (
        <View style={styles.row}>
          <Text style={styles.label}>Pick up at</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {points.map((p) => chip(p.id, p.name,
              () => onPick("pickup", { lat: Number(p.latitude), lng: Number(p.longitude), label: p.name }),
              p.sponsor_name ? `Sponsored by ${p.sponsor_name}` : undefined))}
            {saved.map((a) => savedChip("pickup", a))}
          </ScrollView>
        </View>
      )}
      {saved.length > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Going to</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {saved.map((a) => savedChip("destination", a))}
          </ScrollView>
        </View>
      )}
      {showPartners && partners.length > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Partner spots · <Text style={styles.sponsored}>SPONSORED</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {partners.map((p) => chip(p.id, p.name,
              () => onPick("destination", { lat: Number(p.lat), lng: Number(p.lng), label: p.name }), p.offer_text || undefined))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 4 },
  label: { fontSize: 12.5, fontWeight: "600", color: colors.inkMuted },
  sponsored: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  chips: { gap: 6, paddingRight: spacing.md },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paperRaised, borderRadius: radii.pill,
    paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { fontSize: 13.5, color: colors.ink },
  sub: { fontSize: 10.5, color: colors.inkMuted },
});
