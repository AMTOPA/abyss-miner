import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserSave, upsertUserSave } from "@/lib/db";

const MAX_SAVE_BYTES = 1024 * 1024; // 1MB：防滥用上限
const TS_DRIFT_MS = 2 * 24 * 60 * 60 * 1000; // 客户端时间戳允许 ±2 天

// GET：拉取当前登录用户的云存档（未登录返回 null）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ save: null, updatedAt: null });
  const row = getUserSave(user.id);
  if (!row) return NextResponse.json({ save: null, updatedAt: null });
  try {
    const save = JSON.parse(row.save_json);
    return NextResponse.json({ save, updatedAt: row.updated_at });
  } catch {
    return NextResponse.json({ save: null, updatedAt: null });
  }
}

// PUT：上传/覆盖云存档（最后写入者胜）
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: { save?: unknown; clientUpdatedAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  // v7：防御 null / 数组等异常 JSON 体
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!body.save || typeof body.save !== "object") {
    return NextResponse.json({ error: "存档数据无效" }, { status: 400 });
  }

  let saveJson: string;
  try {
    saveJson = JSON.stringify(body.save);
  } catch {
    return NextResponse.json({ error: "存档序列化失败" }, { status: 400 });
  }
  if (saveJson.length > MAX_SAVE_BYTES) {
    return NextResponse.json({ error: "存档过大" }, { status: 413 });
  }

  // 用客户端时间戳做跨设备比较；异常范围则回退到服务器时间
  let updatedAt = Date.now();
  const raw = Number(body.clientUpdatedAt);
  if (Number.isFinite(raw) && Math.abs(raw - Date.now()) <= TS_DRIFT_MS) {
    updatedAt = Math.round(raw);
  }

  upsertUserSave(user.id, saveJson, updatedAt);
  return NextResponse.json({ ok: true, updatedAt });
}
