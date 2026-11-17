const TOKEN_METADATA_WATCH = "macrohero.token-metadata-watch";
const SCOPED_METADATA_WATCH = "macrohero.scoped-metadata-watch";
const BROADCAST_WATCH = "macrohero.broadcast-watch";
const SCENE_ITEMS_WATCH = "macrohero.scene-items-watch";

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
    shouldEmit = () => true,
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
    shouldEmit,
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
      && typeof value.mapEvent === "function"
      && typeof value.shouldEmit === "function"
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
    eventMethod = "onMessage",
    mapEvent = event => event,
  } = options;

  return Object.freeze({
    kind: BROADCAST_WATCH,
    integration: String(integration || "Broadcast"),
    eventMethod: String(eventMethod || "onMessage"),
    channel: channel == null ? "" : String(channel),
    mapEvent,
  });
}

export function isBroadcastWatchDescriptor(value) {
  return Boolean(
    value
      && value.kind === BROADCAST_WATCH
      && typeof value.channel === "string"
      && typeof value.eventMethod === "string"
      && typeof value.mapEvent === "function",
  );
}

export function createSceneItemsWatchDescriptor(options = {}) {
  const {
    integration,
    eventMethod,
    selectorKey = "items",
    select,
    isEqual,
    shouldEmit = () => true,
    mapEvent = event => event,
  } = options;

  return Object.freeze({
    kind: SCENE_ITEMS_WATCH,
    integration: String(integration || "Scene"),
    eventMethod: String(eventMethod || "onChange"),
    selectorKey: String(selectorKey || "items"),
    select,
    isEqual,
    shouldEmit,
    mapEvent,
  });
}

export function isSceneItemsWatchDescriptor(value) {
  return Boolean(
    value
      && value.kind === SCENE_ITEMS_WATCH
      && typeof value.integration === "string"
      && typeof value.eventMethod === "string"
      && typeof value.selectorKey === "string"
      && typeof value.select === "function"
      && (value.isEqual === undefined || typeof value.isEqual === "function")
      && typeof value.shouldEmit === "function"
      && typeof value.mapEvent === "function",
  );
}

export function isWatchDescriptor(value) {
  return isTokenMetadataWatchDescriptor(value)
    || isScopedMetadataWatchDescriptor(value)
    || isBroadcastWatchDescriptor(value)
    || isSceneItemsWatchDescriptor(value);
}

export { TOKEN_METADATA_WATCH, SCOPED_METADATA_WATCH, BROADCAST_WATCH, SCENE_ITEMS_WATCH };
