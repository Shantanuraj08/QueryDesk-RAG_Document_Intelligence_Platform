import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  refundDailyCredits,
  DAILY_CREDIT_LIMIT,
  DOCUMENT_UPLOAD_CREDIT_COST,
} from "@/lib/rate-limiter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string; documentId: string }> }
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

    const { chatId, documentId } = await params;

    // 2. Verify chat ownership
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

    // 3. Verify document exists in this chat
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        chatId,
      },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // If document is already in a terminal state in the database, return immediately
    if (document.status === "READY" || document.status === "FAILED") {
      return NextResponse.json({
        status: document.status,
        document,
      });
    }

    // 4. Read taskId query param
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({
        status: document.status,
        document,
      });
    }

    // 5. Query FastAPI Celery task status
    const ragServiceUrl = process.env.RAG_SERVICE_URL;
    if (!ragServiceUrl) {
      console.error("RAG_SERVICE_URL is not configured");
      return NextResponse.json(
        { error: "RAG service is not configured" },
        { status: 500 }
      );
    }

    let ragResponse: Response;
    try {
      ragResponse = await fetch(
        `${ragServiceUrl.replace(/\/+$/, "")}/tasks/${taskId}`,
        {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        }
      );
    } catch (fetchError) {
      console.error("Failed to reach FastAPI task status:", fetchError);
      // Return existing status without failing prematurely
      return NextResponse.json({
        status: document.status,
        document,
      });
    }

    if (!ragResponse.ok) {
      console.error(
        `FastAPI /tasks/${taskId} returned status ${ragResponse.status}`
      );
      return NextResponse.json({
        status: document.status,
        document,
      });
    }

    const taskData = await ragResponse.json();
    const taskStatus = taskData.status;

    // 6. Handle task state mutations in PostgreSQL
    if (taskStatus === "SUCCESS") {
      const updatedDoc = await prisma.document.update({
        where: { id: documentId },
        data: { status: "READY" },
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return NextResponse.json({
        status: "READY",
        document: updatedDoc,
        result: taskData.result,
      });
    }

    if (taskStatus === "FAILURE") {
      // Atomic conditional transition so concurrent status polls cannot double-refund
      const transition = await prisma.document.updateMany({
        where: {
          id: documentId,
          status: { notIn: ["READY", "FAILED"] },
        },
        data: { status: "FAILED" },
      });

      let remainingCredits: number | null = null;
      if (transition.count === 1) {
        remainingCredits = await refundDailyCredits(
          session.user.id,
          DOCUMENT_UPLOAD_CREDIT_COST
        );
      }

      const updatedDoc = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return NextResponse.json(
        {
          status: "FAILED",
          document: updatedDoc ?? document,
          error: taskData.error || "Document ingestion failed",
        },
        remainingCredits !== null
          ? {
              headers: {
                "X-Credits-Limit": String(DAILY_CREDIT_LIMIT),
                "X-Credits-Remaining": String(remainingCredits),
              },
            }
          : undefined
      );
    }

    if (taskStatus === "PROCESSING") {
      let currentDoc = document;
      if (document.status === "PENDING") {
        currentDoc = await prisma.document.update({
          where: { id: documentId },
          data: { status: "PROCESSING" },
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      }

      return NextResponse.json({
        status: "PROCESSING",
        document: currentDoc,
        meta: taskData.meta || {},
      });
    }

    // Default / PENDING
    return NextResponse.json({
      status: "PENDING",
      document,
    });
  } catch (error) {
    console.error("Status bridge endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error while checking status" },
      { status: 500 }
    );
  }
}

