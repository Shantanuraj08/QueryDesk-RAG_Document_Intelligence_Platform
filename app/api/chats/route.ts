
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_CHATS = 5;

export async function POST() {
  try {
    // 1. Check authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Check the user's chat count
    const count = await prisma.chat.count({
      where: { userId: session.user.id },
    });

    if (count >= MAX_CHATS) {
      return NextResponse.json(
        { error: "Maximum of 5 chats reached" },
        { status: 403 }
      );
    }

    // 3. Create a new chat
    const chat = await prisma.chat.create({
      data: {
        userId: session.user.id,
        title: "New Chat",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    // 4. Return the created chat
    return NextResponse.json({ chat }, { status: 201 });

  } catch (error) {
    console.error("Create chat error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}




export async function GET() {
  try {
    // 1. Check authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Fetch the user's chats
    const chats = await prisma.chat.findMany({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // 3. Return the chats
    return NextResponse.json({ chats }, { status: 200 });

  } catch (error) {
    console.error("Fetch chats error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}



