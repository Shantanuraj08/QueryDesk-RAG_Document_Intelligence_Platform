"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, LogOut, X } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Chat, DocumentItem, UserSession } from "./types";
import { FileUploadSection } from "./FileUploadSection";
import { ChatHistory } from "./ChatHistory";

interface ChatSidebarProps {
  user: UserSession;
  chats: Chat[];
  activeChatId: string | null;
  documents: DocumentItem[];
  isOpen: boolean;
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => Promise<void>;
  onUploadDocument: (file: File) => Promise<void>;
  onDeleteDocument: (docId: string) => Promise<void>;
  isUploading?: boolean;
  remainingCredits?: number | null;
  creditLimit?: number;
}

export function ChatSidebar({
  user,
  chats,
  activeChatId,
  documents,
  isOpen,
  onClose,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onUploadDocument,
  onDeleteDocument,
  isUploading = false,
  remainingCredits = null,
  creditLimit = 30,
}: ChatSidebarProps) {
  const router = useRouter();
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const handleSignOut = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push("/login");
            router.refresh();
          },
        },
      });
    } catch {
      router.push("/login");
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-gray-50/70 border-r border-gray-200/80 flex flex-col transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Top Branding Section */}
        <div className="p-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
              <Image
                src="/images/netherstar.webp"
                alt="QueryDesk"
                width={20}
                height={20}
                className="w-5 h-5 object-contain"
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 tracking-tight leading-none">
                QueryDesk
              </div>
              <div className="text-[11px] text-gray-400 font-normal leading-tight mt-0.5">
                Document Intelligence
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="md:hidden p-1 text-gray-400 hover:text-gray-600 rounded-md"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable middle body */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
          {/* File Upload Section */}
          <FileUploadSection
            documents={documents}
            onUpload={onUploadDocument}
            onDeleteDocument={onDeleteDocument}
            isUploading={isUploading}
          />

          {/* New Chat Button */}
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-2xs"
          >
            <Plus size={14} className="text-gray-500" />
            <span>New chat</span>
          </button>

          {/* Chat History Section */}
          <ChatHistory
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={(id) => {
              onSelectChat(id);
              onClose();
            }}
            onDeleteChat={onDeleteChat}
          />
        </div>

        {/* Daily Credits Badge */}
        {remainingCredits !== null && (
          <div className="px-3 py-2 border-t border-gray-200/60 bg-white/40">
            <div className="flex items-center justify-between text-[11px] font-medium mb-1">
              <span
                className={
                  remainingCredits === 0
                    ? "text-red-600"
                    : remainingCredits <= 6
                    ? "text-amber-700"
                    : "text-gray-600"
                }
              >
                ⚡ {remainingCredits} / {creditLimit} daily credits
              </span>
            </div>
            <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  remainingCredits === 0
                    ? "bg-red-500"
                    : remainingCredits <= 6
                    ? "bg-amber-500"
                    : "bg-gray-700"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, (remainingCredits / Math.max(1, creditLimit)) * 100)
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* User Account / Footer */}
        <div className="p-3 border-t border-gray-200/80 bg-white/60">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {user.image && failedImageUrl !== user.image ? (
                <Image
                  src={user.image}
                  alt={user.name || "User"}
                  width={28}
                  height={28}
                  onError={() => setFailedImageUrl(user.image ?? null)}
                  className="w-7 h-7 rounded-full object-cover shrink-0 border border-gray-200"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-semibold shrink-0 uppercase">
                  {user.name ? user.name[0] : user.email[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-gray-800 truncate">
                  {user.name || "User"}
                </div>
                <div className="text-[11px] text-gray-400 truncate">
                  {user.email}
                </div>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              title="Sign out"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
