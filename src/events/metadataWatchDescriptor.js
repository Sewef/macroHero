const TOKEN_METADATA_WATCH = "macrohero.token-metadata-watch";
const SCOPED_METADATA_WATCH = "macrohero.scoped-metadata-watch";
const BROADCAST_WATCH = "macrohero.broadcast-watch";

/**
 * Create an inert description of a token metadata subscription.
 * The HookEngine owns the actual Owlbear listener and its lifecycle.
 */
export function createTokenMetadataWatchDescriptor(options = {}) {
  const {
    integration = "Token",
    eventMethod = "onChange",
    tokenId,
    metadataKey,
    selectorKey = "metadata",
    select = value => value,
    mapEvent = event => event,
  } = options;

  return Object.freeze({
    kind: TOKEN_METADATA_WATCH,
    integration,
    eventMethod: String(eventMethod || "onChange"),
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
      && typeof value.eventMethod === "string"
      && typeof value.select === "function"
      && typeof value.mapEvent === "function",
  );
}

export function createScopedMetadataWatchDescriptor(options = {}) {
  const {
    integration,
    scope,
    metadataKey,
    eventMethod = "onMetadataChange",
    selectorKey = "metadata",
    select = value => value,
    mapEvent = event => event,
  } = options;

  return Object.freeze({
    kind: SCOPED_METADATA_WATCH,
    integration: String(integration || "Metadata"),
    eventMethod: String(eventMethod || "onMetadataChange"),
    scope: String(scope || ""),
    metadataKey: metadataKey == null ? "" : String(metadataKey),
    selectorKey: String(selectorKey || "metadata"),
    select,
    mapEvent,
  });
}

export function isScopedMetadataWatchDescriptor(value) {
  return Boolean(
    value
      && value.kind === SCOPED_METADATA_WATCH
      && ["scene", "room", "player"].includes(value.scope)
      && typeof value.metadataKey === "string"
      && typeof value.eventMethod === "string"
      && typeof value.select === "function"
      && typeof value.mapEvent === "function",
  );
}

export function createBroadcastWatchDescriptor(options = {}) {
  const {
    integration = "Broadcast",
    channel,
    mapEvent = event => event,
  } = options;

  return Object.freeze({
    kind: BROADCAST_WATCH,
    integration: String(integration || "Broadcast"),
    channel: channel == null ? "" : String(channel),
    mapEvent,
  });
}

export function isBroadcastWatchDescriptor(value) {
  return Boolean(
    value
      && value.kind === BROADCAST_WATCH
      && typeof value.channel === "string"
      && typeof value.mapEvent === "function",
  );
}

export function isWatchDescriptor(value) {
  return isTokenMetadataWatchDescriptor(value)
    || isScopedMetadataWatchDescriptor(value)
    || isBroadcastWatchDescriptor(value);
}

export { TOKEN_METADATA_WATCH, SCOPED_METADATA_WATCH, BROADCAST_WATCH };
