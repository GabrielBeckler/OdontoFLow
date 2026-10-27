import type { ReactNode } from "react";

export default function Metric({
  label,
  value,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: string;
  sub: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value.toLocaleString("pt-BR")}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}

