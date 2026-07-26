import { Fragment } from "react";

export function StepNav({
  current,
  canStep2,
  canStep3,
  step1Done,
  step2Done,
  step3Done,
  go,
}: {
  current: 1 | 2 | 3;
  canStep2: boolean;
  canStep3: boolean;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
  go: (n: 1 | 2 | 3) => void;
}) {
  const steps = [
    { n: 1 as const, label: "创作设定", done: step1Done },
    { n: 2 as const, label: "故事设定集", done: step2Done },
    { n: 3 as const, label: "分卷脉络", done: step3Done },
  ];
  const enabled = (n: 1 | 2 | 3) =>
    n === 1 || (n === 2 && canStep2) || (n === 3 && canStep3);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 28,
        flexWrap: "wrap",
      }}
    >
      {steps.map((st, i) => {
        const active = current === st.n;
        const on = enabled(st.n);
        return (
          <Fragment key={st.n}>
            <button
              onClick={() => on && go(st.n)}
              disabled={!on}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                background: "none",
                border: "none",
                padding: "4px 6px",
                cursor: on ? "pointer" : "not-allowed",
                opacity: on ? 1 : 0.45,
              }}
            >
              <span
                className="seal seal--sm"
                style={{
                  background: active ? undefined : "var(--ink-700)",
                  color: active ? undefined : "var(--fg-dim)",
                  boxShadow: active
                    ? undefined
                    : "0 0 0 1px var(--line-strong) inset",
                }}
              >
                {st.done && !active ? "✓" : st.n}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 15,
                  color: active ? "var(--fg)" : "var(--fg-dim)",
                }}
              >
                {st.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: "0 0 36px",
                  height: 1,
                  margin: "0 6px",
                  background: "var(--line-strong)",
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
