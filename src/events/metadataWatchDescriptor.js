const TOKEN_METADATA_WATCH = "macrohero.token-metadata-watch";

/**
 * Create an inert description of a token metadata subscription.
 * The HookEngine owns the actual Owlbear listener and its lifecycle.
 */
export function createTokenMetadataWatchDescriptor(options = {}) {
  const {
    integration = "TokenMetadata",
    tokenId,
    metadataKey,
    selectorKey = "metadata",
    select = value => value,
    mapEvent = event => event,
  } = options;

  return Object.freeze({
    kind: TOKEN_METADATA_WATCH,
    integration,
    tokenId: tokenId == null ? "" : String(tokenId),
    metadataKey: metadataKey == null ? "" : String(metadataKey),
    selectorKey: String(selectorKey || "metadata"),
    select,
    mapEvent,
  });
}

export function isTokenMetadataWatchDescriptor(value) {
  return Boolean(
    value
      && value.kind === TOKEN_METADATA_WATCH
      && typeof value.tokenId === "string"
      && typeof value.metadataKey === "string"
      && typeof value.select === "function"
      && typeof value.mapEvent === "function",
  );
}

export { TOKEN_METADATA_WATCH };
