"use client";

import { useState, useRef } from "react";
import { Folder, Upload, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { UploadedFileItem } from "./UploadedFileItem";
import { DocumentItem } from "./types";

interface FileUploadSectionProps {
  documents: DocumentItem[];
  onUpload: (file: File) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  isUploading?: boolean;
}

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_DOCUMENTS_PER_CHAT = 3;

export function FileUploadSection({
  documents,
  onUpload,
  onDeleteDocument,
  isUploading = false,
}: FileUploadSectionProps) {
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  const isLimitReached = documents.length >= MAX_DOCUMENTS_PER_CHAT;

  const validateAndUpload = async (file: File) => {
    if (isUploading || uploadingRef.current) return;
    setErrorMessage(null);

    if (isLimitReached) {
      setErrorMessage(`Maximum of ${MAX_DOCUMENTS_PER_CHAT} documents per chat reached.`);
      return;
    }

    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setErrorMessage("Only PDF, DOCX, and TXT files are allowed.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage("File exceeds the 10 MB limit.");
      return;
    }

    uploadingRef.current = true;
    setIsSectionOpen(true);
    try {
      await onUpload(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload document.";
      setErrorMessage(msg);
    } finally {
      uploadingRef.current = false;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUploading || uploadingRef.current) return;
    const file = e.target.files?.[0];
    if (file) {
      validateAndUpload(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading || uploadingRef.current || isLimitReached) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndUpload(file);
    }
  };

  return (
    <div>
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setIsSectionOpen(!isSectionOpen)}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 py-1.5 focus:outline-none"
      >
        <div className="flex items-center gap-1.5">
          <Folder size={13} className="text-gray-500" />
          <span>Knowledge documents</span>
          <span className="text-[10px] text-gray-400 font-normal">
            ({documents.length}/{MAX_DOCUMENTS_PER_CHAT})
          </span>
        </div>
        {isSectionOpen ? (
          <ChevronDown size={13} className="text-gray-400" />
        ) : (
          <ChevronUp size={13} className="text-gray-400" />
        )}
      </button>

      {isSectionOpen && (
        <div className="mt-1">
          {/* Dropzone Card */}
          <div
            onClick={() => {
              if (!isUploading && !uploadingRef.current && !isLimitReached) {
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isLimitReached) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border rounded-xl p-3.5 text-center transition-colors shadow-2xs ${
              isLimitReached
                ? "border-gray-200 bg-gray-50/60 cursor-not-allowed opacity-80"
                : isDragging
                ? "border-gray-400 bg-gray-50/80 cursor-pointer"
                : "border-gray-200 bg-white hover:border-gray-300 cursor-pointer"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={handleFileChange}
              disabled={isLimitReached}
              className="hidden"
            />

            <div className="w-8 h-8 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-2 text-gray-600">
              {isUploading ? (
                <Loader2 size={14} className="animate-spin text-gray-500" />
              ) : (
                <Upload size={14} className={isLimitReached ? "text-gray-400" : ""} />
              )}
            </div>

            <p className="text-xs font-semibold text-gray-800">
              {isUploading
                ? "Uploading..."
                : isLimitReached
                ? `Chat limit reached (${MAX_DOCUMENTS_PER_CHAT}/${MAX_DOCUMENTS_PER_CHAT})`
                : "Upload knowledge documents"}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {isLimitReached
                ? "Delete a document to add another"
                : "Click or drag and drop"}
            </p>
            {!isLimitReached && (
              <p className="text-[10px] text-gray-400 mt-1 uppercase font-medium tracking-wide">
                PDF, DOCX, TXT
              </p>
            )}
          </div>

          {errorMessage && (
            <p className="text-[11px] text-red-500 mt-1.5 px-1 leading-tight">
              {errorMessage}
            </p>
          )}

          {/* Uploaded Files Section */}
          <div className="mt-4">
            <h4 className="text-[10px] font-semibold text-gray-400 tracking-wider uppercase mb-1.5 px-0.5">
              UPLOADED DOCUMENTS
            </h4>

            {documents.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic px-1 py-1">
                No documents uploaded yet
              </p>
            ) : (
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {documents.map((doc) => (
                  <UploadedFileItem
                    key={doc.id}
                    document={doc}
                    onDelete={onDeleteDocument}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
