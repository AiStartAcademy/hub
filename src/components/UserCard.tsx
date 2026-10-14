"use client";

import { Mail, Calendar } from "lucide-react";

interface UserCardProps {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  bio?: string | null;
  role?: string;
  createdAt?: string;
  showBio?: boolean;
  clickable?: boolean;
  className?: string;
}

const getRoleColor = (role?: string) => {
  switch (role) {
    case "ADMIN":
      return "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300";
    case "INSTRUCTOR":
      return "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300";
    case "EVENT_ORGANIZER":
      return "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300";
    case "TEAM_MEMBER":
      return "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300";
    case "STUDENT":
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
    default:
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
  }
};

const getRoleLabel = (role: string) => {
  switch (role) {
    case "EVENT_ORGANIZER":
      return "Event Organizer";
    case "TEAM_MEMBER":
      return "Team Member";
    default:
      return role;
  }
};

const stripHtmlTags = (html: string) => {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

const truncateBio = (bio: string | null | undefined, maxChars: number = 150) => {
  if (!bio) return "";
  const plainText = stripHtmlTags(bio);
  return plainText.length > maxChars
    ? plainText.substring(0, maxChars) + "..."
    : plainText;
};

export default function UserCard({
  id,
  name,
  email,
  image,
  bio,
  role,
  createdAt,
  showBio = true,
  clickable = true,
  className = "",
}: UserCardProps) {
  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
      })
    : null;

  const handleCardClick = () => {
    if (clickable) {
      window.location.href = `/users/${id}`;
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-all ${
        clickable
          ? "hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer"
          : ""
      } ${className}`}
    >
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            {image ? (
              <img
                src={image}
                alt={name || "User"}
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-semibold text-slate-500">
                  {name?.[0]?.toUpperCase() || "?"}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                {name || "Anonymous"}
              </h3>
              {role && (
                <span
                  className={`inline-block text-xs font-medium px-2 py-1 rounded-md mt-2 ${getRoleColor(
                    role
                  )}`}
                >
                  {getRoleLabel(role)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Email */}
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 min-w-0">
          <Mail className="w-4 h-4 flex-shrink-0" />
          <a
            href={`mailto:${email}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-primary truncate"
          >
            {email}
          </a>
        </div>

        {/* Bio */}
        {showBio && bio && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3">
              {truncateBio(bio)}
            </p>
          </div>
        )}

        {/* Created Date */}
        {formattedDate && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
            <Calendar className="w-3.5 h-3.5" />
            Joined {formattedDate}
          </div>
        )}
      </div>
    </div>
  );
}
