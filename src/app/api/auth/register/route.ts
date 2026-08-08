import { NextRequest, NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";
import { createUser, findUserByUsername } from "@/lib/db";

const USERNAME_RE = /^[\w\u4e00-\u9fa5]{2,16}$/;

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: "用户名需为 2-16 位字母/数字/下划线/中文" }, { status: 400 });
  }
  if (password.length < 6 || password.length > 64) {
    return NextResponse.json({ error: "密码长度需为 6-64 位" }, { status: 400 });
  }
  if (findUserByUsername(username)) {
    return NextResponse.json({ error: "该用户名已被注册" }, { status: 409 });
  }
  const user = createUser(username, password);
  await createSessionToken(user);
  return NextResponse.json({ ok: true, user: { id: user, username } });
}
