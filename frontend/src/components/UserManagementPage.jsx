import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../auth.js";

const ROLES = ["admin", "readonly"];

function UserRow({ user, onDelete, onChangeRole }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const body = { role };
      if (newPassword) body.password = newPassword;
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || t("users.saveError"));
      } else {
        onChangeRole(user.id, role);
        setEditing(false);
        setNewPassword("");
      }
    } catch {
      setError(t("users.networkError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(t("users.confirmDelete", { email: user.email }))) return;
    try {
      await fetch(`/api/users/${user.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      onDelete(user.id);
    } catch {
      setError(t("users.networkError"));
    }
  }

  return (
    <div className="user-row">
      <div className="user-row-info">
        <span className="user-email">{user.email}</span>
        {!editing && (
          <span className={`user-role-badge user-role-badge--${user.role}`}>
            {t(`users.role.${user.role}`)}
          </span>
        )}
      </div>

      {editing ? (
        <div className="user-row-edit">
          <select
            className="form-input user-role-select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`users.role.${r}`)}</option>
            ))}
          </select>
          <input
            type="password"
            className="form-input user-password-input"
            placeholder={t("users.newPasswordPlaceholder")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {error && <span className="user-row-error">{error}</span>}
          <div className="user-row-actions">
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "…" : t("users.save")}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setError(""); }}>
              {t("users.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="user-row-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            {t("users.edit")}
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            {t("users.delete")}
          </button>
        </div>
      )}
    </div>
  );
}

function AddUserForm({ onAdded }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("readonly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("users.saveError"));
      } else {
        onAdded(data);
        setEmail("");
        setPassword("");
        setRole("readonly");
      }
    } catch {
      setError(t("users.networkError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="add-user-form" onSubmit={handleSubmit}>
      <h3 className="add-user-title">{t("users.addUser")}</h3>
      <div className="add-user-fields">
        <input
          type="email"
          className="form-input"
          placeholder={t("users.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          className="form-input"
          placeholder={t("users.passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <select
          className="form-input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{t(`users.role.${r}`)}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "…" : t("users.addButton")}
        </button>
      </div>
      {error && <p className="user-row-error">{error}</p>}
    </form>
  );
}

export default function UserManagementPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? data);
      } else {
        setError(t("users.loadError"));
      }
    } catch {
      setError(t("users.networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function handleDelete(id) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  function handleChangeRole(id, newRole) {
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, role: newRole } : u));
  }

  function handleAdded(user) {
    setUsers((prev) => [...prev, user]);
  }

  return (
    <div className="settings-page">
      <div className="settings-section">
        <h2 className="settings-section-title">👥 {t("users.title")}</h2>

        {loading && <p className="text-muted">{t("users.loading")}</p>}
        {error && <p className="text-error">{error}</p>}

        {!loading && !error && (
          <div className="user-list">
            {users.length === 0 ? (
              <p className="text-muted">{t("users.empty")}</p>
            ) : (
              users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onDelete={handleDelete}
                  onChangeRole={handleChangeRole}
                />
              ))
            )}
          </div>
        )}

        <AddUserForm onAdded={handleAdded} />
      </div>
    </div>
  );
}
