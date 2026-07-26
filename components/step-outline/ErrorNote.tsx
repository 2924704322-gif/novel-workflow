import type { ReactNode } from "react";

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="chip chip--cinnabar"
      style={{
        marginTop: 12,
        display: "block",
        padding: "10px 12px",
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}
