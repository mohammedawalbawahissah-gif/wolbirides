import { navigationRef } from "./navigationRef";

/** Opens the screen a notification link points to (same links the web app uses). */
export function openLink(link: string) {
  if (!navigationRef.isReady()) return;
  const trip = link.match(/^\/trip\/([0-9a-f-]+)/i);
  if (trip) return navigationRef.navigate("TripStatus", { tripId: trip[1] });
  if (link.startsWith("/profile")) return navigationRef.navigate("MainTabs", { screen: "Profile" });
  if (link.startsWith("/history")) return navigationRef.navigate("MainTabs", { screen: "History" });
  return navigationRef.navigate("MainTabs", { screen: "Ride" });
}
