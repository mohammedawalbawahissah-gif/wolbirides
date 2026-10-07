import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { api } from "./api/client";

export type UploadKind =
  | "profile_photo" | "licence_document" | "vehicle_photo" | "vehicle_registration_document"
  | "ghana_card_document" | "union_card_document" | "roadworthy_certificate";

/**
 * Same endpoint and rules as the web FileDrop: POST /api/uploads/document
 * (multipart), validated server-side (images, or PDF for documents, 8 MB max).
 * Returns the hosted URL, or null if the person cancelled.
 */
export async function pickAndUpload(kind: UploadKind, source: "camera" | "library" | "document"): Promise<string | null> {
  let file: { uri: string; name: string; type: string } | null = null;

  if (source === "document") {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    file = { uri: a.uri, name: a.name || "document.pdf", type: a.mimeType || "application/pdf" };
  } else {
    const perm = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error("permission");
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsEditing: kind === "profile_photo",
      aspect: kind === "profile_photo" ? [1, 1] : undefined };
    const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    file = { uri: a.uri, name: a.fileName || `${kind}.jpg`, type: a.mimeType || "image/jpeg" };
  }

  const form = new FormData();
  // React Native's FormData takes {uri, name, type} for files.
  form.append("file", file as unknown as Blob);
  form.append("kind", kind);
  const { data } = await api.post<{ url: string }>("/uploads/document", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.url;
}
