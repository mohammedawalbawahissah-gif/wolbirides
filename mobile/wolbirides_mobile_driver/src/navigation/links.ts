import { navigationRef } from "./navigationRef";

/** Opens the screen a notification link points to (same links the web app uses). */
export function openLink(link: string) {
  if (!navigationRef.isReady()) return;
  const trip = link.match(/^\/active-trip\/([0-9a-f-]+)/i);
  if (trip) return navigationRef.navigate("ActiveTrip", { tripId: trip[1] });
  if (link.startsWith("/earnings")) return navigationRef.navigate("MainTabs", { screen: "Earnings" });
  if (link.startsWith("/trips")) return navigationRef.navigate("MainTabs", { screen: "Trips" });
  if (link.startsWith("/profile")) return navigationRef.navigate("MainTabs", { screen: "Profile" });
  return navigationRef.navigate("MainTabs", { screen: "Drive" });
}
