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
const DIFFICULTIES = ["mild", "normal", "hardcore"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

// v7：一次结算写入多个派生榜（价值/最深/净收益，硬核模式另写硬核榜）
function kindsFor(difficulty: Difficulty | null): ScoreKind[] {
  const kinds: ScoreKind[] = ["value", "depth", "net"];
  if (difficulty === "hardcore") kinds.push("hardcore");
  return kinds;
}

export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));
  const kindParam = req.nextUrl.searchParams.get("kind") ?? "value";
  if (!isScoreKind(kindParam)) {
    return NextResponse.json({ error: "排行榜类型无效" }, { status: 400 });
  }

  // v11??????? UTC ????????????
  let dayFilter: string | undefined;
  if (kindParam === "daily") {
    dayFilter = req.nextUrl.searchParams.get("day") || new Date().toISOString().slice(0, 10);
  }
  const list = getLeaderboard(limit, kindParam, dayFilter);
  const me = await getCurrentUser();
  const myBest = me ? getUserBest(me.id, kindParam) : null;
  return NextResponse.json({ list, me: me ? { username: me.username, ...myBest } : null, day: dayFilter ?? null });
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
  const difficultyRaw: unknown = body.difficulty === undefined ? "normal" : body.difficulty;
  const net = body.net;

  if (!RUN_ID_RE.test(runId)) {
    return NextResponse.json({ error: "runId 格式无效" }, { status: 400 });
  }
  if (!DIFFICULTIES.includes(difficultyRaw as Difficulty)) {
    return NextResponse.json({ error: "难度无效" }, { status: 400 });
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
  if (
    typeof net !== "number" ||
    !Number.isInteger(net) ||
    !Number.isFinite(net) ||
    Math.abs(net) > MAX_ABS_NET
  ) {
    return NextResponse.json({ error: "净收益数据无效" }, { status: 400 });
  }
  // v9 防作弊：净收益 = 入库价值 - 出发花费（花费 ≥ 0），不可能大于入库价值
  if (net > runValue) {
    return NextResponse.json({ error: "成绩数据不合理（净收益超过入库价值）" }, { status: 400 });
  }

  // 每小时最多 20 次成功提交；重复 runId 不会新增计数。
  if (countRecentScores(user.id, Date.now() - RATE_WINDOW_MS) >= RATE_MAX) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 });
  }

  const difficulty = difficultyRaw as Difficulty;
  // v11????????????????runId ?? daily-<date>-????????
  const dailyDay = typeof body.dailyDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dailyDay) ? body.dailyDay : null;
  let inserted = 0;
  if (dailyDay) {
    const dailyRunId = `daily-${dailyDay}-${runId}`;
    if (addScoreIdempotent(user.id, runValue, depth, dailyRunId, "daily", runValue)) inserted++;
  } else {
    for (const kind of kindsFor(difficulty)) {
      if (addScoreIdempotent(user.id, runValue, depth, runId, kind, kind === "net" ? net : runValue)) inserted++;
    }
  }
  // 该局若已存在（重复 runId），视为幂等成功，不重复计数
  const best = getUserBest(user.id, "value");
  return NextResponse.json({ ok: true, inserted, best });
}