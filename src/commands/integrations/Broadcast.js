import { createBroadcastWatchDescriptor } from "../../events/metadataWatchDescriptor.js";

/**
 * Describe a hook that receives every message published on one exact channel.
 * The descriptor is inert until HookEngine subscribes to it.
 */
export function onMessage(channel) {
  return createBroadcastWatchDescriptor({
    integration: "Broadcast",
    channel,
  });
}

export default { onMessage };
