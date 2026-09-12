import "./Skeleton.css";

export function SkeletonBlock({ height = 16, width = "100%", radius = 8 }: { height?: number; width?: string | number; radius?: number }) {
  return <div className="skeleton-block" style={{ height, width, borderRadius: radius }} />;
}

export function TripStatusSkeleton() {
  return (
    <div className="trip-status-layout">
      <div className="trip-status-primary">
        <div className="card" style={{ padding: 24 }}>
          <SkeletonBlock height={20} width="60%" />
          <div style={{ height: 12 }} />
          <SkeletonBlock height={14} width="85%" />
        </div>
        <div style={{ height: 16 }} />
        <SkeletonBlock height={220} radius={18} />
      </div>
      <div className="trip-status-side">
        <div className="card">
          <SkeletonBlock height={16} width="40%" />
          <div style={{ height: 14 }} />
          <SkeletonBlock height={14} width="90%" />
          <div style={{ height: 8 }} />
          <SkeletonBlock height={14} width="70%" />
        </div>
      </div>
    </div>
  );
}
