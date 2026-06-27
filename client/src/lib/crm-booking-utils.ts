import { SERVICE_PACKAGES } from "@shared/schema";

/** Best-effort map from Ekhaya service name to local wash package code. */
export function guessPackageFromServiceName(serviceName: string): string | null {
  const normalized = serviceName.toLowerCase().replace(/[^a-z0-9\s]/g, " ");

  for (const [code, pkg] of Object.entries(SERVICE_PACKAGES)) {
    const label = pkg.label.toLowerCase();
    if (normalized.includes(label) || label.includes(normalized.trim())) {
      return code;
    }
  }

  if (normalized.includes("vamos")) return "VAMOS";
  if (normalized.includes("vagabundo")) return "VAGABUNDO";
  if (normalized.includes("raconteur")) return "LE_RACONTEUR";
  if (normalized.includes("obra")) return "LA_OBRA";
  if (normalized.includes("mamacita")) return "MAMACITA";
  if (normalized.includes("jl special")) return "THE_JL_SPECIAL";

  return null;
}
