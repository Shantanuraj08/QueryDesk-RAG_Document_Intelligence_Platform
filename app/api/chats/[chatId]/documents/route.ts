
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  consumeDailyCredits,
  refundDailyCredits,
  DAILY_CREDIT_LIMIT,
  DOCUMENT_UPLOAD_CREDIT_COST,
} from "@/lib/rate-limiter";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".txt"]);

const MAX_DOCUMENTS_PER_CHAT = 3;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  let documentId: string | undefined;
  let chargedUserId: string | undefined;

  try {
    // 1. Authenticate the user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Verify chat ownership
    const { chatId } = await params;

    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: session.user.id,
      },
      select: { id: true },
    });

    if (!chat) {
      return NextResponse.json(
        { error: "Chat not found" },
        { status: 404 }
      );
    }

    // 3. Verify per-chat document limit
    const existingCount = await prisma.document.count({
      where: { chatId },
    });

    if (existingCount >= MAX_DOCUMENTS_PER_CHAT) {
      return NextResponse.json(
        {
          error: `Maximum of ${MAX_DOCUMENTS_PER_CHAT} documents per chat reached. Please delete an existing document or create a new chat.`,
        },
        { status: 403 }
      );
    }

    // 4. Read and validate the uploaded file
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Please provide a non-empty file" },
        { status: 400 }
      );
    }

    const extension = file.name
      .slice(file.name.lastIndexOf("."))
      .toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: "Only PDF, DOCX, and TXT files are allowed" },
        { status: 415 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size must not exceed 10 MB" },
        { status: 413 }
      );
    }

    // 5. Deduct daily upload credits (3 credits per upload out of 30/day)
    const credits = await consumeDailyCredits(
      session.user.id,
      DOCUMENT_UPLOAD_CREDIT_COST,
      DAILY_CREDIT_LIMIT
    );

    if (!credits.allowed) {
      return NextResponse.json(
        {
          error: `Insufficient daily credits (${DOCUMENT_UPLOAD_CREDIT_COST} required, ${credits.remaining} remaining). Allowance resets at midnight UTC.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(credits.resetSeconds),
            "X-Credits-Limit": String(credits.limit),
            "X-Credits-Remaining": String(credits.remaining),
          },
        }
      );
    }

    chargedUserId = session.user.id;

    // 6. Create the PostgreSQL document record
    const document = await prisma.document.create({
      data: {
        chatId,
        name: file.name,
        status: "PENDING",
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    documentId = document.id;

    // 5. Forward the file and IDs to FastAPI
    const ragBaseUrl = process.env.RAG_SERVICE_URL;

    if (!ragBaseUrl) {
      throw new Error("RAG_SERVICE_URL is not configured");
    }

    const ragFormData = new FormData();
    ragFormData.append("file", file, file.name);
    ragFormData.append("chat_id", chatId);
    ragFormData.append("document_id", document.id);

    const ragResponse = await fetch(
      `${ragBaseUrl.replace(/\/+$/, "")}/upload`,
      {
        method: "POST",
        body: ragFormData,
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!ragResponse.ok) {
      throw new Error(
        `FastAPI returned status ${ragResponse.status}`
      );
    }

    const ragResult = await ragResponse.json();

    if (!ragResult.task_id) {
      throw new Error("No task_id returned from RAG ingestion service");
    }

    return NextResponse.json(
      {
        document,
        taskId: ragResult.task_id,
        status: "ACCEPTED",
      },
      {
        status: 202,
        headers: {
          "X-Credits-Limit": String(credits.limit),
          "X-Credits-Remaining": String(credits.remaining),
        },
      }
    );
  } catch (error) {
    console.error("Document upload error:", error);

    let remainingCredits: number | null = null;
    if (chargedUserId) {
      remainingCredits = await refundDailyCredits(
        chargedUserId,
        DOCUMENT_UPLOAD_CREDIT_COST
      );
    }

    // 7. Mark the record as failed if one was created
    if (documentId) {
      try {
        await prisma.document.update({
          where: { id: documentId },
          data: { status: "FAILED" },
        });
      } catch (dbError) {
        console.error("Failed to update document status:", dbError);
      }
    }

    return NextResponse.json(
      { error: "Document upload or processing failed" },
      {
        status: 500,
        ...(remainingCredits !== null && {
          headers: {
            "X-Credits-Limit": String(DAILY_CREDIT_LIMIT),
            "X-Credits-Remaining": String(remainingCredits),
          },
        }),
      }
    );
  }
}



type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  try {
    // 1. Authenticate the user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Get chat ID from the route
    const { chatId } = await params;

    // 3. Verify chat ownership
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: session.user.id,
      },
      select: { id: true },
    });

    if (!chat) {
      return NextResponse.json(
        { error: "Chat not found" },
        { status: 404 }
      );
    }

    // 4. Read pagination parameters
    const { searchParams } = new URL(request.url);

    const rawLimit = searchParams.get("limit") ?? "10";
    const limit = Number(rawLimit);
    const cursor = searchParams.get("cursor");

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      return NextResponse.json(
        { error: "Limit must be between 1 and 50" },
        { status: 400 }
      );
    }

    // 5. Validate cursor belongs to this chat
    if (cursor) {
      const cursorDocument = await prisma.document.findFirst({
        where: {
          id: cursor,
          chatId,
        },
        select: { id: true },
      });

      if (!cursorDocument) {
        return NextResponse.json(
          { error: "Invalid cursor" },
          { status: 400 }
        );
      }
    }

    // 6. Fetch one extra document to detect more results
    const documents = await prisma.document.findMany({
      where: { chatId },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasMore = documents.length > limit;
    const page = hasMore
      ? documents.slice(0, limit)
      : documents;

    const nextCursor = hasMore
      ? page[page.length - 1].id
      : null;

    // 7. Return paginated document metadata
    return NextResponse.json({
      documents: page,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error("GET /api/chats/[chatId]/documents:", error);

    return NextResponse.json(
      { error: "Failed to fetch documents" },
      { status: 500 }
    );
  }
}