import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, verifyPassword } from "@/lib/auth";
import { findUserByUsername } from "@/lib/db";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  await createSessionToken(user.id);
  return NextResponse.json({ ok: true, user: { id: user.id, username: user.username } });
}
