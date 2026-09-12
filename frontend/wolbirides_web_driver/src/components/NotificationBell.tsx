import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AppNotification } from "../api/client";
import "./NotificationBell.css";

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    api
      .get<{ results: AppNotification[] } | AppNotification[]>("/notifications")
      .then(({ data }) => setItems(Array.isArray(data) ? data : data.results))
      .catch(() => {
        /* silent — the bell just shows nothing new rather than erroring the whole layout */
      });
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 25000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = items?.filter((n) => !n.read).length ?? 0;

  async function handleItemClick(item: AppNotification) {
    if (!item.read) {
      setItems((prev) => prev?.map((n) => (n.id === item.id ? { ...n, read: true } : n)) ?? prev);
      api.post(`/notifications/${item.id}/read`).catch(() => {});
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  async function markAllRead() {
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    api.post("/notifications/read-all").catch(() => {});
  }

  return (
    <div className="notif-bell-container" ref={containerRef}>
      <button
        className="notif-bell-button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <span className="notif-bell-icon">🔔</span>
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-dropdown-list">
            {items == null && <div className="notif-empty">Loading…</div>}
            {items != null && items.length === 0 && <div className="notif-empty">No notifications yet.</div>}
            {items?.map((item) => (
              <button
                key={item.id}
                className={`notif-item${item.read ? "" : " notif-item-unread"}`}
                onClick={() => handleItemClick(item)}
              >
                <span className={`notif-dot notif-dot-${item.category}`} />
                <span className="notif-item-body">
                  <span className="notif-item-title">{item.title}</span>
                  {item.body && <span className="notif-item-text">{item.body}</span>}
                  <span className="notif-item-time">{timeAgo(item.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
