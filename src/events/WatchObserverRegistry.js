import { tokenMetadataObserver } from "./TokenMetadataObserver.js";
import { scopedMetadataObserver } from "./ScopedMetadataObserver.js";
import { broadcastObserver } from "./BroadcastObserver.js";
import {
  isBroadcastWatchDescriptor,
  isScopedMetadataWatchDescriptor,
  isTokenMetadataWatchDescriptor,
} from "./metadataWatchDescriptor.js";

class WatchObserverRegistry {
  observe(descriptor, callback) {
    if (isTokenMetadataWatchDescriptor(descriptor)) return tokenMetadataObserver.observe(descriptor, callback);
    if (isScopedMetadataWatchDescriptor(descriptor)) return scopedMetadataObserver.observe(descriptor, callback);
    if (isBroadcastWatchDescriptor(descriptor)) return broadcastObserver.observe(descriptor, callback);
    throw new Error("Unsupported hook watch descriptor");
  }

  clear() {
    tokenMetadataObserver.clear();
    scopedMetadataObserver.clear();
    broadcastObserver.clear();
  }
}

export const watchObserverRegistry = new WatchObserverRegistry();
export default WatchObserverRegistry;
