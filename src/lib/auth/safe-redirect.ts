/**
 * Safely validate a redirect destination.
 * Only allows internal paths (starting with "/" but not "//").
 * Rejects absolute URLs, protocol-relative URLs, and paths starting with "/auth/".
 * Returns "/services" as fallback for invalid/missing destinations.
 */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return "/services";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/services";
  if (raw.startsWith("/auth/")) return "/services";
  return raw;
}
