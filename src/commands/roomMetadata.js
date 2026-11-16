import OBR from "@owlbear-rodeo/sdk";
import { createScopedMetadataWatchDescriptor } from "../events/metadataWatchDescriptor.js";

export function onMetadataChange(metadataKey) {
  return createScopedMetadataWatchDescriptor({
    integration: "Room",
    scope: "room",
    metadataKey,
  });
}

export async function getAllRoomMetadata() {
  return OBR.room.getMetadata();
}

export async function getRoomMetadata(metadataKey) {
  const metadata = await OBR.room.getMetadata();
  return metadata?.[metadataKey];
}

export async function setRoomMetadata(metadataKey, value) {
  await OBR.room.setMetadata({ [metadataKey]: value });
}

export async function updateRoomMetadata(updates) {
  await OBR.room.setMetadata(updates);
}

export async function mergeRoomMetadata(metadataKey, value) {
  const current = await getRoomMetadata(metadataKey);
  await setRoomMetadata(metadataKey, { ...(current || {}), ...(value || {}) });
}

export async function deleteRoomMetadata(metadataKey) {
  await OBR.room.setMetadata({ [metadataKey]: undefined });
}

export default {
  onMetadataChange,
  getAllRoomMetadata,
  getRoomMetadata,
  setRoomMetadata,
  updateRoomMetadata,
  mergeRoomMetadata,
  deleteRoomMetadata,
};
