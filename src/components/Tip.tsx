"use client";

import type { ReactNode } from "react";

// 通用说明浮层：鼠标悬停 / 聚焦（键盘或单击触发的 focus）即可查看说明。
// 包裹在任意内容外，通过 .tip-pop 显示 label 内容。
export default function Tip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="tip-wrap" tabIndex={0} aria-label={typeof label === "string" ? label : undefined}>
      {children}
      <span className="tip-pop" role="tooltip">{label}</span>
    </span>
  );
}
