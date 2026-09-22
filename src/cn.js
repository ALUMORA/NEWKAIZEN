// Une clases condicionales. Vive aparte de ui.jsx para que ese archivo solo exporte componentes (Fast Refresh).
export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
