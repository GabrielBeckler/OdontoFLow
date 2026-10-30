import type { ReactNode } from "react";

export default function Metric({
  label,
  value,
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
    <div className={`metric-card metric-card--${tone}`}>
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
        <span className="metric-dot" aria-hidden="true" />
      </div>
      <div className="metric-value">{value.toLocaleString("pt-BR")}</div>
      <div className="metric-foot">
        <span className="metric-accent" aria-hidden="true" />
        <span className="metric-sub">{sub}</span>
      </div>
    </div>
  );
}
