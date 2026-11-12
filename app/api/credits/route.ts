import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDailyCredits } from "@/lib/rate-limiter";

export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const credits = await getDailyCredits(session.user.id);

    return NextResponse.json(credits, {
      headers: {
        "Cache-Control": "no-store",
        "X-Credits-Limit": String(credits.limit),
        "X-Credits-Remaining": String(credits.remaining),
      },
    });
  } catch (error) {
    console.error("GET /api/credits error:", error);
    return NextResponse.json(
      { error: "Failed to fetch credit balance" },
      { status: 500 }
    );
  }
}

