"use client";

import { useState } from "react";
import { FileText, CheckCircle2, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { DocumentItem } from "./types";

interface UploadedFileItemProps {
  document: DocumentItem;
  onDelete?: (documentId: string) => Promise<void>;
}

export function UploadedFileItem({ document, onDelete }: UploadedFileItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDelete || isDeleting) return;

    const isTemp = document.id.startsWith("temp-");
    const confirmMessage = isTemp
      ? `Remove "${document.name}"?`
      : `Delete document "${document.name}" and its vectors?`;

    if (window.confirm(confirmMessage)) {
      setIsDeleting(true);
      try {
        await onDelete(document.id);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const getStatusText = () => {
    switch (document.status) {
      case "READY":
        return document.size ? `${document.size} · Ready` : "Ready";
      case "UPLOADING":
        return "Uploading...";
      case "PROCESSING":
      case "PENDING":
        return "Processing...";
      case "FAILED":
        return document.errorMessage || "Failed · Retry needed";
      default:
        return document.status;
    }
  };

  const renderStatusIcon = () => {
    switch (document.status) {
      case "READY":
        return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
      case "UPLOADING":
      case "PROCESSING":
      case "PENDING":
        return <Loader2 size={14} className="text-amber-500 animate-spin shrink-0" />;
      case "FAILED":
        return <AlertCircle size={14} className="text-red-500 shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center justify-between py-1.5 px-1.5 rounded-lg hover:bg-gray-100/70 group transition-colors">
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
        <FileText size={14} className="text-gray-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-gray-700 truncate" title={document.name}>
            {document.name}
          </p>
          <p
            className={`text-[10px] leading-none mt-0.5 truncate ${
              document.status === "FAILED" ? "text-red-500 font-medium" : "text-gray-400"
            }`}
            title={document.errorMessage || getStatusText()}
          >
            {getStatusText()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onDelete && document.status !== "UPLOADING" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            aria-label={document.status === "FAILED" ? `Remove ${document.name}` : `Delete ${document.name}`}
            className={`${
              document.status === "FAILED"
                ? "opacity-100 text-red-500 hover:text-red-700"
                : "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600"
            } transition-opacity p-0.5 focus:opacity-100 focus:outline-none`}
            title={document.status === "FAILED" ? "Remove failed entry" : "Delete document"}
          >
            {isDeleting ? (
              <Loader2 size={12} className="animate-spin text-gray-400" />
            ) : (
              <Trash2 size={12} />
            )}
          </button>
        )}
        {renderStatusIcon()}
      </div>
    </div>
  );
}
