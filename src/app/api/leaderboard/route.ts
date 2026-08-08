import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addScore, getLeaderboard, getUserBest } from "@/lib/db";

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
  const list = getLeaderboard(limit);
  const me = await getCurrentUser();
  const myBest = me ? getUserBest(me.id) : null;
  return NextResponse.json({ list, me: me ? { username: me.username, ...myBest } : null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录后再提交成绩" }, { status: 401 });
  }
  let body: { runValue?: number; depth?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const runValue = Number(body.runValue);
  const depth = Number(body.depth);
  if (!Number.isFinite(runValue) || !Number.isFinite(depth) || runValue <= 0 || depth < 0) {
    return NextResponse.json({ error: "成绩数据无效" }, { status: 400 });
  }
  addScore(user.id, runValue, depth);
  const best = getUserBest(user.id);
  return NextResponse.json({ ok: true, best });
}
