export function StreamingPanel({ text }: { text: string }) {
  return (
    <div className="panel" style={{ padding: 20, marginBottom: 18 }}>
      <div className="chip chip--cinnabar" style={{ marginBottom: 12 }}>
        构思中
      </div>
      <pre
        className="scroll-y writing-cursor"
        style={{
          maxHeight: 260,
          whiteSpace: "pre-wrap",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--fg-dim)",
          fontFamily: "var(--font-sans)",
          margin: 0,
        }}
      >
        {text}
      </pre>
    </div>
  );
}
