import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
