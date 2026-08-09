import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, hashPassword, verifyPassword } from "@/lib/auth";
import { findUserByUsername, updateUserPasswordHash } from "@/lib/db";

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
  if (!user) {
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  let valid = verifyPassword(password, user.password_hash);
  if (!valid && user.password_hash.indexOf(":") === -1 && password === user.password_hash) {
    // 旧版明文密码迁移：验证通过后改写为 scrypt 哈希
    valid = true;
    updateUserPasswordHash(user.id, hashPassword(password));
  }
  if (!valid) {
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }
  await createSessionToken(user.id);
  return NextResponse.json({ ok: true, user: { id: user.id, username: user.username } });
}
