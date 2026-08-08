import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserBest } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });
  const best = getUserBest(user.id);
  return NextResponse.json({ user: { id: user.id, username: user.username }, best });
}
