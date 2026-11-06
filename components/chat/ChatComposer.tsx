"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

interface ChatComposerProps {
  onSendMessage: (question: string) => Promise<void>;
  isLoading?: boolean;
  disabled?: boolean;
}

export function ChatComposer({
  onSendMessage,
  isLoading = false,
  disabled = false,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const effectiveLoading = isLoading || isSubmitting;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        140
      )}px`;
    }
  }, [input]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || effectiveLoading || disabled) return;

    setIsSubmitting(true);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await onSendMessage(trimmed);
    } catch {
      setInput(trimmed);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = input.trim().length > 0 && !effectiveLoading && !disabled;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pb-4 pt-2">
      <form onSubmit={handleSubmit} className="relative">
        <div className="border border-gray-200 rounded-2xl bg-[#f9f9f9] p-3 focus-within:border-gray-300 focus-within:bg-white transition-all shadow-2xs">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your uploaded documents..."
            disabled={disabled || effectiveLoading}
            className="w-full bg-transparent border-0 outline-none resize-none text-xs sm:text-sm text-gray-800 placeholder-gray-400 min-h-[44px] max-h-36 pr-10 leading-relaxed block"
          />

          <div className="flex justify-end mt-1">
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label="Send message"
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                canSubmit
                  ? "bg-gray-800 text-white hover:bg-black cursor-pointer"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed opacity-60"
              }`}
            >
              {effectiveLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ArrowUp size={14} />
              )}
            </button>
          </div>
        </div>
      </form>

      <p className="text-[11px] text-gray-400 text-center mt-2 select-none">
        AI responses may be inaccurate. Check the cited sources.
      </p>
    </div>
  );
}
