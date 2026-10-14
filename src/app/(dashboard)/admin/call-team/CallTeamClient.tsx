"use client";

import { PhoneCall, Users } from "lucide-react";
import { useState, useTransition } from "react";

import { setUserCallAvailability } from "@/components/softphone/actions";

export type CallTeamMember = {
  id: string;
  name: string | null;
  email: string;
  roles: string[];
  isAvailableForCalls: boolean;
  recentCallCount: number;
};

function formatRole(role: string): string {
  return role.toLowerCase().replaceAll("_", " ");
}

export default function CallTeamClient({ members }: { members: CallTeamMember[] }) {
  const [rows, setRows] = useState(members);
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateAvailability(userId: string, available: boolean): void {
    const previous = rows.find((row) => row.id === userId);
    if (!previous) {
      setError("That call-team member is no longer in the list");
      return;
    }

    setError(null);
    setPendingUserId(userId);
    setRows((current) =>
      current.map((row) =>
        row.id === userId ? { ...row, isAvailableForCalls: available } : row,
      ),
    );

    startTransition(async () => {
      try {
        const result = await setUserCallAvailability(userId, available);
        if (!result.ok) {
          setRows((current) =>
            current.map((row) =>
              row.id === userId
                ? { ...row, isAvailableForCalls: previous.isAvailableForCalls }
                : row,
            ),
          );
          setError(result.error);
          return;
        }

        setRows((current) =>
          current.map((row) =>
            row.id === userId ? { ...row, isAvailableForCalls: result.available } : row,
          ),
        );
      } catch (actionError) {
        setRows((current) =>
          current.map((row) =>
            row.id === userId
              ? { ...row, isAvailableForCalls: previous.isAvailableForCalls }
              : row,
          ),
        );
        setError(
          actionError instanceof Error
            ? actionError.message
            : "Failed to update call availability",
        );
      } finally {
        setPendingUserId(null);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Users className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
        <p className="text-sm font-bold uppercase tracking-widest">No call-team members</p>
        <p className="mt-1 text-xs text-slate-500">
          Users with the Admin or Team Member role will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800">
            <tr className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <th className="px-4 py-3">Team member</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3 text-right">Calls · 30 days</th>
              <th className="px-4 py-3 text-right">Available</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.map((member) => {
              const updating = isPending && pendingUserId === member.id;
              return (
                <tr key={member.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-white">
                      {member.name?.trim() || member.email}
                    </p>
                    {member.name?.trim() ? (
                      <p className="text-xs text-slate-500">{member.email}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {member.roles.map((role) => (
                        <span
                          key={role}
                          className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold capitalize tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {formatRole(role)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <PhoneCall className="h-3.5 w-3.5 text-slate-400" />
                      {member.recentCallCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={member.isAvailableForCalls}
                      aria-label={`Set ${member.name?.trim() || member.email} ${member.isAvailableForCalls ? "unavailable" : "available"} for calls`}
                      disabled={isPending}
                      onClick={() => updateAvailability(member.id, !member.isAvailableForCalls)}
                      className="inline-flex min-h-[44px] items-center gap-2 disabled:cursor-wait disabled:opacity-60"
                    >
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {updating
                          ? "Saving…"
                          : member.isAvailableForCalls
                            ? "Available"
                            : "Unavailable"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          member.isAvailableForCalls ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                            member.isAvailableForCalls ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
