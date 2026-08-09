import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  addScoreIdempotent,
  countRecentScores,
  getLeaderboard,
  getUserBest,
  isScoreKind,
  type ScoreKind,
} from "@/lib/db";

const RUN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RATE_WINDOW_MS = 3_600_000;
const RATE_MAX = 20;
const MAX_RUN_VALUE = 1e9;
const MAX_DEPTH = 1e5;
const MAX_ABS_NET = 1e9;

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
  const kindParam = req.nextUrl.searchParams.get("kind") ?? "value";
  if (!isScoreKind(kindParam)) {
    return NextResponse.json({ error: "排行榜类型无效" }, { status: 400 });
  }

  const list = getLeaderboard(limit, kindParam);
  const me = await getCurrentUser();
  const myBest = me ? getUserBest(me.id, kindParam) : null;
  return NextResponse.json({ list, me: me ? { username: me.username, ...myBest } : null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录后再提交成绩" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const body = rawBody as Record<string, unknown>;
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const runValue = body.runValue;
  const depth = body.depth;
  const kind: unknown = body.kind === undefined ? "value" : body.kind;

  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "runId 格式无效" }, { status: 400 });
  }
  if (!isScoreKind(kind)) {
    return NextResponse.json({ error: "排行榜类型无效" }, { status: 400 });
  }
  if (
    typeof runValue !== "number" ||
    !Number.isFinite(runValue) ||
    runValue <= 0 ||
    runValue > MAX_RUN_VALUE ||
    typeof depth !== "number" ||
    !Number.isFinite(depth) ||
    depth < 0 ||
    depth > MAX_DEPTH
  ) {
    return NextResponse.json({ error: "成绩数据无效" }, { status: 400 });
  }

  const netValidation = validateNet(kind, body.net, runValue);
  if (!netValidation.ok) {
    return NextResponse.json({ error: "净收益数据无效" }, { status: 400 });
  }

  // 每小时最多 20 次成功提交；重复 runId 不会新增计数。
  if (countRecentScores(user.id, Date.now() - RATE_WINDOW_MS) >= RATE_MAX) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 });
  }

  addScoreIdempotent(user.id, runValue, depth, runId, kind, netValidation.value);
  const best = getUserBest(user.id, kind);
  return NextResponse.json({ ok: true, best });
}

function validateNet(
  kind: ScoreKind,
  rawNet: unknown,
  runValue: number
): { ok: true; value: number } | { ok: false } {
  if (kind !== "net") return { ok: true, value: runValue };
  if (typeof rawNet !== "number" || !Number.isInteger(rawNet) || Math.abs(rawNet) > MAX_ABS_NET) {
    return { ok: false };
  }
  return { ok: true, value: rawNet };
}
