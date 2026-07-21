"use client";

import { useEffect, useState } from "react";
import {
  getActiveProfile,
  loadProfiles,
  setActiveProfile,
  type ApiProfile,
} from "@/lib/client";

// A compact dropdown in the top bar for switching the active API profile from
// anywhere. Renders only after mount to avoid SSR/localStorage hydration
// mismatch.
export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  function refresh() {
    const s = loadProfiles();
    setProfiles(s.profiles);
    setActiveId(getActiveProfile().id);
  }

  useEffect(() => {
    setMounted(true);
    refresh();
    // keep in sync when another tab / the settings page changes profiles
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === "novel-workflow.apiProfiles") refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!mounted || profiles.length === 0) return null;

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setActiveProfile(id);
    setActiveId(id);
  }

  return (
    <div className="profile-switch" title="切换正在使用的模型接口">
      <span className="dot dot--draft" aria-hidden />
      <select
        className="select select--bare"
        value={activeId}
        onChange={onChange}
        aria-label="切换模型接口"
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
