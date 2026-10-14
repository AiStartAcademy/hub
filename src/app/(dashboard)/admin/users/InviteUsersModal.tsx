/// src/app/(dashboard)/admin/users/InviteUsersModal.tsx
"use client";

import { useState, useMemo } from "react";
import { X, Mail, Check, AlertCircle, Loader2 } from "lucide-react";

interface InviteUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ROLES = [
  { value: "STUDENT", label: "Student" },
  { value: "EVENT_ORGANIZER", label: "Event Organizer" },
  { value: "TEAM_MEMBER", label: "Team Member" },
  { value: "INSTRUCTOR", label: "Instructor" },
  { value: "ADMIN", label: "Admin" },
];

export function InviteUsersModal({ isOpen, onClose, onSuccess }: InviteUsersModalProps) {
  const [inputText, setInputText] = useState("");
  const [selectedRole, setSelectedRole] = useState("STUDENT");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number; message?: string } | null>(null);

  // Extract and deduplicate valid emails on the fly
  const validEmails = useMemo(() => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = inputText.match(emailRegex);
    if (!matches) return [];
    return Array.from(new Set(matches.map((e) => e.toLowerCase())));
  }, [inputText]);

  if (!isOpen) return null;

  const handleInvite = async () => {
    if (validEmails.length === 0) return;
    
    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          emails: validEmails,
          role: selectedRole
        }),
      });

      const data = await res.json();
      
      if (res.ok) {
        setResult({
          success: data.successCount || 0,
          failed: data.failedCount || 0,
          message: data.message
        });
        
        if (data.successCount > 0) {
          // Delay closing modal so admin can read the delivery summary
          setTimeout(() => {
            onSuccess();
            setInputText("");
            setResult(null);
          }, 2500);
        }
      } else {
        setResult({ success: 0, failed: validEmails.length, message: data.error || "Failed to send invites." });
      }
    } catch (error) {
      console.error("[INVITE_ERROR]", error);
      setResult({ success: 0, failed: validEmails.length, message: "A network error occurred." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div 
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Invite Users
          </h2>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-4 rounded-xl mb-6 text-sm">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              Capabilities (Auto-parsing enabled):
            </h4>
            <ul className="list-disc pl-5 space-y-1 opacity-90">
              <li>Type or paste single/multiple email addresses.</li>
              <li>Copy and paste directly from an Excel/CSV column.</li>
              <li>Emails can be separated by commas, spaces, or new lines.</li>
              <li>Duplicates and invalid text are automatically ignored.</li>
            </ul>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Role Assignment
              </label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="w-full px-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all min-h-[44px] cursor-pointer"
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Email Addresses
              </label>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste emails here (e.g. john@example.com, jane@example.com)..."
                className="w-full h-32 px-4 py-3 text-sm bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none shadow-inner"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Ready to invite <strong className={validEmails.length > 0 ? "text-primary" : ""}>{validEmails.length}</strong> unique user(s)
                </span>
              </div>
            </div>

            {validEmails.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                {validEmails.slice(0, 5).map(email => (
                  <span key={email} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs bg-primary/10 text-primary">
                    {email}
                  </span>
                ))}
                {validEmails.length > 5 && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs bg-slate-100 dark:bg-slate-800 text-slate-500">
                    +{validEmails.length - 5} more
                  </span>
                )}
              </div>
            )}

            {result && (
              <div className={`p-4 rounded-xl text-sm ${result.success > 0 ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-400'}`}>
                <div className="flex items-center gap-2 font-semibold mb-1">
                  {result.success > 0 ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {result.success > 0 ? 'Delivery Summary' : 'Error'}
                </div>
                <p>{result.message}</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors min-h-[44px] min-w-[80px]"
          >
            Cancel
          </button>
          <button
            onClick={handleInvite}
            disabled={validEmails.length === 0 || isSubmitting}
            className="px-6 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary rounded-xl transition-all shadow-sm flex items-center justify-center min-h-[44px] min-w-[120px] focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              `Send Invitations`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
