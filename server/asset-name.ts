export const providerAssetName = (name: string) => Array.from(name.normalize("NFKC")).slice(0, 64).join("");
