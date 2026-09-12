import "./Skeleton.css";

export function SkeletonBlock({ height = 16, width = "100%", radius = 8 }: { height?: number; width?: string | number; radius?: number }) {
  return <div className="skeleton-block" style={{ height, width, borderRadius: radius }} />;
}
