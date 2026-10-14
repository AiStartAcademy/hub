"use client";

import Link from "next/link";
import { Mail, ExternalLink } from "lucide-react";

interface InstructorCardProps {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  bio?: string | null;
  role?: string;
  onRemove?: () => void;
  canManage?: boolean;
  expandable?: boolean;
}

const stripHtmlTags = (html: string) => {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

const truncateBio = (bio: string | null | undefined, maxChars: number = 100) => {
  if (!bio) return "";
  const plainText = stripHtmlTags(bio);
  return plainText.length > maxChars
    ? plainText.substring(0, maxChars) + "..."
    : plainText;
};

export default function InstructorCard({
  id,
  name,
  email,
  image,
  bio,
  role,
  onRemove,
  canManage = false,
  expandable = true,
}: InstructorCardProps) {
  const handleCardClick = () => {
    if (expandable) {
      window.location.href = `/users/${id}`;
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className={`flex items-start justify-between p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:shadow-md dark:hover:bg-slate-800 transition-all ${
        expandable ? "cursor-pointer" : ""
      } group`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {image ? (
          <img
            src={image}
            alt={name || "Instructor"}
            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              {name?.[0]?.toUpperCase() || "?"}
            </span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
            {name || "Unnamed Instructor"}
          </h3>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            {role && (
              <span className="text-xs font-medium text-primary bg-primary/10 dark:bg-primary/20 px-2 py-1 rounded">
                {role}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 mb-2">
            <Mail className="w-3.5 h-3.5 flex-shrink-0" />
            <a
              href={`mailto:${email}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-primary truncate"
            >
              {email}
            </a>
          </div>

          {bio && (
            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
              {truncateBio(bio)}
            </p>
          )}
        </div>
      </div>

      {expandable && (
        <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-primary flex-shrink-0 ml-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}

      {canManage && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-2 px-2 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors flex-shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  );
}
