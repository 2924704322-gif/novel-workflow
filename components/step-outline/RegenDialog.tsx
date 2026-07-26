// 重新生成方向弹框：让用户先描述想要的调整方向，再带着方向重生。方向可留空（等同普通重生）。
export function RegenDialog({
  title,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="panel fadeup"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: "100%", maxWidth: 520 }}
      >
        <h3 style={{ fontSize: 17, marginBottom: 6 }}>{title}</h3>
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 14 }}>
          请描述这次想要的调整方向（如：节奏更紧凑、多一条感情副线、世界观更暗黑、主角改为反英雄……）。留空则直接重新生成。
        </p>
        <textarea
          className="textarea"
          rows={4}
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例：弱化主角金手指，强化势力博弈；基调转为悬疑推理……"
        />
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 16,
          }}
        >
          <button className="btn btn--ghost btn--sm" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn--primary btn--sm" onClick={onConfirm}>
            {value.trim() ? "按此方向重生" : "直接重生"}
          </button>
        </div>
      </div>
    </div>
  );
}
