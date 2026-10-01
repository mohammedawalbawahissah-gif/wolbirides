/** OpenStreetMap names run to six or seven parts ("…, Tamale Metropolitan District, Northern Region,
 * Ghana"). The first two — the place and its street — are what a passenger recognises. */
export function shortLabel(displayName: string) {
  return displayName.split(",").slice(0, 2).map((part) => part.trim()).filter(Boolean).join(", ");
}

/** Turns a point on the map into a place name, so a tapped pin reads "Tech Hostels, Ceres Street"
 * rather than a pair of coordinates. Returns null if the lookup fails. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data?.display_name ? String(data.display_name) : null;
  } catch {
    return null;
  }
}

export const PINNED_LABEL = "Pinned location";
