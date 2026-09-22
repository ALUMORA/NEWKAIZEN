import { useEffect, useState } from "react";

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
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Tema resuelto (light/dark) + toggle persistido. Puerto de NEWKAIZENTEST/src/lib/theme.ts,
// adaptado a JS y con la escritura de data-theme incluida (el original delega eso a un caller).
export function useTheme() {
  const [mode, setMode] = useState(readStoredTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const dark = mode === "dark" || (mode === "system" && systemDark);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const setTheme = (next) => {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* storage bloqueado: el tema no se recuerda */ }
  };

  const toggle = () => setTheme(dark ? "light" : "dark");

  return { mode, dark, setTheme, toggle };
}
