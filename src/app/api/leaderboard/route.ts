import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addScoreIdempotent, countRecentScores, getLeaderboard, getUserBest } from "@/lib/db";

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
  let body: { runId?: string; runValue?: number; depth?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const runValue = Number(body.runValue);
  const depth = Number(body.depth);
  // run ID：每局唯一，服务端校验格式，保证幂等
  const RUN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "runId 格式无效" }, { status: 400 });
  }
  if (!Number.isFinite(runValue) || runValue <= 0 || runValue > 1e9 || !Number.isFinite(depth) || depth < 0 || depth > 1e5) {
    return NextResponse.json({ error: "成绩数据无效" }, { status: 400 });
  }
  // 限流：每小时最多 20 次提交
  const RATE_WINDOW_MS = 3600_000;
  const RATE_MAX = 20;
  if (countRecentScores(user.id, Date.now() - RATE_WINDOW_MS) >= RATE_MAX) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 });
  }
  addScoreIdempotent(user.id, runValue, depth, runId);
  const best = getUserBest(user.id);
  return NextResponse.json({ ok: true, best });
}
