"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, Mail, Calendar, Shield } from "lucide-react";
import Link from "next/link";

interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  bio: string | null;
  role: string;
  createdAt: string;
}

const getRoleLabel = (role: string) => {
  const labels: { [key: string]: string } = {
    ADMIN: "Administrator",
    INSTRUCTOR: "Instructor",
    EVENT_ORGANIZER: "Event Organizer",
    TEAM_MEMBER: "Team Member",
    STUDENT: "Student",
  };
  return labels[role] || role;
};

const getRoleColor = (role: string) => {
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

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = (params.userId as string) || "";

  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      if (!userId) {
        setError("Invalid user ID");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/users/${userId}/profile`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("User not found");
          } else {
            const errorData = await res.json().catch(() => ({}));
            setError(errorData.error || "Failed to load user profile");
          }
          return;
        }
        const data = await res.json();
        setUser(data);
      } catch (err) {
        console.error("Error fetching user:", err);
        setError(`Network error: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                {error || "User not found"}
              </h1>
              <Link
                href="/dashboard"
                className="text-primary hover:underline text-sm"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const formattedDate = new Date(user.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/dashboard"
            className="text-sm text-slate-600 dark:text-slate-400 hover:text-primary mb-6 inline-block"
          >
            ← Back
          </Link>
        </div>

        {/* Profile Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-lg overflow-hidden">
          {/* Cover */}
          <div className="h-32 bg-gradient-to-r from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10" />

          {/* Content */}
          <div className="px-8 pb-8">
            {/* Avatar */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 -mt-16 mb-8">
              <div className="flex items-end gap-4">
                {user.image ? (
                  <img
                    src={user.image}
                    alt={user.name || "User"}
                    className="w-32 h-32 rounded-2xl border-4 border-white dark:border-slate-900 object-cover shadow-lg"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-2xl border-4 border-white dark:border-slate-900 bg-slate-200 dark:bg-slate-800 flex items-center justify-center shadow-lg">
                    <span className="text-4xl font-bold text-slate-400">
                      {user.name?.[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                )}
                <div className="pb-2">
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                    {user.name || "Anonymous"}
                  </h1>
                  <span
                    className={`inline-block text-sm font-semibold px-3 py-1.5 rounded-lg mt-2 ${getRoleColor(
                      user.role
                    )}`}
                  >
                    {getRoleLabel(user.role)}
                  </span>
                </div>
              </div>
            </div>

            {/* Info Grid */}
            <div className="grid gap-4 md:grid-cols-2 mb-8 pb-8 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-slate-400 dark:text-slate-600" />
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                    Email
                  </p>
                  <p className="text-slate-900 dark:text-white">{user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-slate-400 dark:text-slate-600" />
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                    Joined
                  </p>
                  <p className="text-slate-900 dark:text-white">{formattedDate}</p>
                </div>
              </div>
            </div>

            {/* Bio */}
            {user.bio ? (
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <div className="w-1 h-6 bg-primary rounded-full" />
                  About
                </h2>
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <div
                    className="text-slate-700 dark:text-slate-300 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: user.bio }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Shield className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                <p className="text-slate-500 dark:text-slate-400">
                  No bio added yet
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
