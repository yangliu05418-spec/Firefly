const endpointHost = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/\.+$/, "");
  if (!normalized) return "";
  try { return new URL(normalized.includes("://") ? normalized : `https://${normalized}`).hostname.replace(/\.+$/, ""); }
  catch { return ""; }
};

export const tosEndpointMatches = (configured: string, advertised: string) => {
  const configuredHost = endpointHost(configured);
  const advertisedHost = endpointHost(advertised);
  return Boolean(configuredHost && advertisedHost && configuredHost === advertisedHost);
};
