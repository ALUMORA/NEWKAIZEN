import { useSyncExternalStore } from "react";

const STORAGE_KEY = "kaizen_theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

// ─── Estado compartido ──────────────────────────────────────────────────────
// Antes cada useTheme() tenía su propio useState, así que el ThemeSync de
// AppRoot y el botón del Workspace legado no se enteraban uno del otro: el
// botón cambiaba <html data-theme> pero el otro seguía creyendo lo contrario.
// Ahora hay un solo estado en el módulo y todos los componentes se suscriben,
// que es lo que pedía la nota de cierre de S2 ("UiProvider debería ser el dueño
// único"). La firma del hook no cambia, así que el legado sigue igual.

let mode = readStoredTheme();
let systemDark = systemPrefersDark();
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {{ mode: string, dark: boolean } | null} */
let snapshot = null;
let mediaBound = false;

function resolvedDark() {
  return mode === "dark" || (mode === "system" && systemDark);
}

/** Escribe data-theme en <html>. Fuera de React a propósito: el tema es del
 *  documento, no de un componente, y así no depende de quién se monte primero. */
function applyToDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolvedDark() ? "dark" : "light");
}

function emit() {
  snapshot = null;
  applyToDocument();
  listeners.forEach((listener) => listener());
}

function bindMedia() {
  if (mediaBound || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  mediaBound = true;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", (event) => {
    systemDark = event.matches;
    if (mode === "system") emit();
  });
}

function subscribe(listener) {
  bindMedia();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (!snapshot) snapshot = { mode, dark: resolvedDark() };
  return snapshot;
}

/** Guarda y aplica el tema. 'system' vuelve a seguir la preferencia del sistema. */
export function setTheme(next) {
  if (next !== "light" && next !== "dark" && next !== "system") return;
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch { /* storage bloqueado: el tema no se recuerda */ }
  emit();
}

/** Alterna entre claro y oscuro (deja de seguir al sistema). */
export function toggleTheme() {
  setTheme(resolvedDark() ? "light" : "dark");
}

applyToDocument();

/**
 * Tema resuelto (light/dark) + preferencia guardada. Todas las instancias
 * comparten el mismo estado.
 * @returns {{ mode: string, dark: boolean, setTheme: (next: string) => void, toggle: () => void }}
 */
export function useTheme() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { mode: state.mode, dark: state.dark, setTheme, toggle: toggleTheme };
}
