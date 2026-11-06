"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { MessageTurn } from "./types";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  turns: MessageTurn[];
  pendingQuestion?: string | null;
  isLoading?: boolean;
  hasMore?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => Promise<void>;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function MessageList({
  turns,
  pendingQuestion,
  isLoading = false,
  hasMore = false,
  isLoadingOlder = false,
  onLoadOlder,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);
  const prevFirstTurnIdRef = useRef<string | null>(null);
  const prevTurnsLengthRef = useRef<number>(0);

  // Detect scrolling near the top to trigger loading older messages
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    prevScrollTopRef.current = container.scrollTop;
    prevScrollHeightRef.current = container.scrollHeight;

    if (container.scrollTop < 60 && hasMore && !isLoadingOlder && onLoadOlder) {
      onLoadOlder();
    }
  };

  // Adjust scroll position synchronously before paint when older messages are prepended
  useIsomorphicLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const currentFirstTurnId = turns[0]?.id ?? null;
    const isPrepended =
      prevFirstTurnIdRef.current !== null &&
      turns.length > prevTurnsLengthRef.current &&
      currentFirstTurnId !== prevFirstTurnIdRef.current;

    if (isPrepended) {
      // Content was prepended at top: restore scroll position relative to previous top
      const newScrollHeight = container.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeightRef.current;
      container.scrollTop = prevScrollTopRef.current + heightDiff;
    } else {
      // New message added, initial load, or pending question -> scroll to bottom
      bottomRef.current?.scrollIntoView({
        behavior: prevTurnsLengthRef.current === 0 ? "instant" : "smooth",
      });
    }

    prevScrollHeightRef.current = container.scrollHeight;
    prevScrollTopRef.current = container.scrollTop;
    prevFirstTurnIdRef.current = currentFirstTurnId;
    prevTurnsLengthRef.current = turns.length;
  }, [turns, pendingQuestion, isLoading]);

  const isEmpty = turns.length === 0 && !pendingQuestion;

  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-10 h-10 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0 mb-3 shadow-2xs">
          <Image
            src="/images/netherstar.webp"
            alt="QueryDesk"
            width={24}
            height={24}
            className="w-6 h-6 object-contain"
          />
        </div>
        <h3 className="text-base font-semibold text-gray-800">
          Your Document Intelligence Workspace
        </h3>
        <p className="text-xs text-gray-400 mt-1.5 max-w-md leading-relaxed">
          Start exploring your documents. Upload a PDF, DOCX, or TXT file and ask questions to get context-aware answers.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6 max-w-3xl w-full mx-auto"
    >
      {isLoadingOlder && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin text-amber-500 shrink-0" />
          <span>Loading older messages...</span>
        </div>
      )}

      {turns.map((turn) => (
        <MessageItem key={turn.id} turn={turn} />
      ))}

      {pendingQuestion && (
        <div className="space-y-4">
          {/* User question */}
          <div className="flex justify-end items-start gap-2.5">
            <div className="bg-gray-100 text-gray-800 text-xs sm:text-sm px-4 py-2.5 rounded-2xl max-w-[80%] leading-relaxed">
              {pendingQuestion}
            </div>
            <div className="w-7 h-7 rounded-full bg-gray-100 border border-gray-200/50 flex items-center justify-center text-gray-500 shrink-0 mt-0.5">
              <span className="text-[10px]">You</span>
            </div>
          </div>

          {/* Pending AI state */}
          <div className="flex flex-col items-start max-w-[85%]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center overflow-hidden shrink-0 bg-white shadow-2xs">
                <Image
                  src="/images/netherstar.webp"
                  alt="QueryDesk"
                  width={16}
                  height={16}
                  className="w-4 h-4 object-contain"
                />
              </div>
              <span className="text-xs font-semibold text-gray-900">QueryDesk</span>
            </div>

            <div className="pl-8 mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse delay-150" />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse delay-300" />
              <span className="ml-1 text-[11px]">Searching documents &amp; generating answer...</span>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} className="h-1" />
    </div>
  );
}
