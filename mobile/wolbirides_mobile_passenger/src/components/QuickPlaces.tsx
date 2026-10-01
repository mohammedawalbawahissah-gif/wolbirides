import { useEffect, useState } from "react";
import { FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { api, type ServiceZone } from "../api/client";
import { colors, radii, spacing } from "../theme";

export interface PickedPlace { lat: number; lng: number; label: string; savedAddressId?: string }
interface Saved { id: string; label: string; lat: string; lng: string }
interface Partner { id: string; name: string; lat: string; lng: string; offer_text: string }
interface Option { key: string; title: string; subtitle?: string }

/**
 * Pickup/destination shortcuts, as a dropdown rather than a row of chips — a
 * horizontally scrolling chip row gets cumbersome once there are more than a
 * handful of saved places or pickup points; a dropdown stays usable as the
 * list grows. Tapping the field opens a vertical list (there's no native
 * <select> in React Native, so this is a lightweight modal list standing in
 * for one). Partner spots stay as a chip strip below — that's a small,
 * curated promotional row, not a growing list, same as on web.
 */
export default function QuickPlaces({ zone, onPick, showPartners }: {
  zone: ServiceZone; onPick: (which: "pickup" | "destination", place: PickedPlace) => void; showPartners: boolean;
}) {
  const [saved, setSaved] = useState<Saved[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [openFor, setOpenFor] = useState<"pickup" | "destination" | null>(null);

  useEffect(() => {
    api.get<Saved[]>("/passengers/me/addresses").then(({ data }) => setSaved(data)).catch(() => {});
    api.get<Partner[]>(`/partners?zone_id=${zone.id}`).then(({ data }) => setPartners(data)).catch(() => {});
  }, [zone.id]);

  const points = zone.pickup_points ?? [];

  function pick(which: "pickup" | "destination", key: string) {
    setOpenFor(null);
    const [type, id] = key.split(":");
    if (type === "point") {
      const p = points.find((p) => p.id === id);
      if (p) onPick(which, { lat: Number(p.latitude), lng: Number(p.longitude), label: p.name });
    } else {
      const a = saved.find((a) => a.id === id);
      if (a) onPick(which, { lat: Number(a.lat), lng: Number(a.lng), label: a.label, savedAddressId: a.id });
    }
  }

  const pickupOptions: Option[] = [
    ...points.map((p) => ({ key: `point:${p.id}`, title: p.name, subtitle: p.sponsor_name ? `Sponsored by ${p.sponsor_name}` : undefined })),
    ...saved.map((a) => ({ key: `saved:${a.id}`, title: a.label })),
  ];
  const destinationOptions: Option[] = saved.map((a) => ({ key: `saved:${a.id}`, title: a.label }));

  const chip = (key: string, label: string, onPress: () => void, sub?: string) => (
    <TouchableOpacity key={key} style={styles.chip} onPress={onPress} accessibilityRole="button">
      <Text style={styles.chipText}>{label}</Text>
      {!!sub && <Text style={styles.sub}>{sub}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.sm }}>
      {pickupOptions.length > 0 && (
        <Dropdown label="Pick up at" options={pickupOptions} open={openFor === "pickup"}
          onOpen={() => setOpenFor("pickup")} onClose={() => setOpenFor(null)}
          onSelect={(key) => pick("pickup", key)} />
      )}
      {destinationOptions.length > 0 && (
        <Dropdown label="Going to" options={destinationOptions} open={openFor === "destination"}
          onOpen={() => setOpenFor("destination")} onClose={() => setOpenFor(null)}
          onSelect={(key) => pick("destination", key)} />
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

/** A tap-to-open field showing a vertical, scrollable list of choices — the mobile
 * stand-in for a web <select>, since React Native has no native dropdown element. */
function Dropdown({ label, options, open, onOpen, onClose, onSelect }: {
  label: string; options: Option[]; open: boolean; onOpen: () => void; onClose: () => void; onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.trigger} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${label}, choose a place`}>
        <Text style={styles.triggerText}>Choose a place…</Text>
        <Text style={styles.chevron}>⌄</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <FlatList data={options} keyExtractor={(o) => o.key} style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.option} onPress={() => onSelect(item.key)}>
                  <Text style={styles.optionText}>{item.title}</Text>
                  {!!item.subtitle && <Text style={styles.sub}>{item.subtitle}</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
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
  trigger: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.paperRaised, borderRadius: radii.sm, paddingVertical: 10, paddingHorizontal: 12 },
  triggerText: { fontSize: 14, color: colors.ink },
  chevron: { fontSize: 14, color: colors.inkMuted },
  overlay: { flex: 1, backgroundColor: "rgba(10,14,24,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.md, maxHeight: "70%" },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: colors.ink, marginBottom: spacing.sm },
  option: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  optionText: { fontSize: 15, color: colors.ink },
});
