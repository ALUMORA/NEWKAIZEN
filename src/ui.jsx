import { Moon, Sun } from "lucide-react";
import markBlack from "./assets/kaizen-mark-black.jpg";
import markWhite from "./assets/kaizen-mark-white.jpg";

export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

// Marca sin texto de KAIZEN. `onDark` elige la variante clara para fondos oscuros
// (siempre oscuros por diseño, como el sidebar) y la oscura para superficies claras.
export function Mark({ onDark = false, size = 40, animated = true, className }) {
  return (
    <span
      className={cn("kaizen-mark", animated && "kaizen-mark-animated", className)}
      style={{ width: size, height: size }}
    >
      <img alt="" aria-hidden="true" src={onDark ? markWhite : markBlack} />
    </span>
  );
}

export function Button({ className, variant = "primary", size = "md", icon, children, ...props }) {
  return (
    <button className={cn("button", `button-${variant}`, `button-${size}`, className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ className, children, ...props }) {
  return (
    <button className={cn("icon-button", className)} type="button" {...props}>
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cn("card", className)} {...props}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className, ...props }) {
  return (
    <span className={cn("badge", tone !== "neutral" && `badge-${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export function Eyebrow({ children }) {
  return <span className="eyebrow">{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeading({ title, description, action }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Metric({ label, value, detail, trend, tone = "neutral", className }) {
  return (
    <div className={cn("metric", className)} data-tone={tone}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {(detail || trend) && (
        <span className="metric-detail">
          {trend && <span className="metric-trend">{trend}</span>}
          {detail}
        </span>
      )}
    </div>
  );
}

export function KpiTile({ label, value, sub, className }) {
  return (
    <div className={cn("kpi-tile", className)}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      {sub && <div className="kpi-tile-sub">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-wrap">
      <div className="progress-label">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={pct} className="progress-track" role="progressbar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state-icon">{icon}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SrOnly({ children }) {
  return <span className="sr-only">{children}</span>;
}

export function ThemeToggle({ dark, onToggle, className }) {
  return (
    <IconButton aria-label={`Usar tema ${dark ? "claro" : "oscuro"}`} className={className} onClick={onToggle}>
      {dark ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
    </IconButton>
  );
}
