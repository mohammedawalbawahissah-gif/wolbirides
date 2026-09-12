import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardTrendPoint } from "../api/client";
import "./TrendsChart.css";

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TripsTrendChart({ data }: { data: DashboardTrendPoint[] }) {
  const chartData = data.map((d) => ({ ...d, day: formatDay(d.date) }));
  return (
    <div className="chart-panel">
      <h2>Trips, last 14 days</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E1DFD7" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E1DFD7", fontSize: 12.5 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="completed" name="Completed" stackId="a" fill="#2F7D5D" radius={[0, 0, 0, 0]} />
          <Bar dataKey="cancelled" name="Cancelled" stackId="a" fill="#B23A2F" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RevenueTrendChart({ data }: { data: DashboardTrendPoint[] }) {
  const chartData = data.map((d) => ({ ...d, day: formatDay(d.date), revenue: Number(d.revenue) }));
  return (
    <div className="chart-panel">
      <h2>Revenue, last 14 days</h2>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B8860B" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#B8860B" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E1DFD7" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#5B6472" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid #E1DFD7", fontSize: 12.5 }}
            formatter={(v) => [`GH₵${Number(v).toFixed(2)}`, "Revenue"]}
          />
          <Area type="monotone" dataKey="revenue" stroke="#B8860B" strokeWidth={2} fill="url(#revenueFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
