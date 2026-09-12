import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, type SavedAddress } from "../api/client";
import FileDrop from "../components/FileDrop";
import { useToast } from "../components/Toast";
import "./Profile.css";

export default function Profile() {
  const { user, updateName, updateProfilePhoto } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);

  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [addingAddress, setAddingAddress] = useState(false);

  useEffect(() => {
    api
      .get<SavedAddress[]>("/passengers/me/addresses")
      .then(({ data }) => setAddresses(data))
      .catch(() => setAddresses([]));
  }, []);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateName(name.trim());
      toast.show("Profile updated.", "success");
    } catch {
      toast.show("Couldn't save your name — try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoChange(url: string | null) {
    if (!url) return;
    try {
      await updateProfilePhoto(url);
      toast.show("Profile photo updated.", "success");
    } catch {
      toast.show("Couldn't save your photo — try again.", "error");
    }
  }

  async function addPlaceholderAddress() {
    // Full pin-drop picker lives on the ride-request map (PinPicker); this
    // quick-add just needs a label + the browser's current position so a
    // passenger can save "Home"/"Hostel" in a couple of taps from Profile.
    if (!newLabel.trim()) return;
    setAddingAddress(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      );
      const { data } = await api.post<SavedAddress>("/passengers/me/addresses", {
        label: newLabel.trim(),
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        address_text: "Current location",
      });
      setAddresses((prev) => [data, ...(prev ?? [])]);
      setNewLabel("");
      toast.show("Address saved.", "success");
    } catch {
      toast.show("Couldn't get your location — check location permissions and try again.", "error");
    } finally {
      setAddingAddress(false);
    }
  }

  async function deleteAddress(id: string) {
    setAddresses((prev) => prev?.filter((a) => a.id !== id) ?? prev);
    api.delete(`/passengers/me/addresses/${id}`).catch(() => {
      toast.show("Couldn't remove that address.", "error");
    });
  }

  return (
    <div>
      <div className="page-heading">
        <h1>Profile</h1>
        <p>{user?.email || user?.phone}</p>
      </div>

      <div className="card profile-card">
        <FileDrop
          kind="profile_photo"
          label="Profile photo"
          hint="A clear photo helps drivers recognize you."
          value={user?.profile_photo || null}
          onChange={handlePhotoChange}
        />

        <form onSubmit={handleSaveName}>
          <label className="field-label" htmlFor="name">Name</label>
          <input
            id="name"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
          <button className="btn btn-gold" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>

      <div className="card profile-card" style={{ marginTop: 16 }}>
        <h2 className="side-card-title">Saved places</h2>

        {addresses == null && <p className="profile-muted">Loading…</p>}
        {addresses != null && addresses.length === 0 && (
          <p className="profile-muted">No saved places yet — add your home or hostel for faster booking.</p>
        )}
        {addresses?.map((addr) => (
          <div className="saved-address-row" key={addr.id}>
            <div>
              <div className="saved-address-label">{addr.label}</div>
              <div className="saved-address-text">{addr.address_text || `${addr.lat}, ${addr.lng}`}</div>
            </div>
            <button className="saved-address-remove" onClick={() => deleteAddress(addr.id)} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}

        <div className="saved-address-add">
          <input
            className="field-input"
            placeholder="e.g. Home, Hostel"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button className="btn btn-ghost" onClick={addPlaceholderAddress} disabled={addingAddress || !newLabel.trim()}>
            {addingAddress ? "Adding…" : "Add current location"}
          </button>
        </div>
      </div>
    </div>
  );
}
