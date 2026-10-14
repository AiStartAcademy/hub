// src/app/(dashboard)/settings/page.tsx
"use client";

import { brand } from "@/config/brand";
import { useState, useEffect, useMemo } from "react";
import { signOut } from "next-auth/react";
import {
  Settings as SettingsIcon,
  User,
  Save,
  Loader2,
  Camera,
  X,
  Search,
  Globe,
  ChevronDown,
  Lock,
  Eye,
  EyeOff,
  Download,
  Trash2,
  AlertTriangle,
  Shield,
  Award,
  CheckCircle,
  CreditCard,
} from "lucide-react";
import Editor from "@/components/Editor";
import { MembershipPanel } from "@/components/members/MembershipPanel";
import { MobileMenuButton } from '@/components/MobileMenuButton';
import { CommunicationPreferences } from "@/components/settings/CommunicationPreferences";
import { PhoneConsentField } from "@/components/settings/PhoneConsentField";
import {
  planCommunicationPreferenceRequest,
  type CommunicationPreferenceKey,
  type CommunicationPreferences as CommunicationPreferenceValues,
} from "@/lib/communicationPreferences";
import { normalizeDateOnly } from "@/lib/dateOnly";

type PhoneFormState = {
  phone: string;
  /** The number on file; the phone input above may hold an unsaved edit. */
  savedPhone: string | null;
  phoneConsentAt: string | null;
  smsMarketingConsentAt: string | null;
  smsTransactionalConsentAt: string | null;
  smsOptOutAt: string | null;
  doNotCall: boolean;
  smsable: boolean;
  callConsent: boolean;
};

type PhoneConsentResponse = {
  phone: string | null;
  phoneConsentAt: string | null;
  smsMarketingConsentAt: string | null;
  smsTransactionalConsentAt: string | null;
  smsOptOutAt: string | null;
  doNotCall: boolean;
  smsable: boolean;
};

type EmailPreferences = Pick<CommunicationPreferenceValues, "marketingEmail" | "courseEmail">;

type ProfileResponse = PhoneConsentResponse &
  EmailPreferences & {
    name: string | null;
    email: string;
    role: string;
    image: string | null;
    timezone: string | null;
    birthday: string | null;
    bio: string | null;
    emailVerified: string | null;
  };

type PreferenceResponse = Partial<PhoneConsentResponse & EmailPreferences> & {
  error?: string;
};

type Certificate = {
  id: string;
  issuedAt: string;
  pdfUrl: string | null;
  pngUrl: string | null;
  cohort: {
    title: string;
  };
};

function phoneFormStateFromResponse(data: PhoneConsentResponse): PhoneFormState {
  return {
    phone: data.phone ?? "",
    savedPhone: data.phone,
    phoneConsentAt: data.phoneConsentAt,
    smsMarketingConsentAt: data.smsMarketingConsentAt,
    smsTransactionalConsentAt: data.smsTransactionalConsentAt,
    smsOptOutAt: data.smsOptOutAt,
    doNotCall: data.doNotCall,
    smsable: data.smsable,
    callConsent: data.phoneConsentAt !== null,
  };
}

function hasPhoneConsentState(
  data: PreferenceResponse
): data is PreferenceResponse & PhoneConsentResponse {
  return typeof data.smsable === "boolean";
}

const TIMEZONES: { group: string; zones: { value: string; label: string; offset: string }[] }[] = [
  {
    group: "Americas",
    zones: [
      { value: "Pacific/Honolulu", label: "Honolulu", offset: "UTC-10" },
      { value: "America/Anchorage", label: "Anchorage", offset: "UTC-9" },
      { value: "America/Los_Angeles", label: "Los Angeles", offset: "UTC-8" },
      { value: "America/Vancouver", label: "Vancouver", offset: "UTC-8" },
      { value: "America/Denver", label: "Denver", offset: "UTC-7" },
      { value: "America/Phoenix", label: "Phoenix", offset: "UTC-7" },
      { value: "America/Chicago", label: "Chicago", offset: "UTC-6" },
      { value: "America/Mexico_City", label: "Mexico City", offset: "UTC-6" },
      { value: "America/New_York", label: "New York", offset: "UTC-5" },
      { value: "America/Toronto", label: "Toronto", offset: "UTC-5" },
      { value: "America/Bogota", label: "Bogota", offset: "UTC-5" },
      { value: "America/Halifax", label: "Halifax", offset: "UTC-4" },
      { value: "America/Caracas", label: "Caracas", offset: "UTC-4" },
      { value: "America/Santiago", label: "Santiago", offset: "UTC-4" },
      { value: "America/St_Johns", label: "St. John's", offset: "UTC-3:30" },
      { value: "America/Sao_Paulo", label: "São Paulo", offset: "UTC-3" },
      { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires", offset: "UTC-3" },
    ],
  },
  {
    group: "Europe",
    zones: [
      { value: "Atlantic/Reykjavik", label: "Reykjavik", offset: "UTC+0" },
      { value: "Europe/London", label: "London", offset: "UTC+0" },
      { value: "Europe/Dublin", label: "Dublin", offset: "UTC+0" },
      { value: "Europe/Lisbon", label: "Lisbon", offset: "UTC+0" },
      { value: "Europe/Paris", label: "Paris", offset: "UTC+1" },
      { value: "Europe/Berlin", label: "Berlin", offset: "UTC+1" },
      { value: "Europe/Madrid", label: "Madrid", offset: "UTC+1" },
      { value: "Europe/Rome", label: "Rome", offset: "UTC+1" },
      { value: "Europe/Amsterdam", label: "Amsterdam", offset: "UTC+1" },
      { value: "Europe/Brussels", label: "Brussels", offset: "UTC+1" },
      { value: "Europe/Warsaw", label: "Warsaw", offset: "UTC+1" },
      { value: "Europe/Prague", label: "Prague", offset: "UTC+1" },
      { value: "Europe/Zurich", label: "Zurich", offset: "UTC+1" },
      { value: "Europe/Stockholm", label: "Stockholm", offset: "UTC+1" },
      { value: "Europe/Vienna", label: "Vienna", offset: "UTC+1" },
      { value: "Europe/Athens", label: "Athens", offset: "UTC+2" },
      { value: "Europe/Bucharest", label: "Bucharest", offset: "UTC+2" },
      { value: "Europe/Helsinki", label: "Helsinki", offset: "UTC+2" },
      { value: "Europe/Kyiv", label: "Kyiv", offset: "UTC+2" },
      { value: "Europe/Istanbul", label: "Istanbul", offset: "UTC+3" },
      { value: "Europe/Moscow", label: "Moscow", offset: "UTC+3" },
      { value: "Europe/Minsk", label: "Minsk", offset: "UTC+3" },
    ],
  },
  {
    group: "Asia",
    zones: [
      { value: "Asia/Dubai", label: "Dubai", offset: "UTC+4" },
      { value: "Asia/Baku", label: "Baku", offset: "UTC+4" },
      { value: "Asia/Tbilisi", label: "Tbilisi", offset: "UTC+4" },
      { value: "Asia/Yerevan", label: "Yerevan", offset: "UTC+4" },
      { value: "Asia/Kabul", label: "Kabul", offset: "UTC+4:30" },
      { value: "Asia/Karachi", label: "Karachi", offset: "UTC+5" },
      { value: "Asia/Tashkent", label: "Tashkent", offset: "UTC+5" },
      { value: "Asia/Kolkata", label: "Kolkata", offset: "UTC+5:30" },
      { value: "Asia/Colombo", label: "Colombo", offset: "UTC+5:30" },
      { value: "Asia/Kathmandu", label: "Kathmandu", offset: "UTC+5:45" },
      { value: "Asia/Almaty", label: "Almaty", offset: "UTC+6" },
      { value: "Asia/Dhaka", label: "Dhaka", offset: "UTC+6" },
      { value: "Asia/Yangon", label: "Yangon", offset: "UTC+6:30" },
      { value: "Asia/Bangkok", label: "Bangkok", offset: "UTC+7" },
      { value: "Asia/Jakarta", label: "Jakarta", offset: "UTC+7" },
      { value: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh", offset: "UTC+7" },
      { value: "Asia/Novosibirsk", label: "Novosibirsk", offset: "UTC+7" },
      { value: "Asia/Shanghai", label: "Shanghai", offset: "UTC+8" },
      { value: "Asia/Hong_Kong", label: "Hong Kong", offset: "UTC+8" },
      { value: "Asia/Singapore", label: "Singapore", offset: "UTC+8" },
      { value: "Asia/Taipei", label: "Taipei", offset: "UTC+8" },
      { value: "Asia/Kuala_Lumpur", label: "Kuala Lumpur", offset: "UTC+8" },
      { value: "Asia/Irkutsk", label: "Irkutsk", offset: "UTC+8" },
      { value: "Asia/Seoul", label: "Seoul", offset: "UTC+9" },
      { value: "Asia/Tokyo", label: "Tokyo", offset: "UTC+9" },
      { value: "Asia/Yakutsk", label: "Yakutsk", offset: "UTC+9" },
      { value: "Asia/Vladivostok", label: "Vladivostok", offset: "UTC+10" },
    ],
  },
  {
    group: "Africa",
    zones: [
      { value: "Africa/Casablanca", label: "Casablanca", offset: "UTC+0" },
      { value: "Africa/Lagos", label: "Lagos", offset: "UTC+1" },
      { value: "Africa/Cairo", label: "Cairo", offset: "UTC+2" },
      { value: "Africa/Johannesburg", label: "Johannesburg", offset: "UTC+2" },
      { value: "Africa/Nairobi", label: "Nairobi", offset: "UTC+3" },
    ],
  },
  {
    group: "Australia & Pacific",
    zones: [
      { value: "Australia/Perth", label: "Perth", offset: "UTC+8" },
      { value: "Australia/Adelaide", label: "Adelaide", offset: "UTC+9:30" },
      { value: "Australia/Sydney", label: "Sydney", offset: "UTC+10" },
      { value: "Australia/Melbourne", label: "Melbourne", offset: "UTC+10" },
      { value: "Australia/Brisbane", label: "Brisbane", offset: "UTC+10" },
      { value: "Pacific/Auckland", label: "Auckland", offset: "UTC+12" },
      { value: "Pacific/Fiji", label: "Fiji", offset: "UTC+12" },
    ],
  },
  {
    group: "Other",
    zones: [
      { value: "UTC", label: "UTC", offset: "UTC+0" },
    ],
  },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [tzSearch, setTzSearch] = useState("");
  const [tzDropdownOpen, setTzDropdownOpen] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    role: "",
    image: "",
    timezone: "UTC",
    birthday: "",
    bio: "",
  });
  const [phoneForm, setPhoneForm] = useState<PhoneFormState>({
    phone: "",
    savedPhone: null,
    phoneConsentAt: null,
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: null,
    smsOptOutAt: null,
    doNotCall: false,
    smsable: false,
    callConsent: false,
  });
  const [emailPreferences, setEmailPreferences] = useState<EmailPreferences>({
    marketingEmail: true,
    courseEmail: true,
  });
  const [pendingPreference, setPendingPreference] =
    useState<CommunicationPreferenceKey | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [emailVerified, setEmailVerified] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");

  const handleResendVerification = async () => {
    setResendingVerification(true);
    setVerificationMessage("");
    try {
      const res = await fetch("/api/me/resend-verification", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setVerificationMessage(
        res.ok
          ? data.message || "Verification email sent."
          : data.error || "Could not send verification email."
      );
    } catch {
      setVerificationMessage("Could not send verification email.");
    } finally {
      setResendingVerification(false);
    }
  };

  useEffect(() => {
    async function fetchUserData() {
      try {
        const [res, certsRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/me/certificates")
        ]);

        if (res.ok) {
          const data = (await res.json()) as ProfileResponse;
          setFormData({
            name: data.name || "",
            email: data.email || "",
            role: data.role || "STUDENT",
            image: data.image || "",
            timezone: data.timezone || "UTC",
            birthday: data.birthday || "",
            bio: data.bio || "",
          });
          setPhoneForm(phoneFormStateFromResponse(data));
          setEmailPreferences({
            marketingEmail: data.marketingEmail,
            courseEmail: data.courseEmail,
          });
          setEmailVerified(Boolean(data.emailVerified));
        }

        if (certsRes.ok) {
          const certData = await certsRes.json();
          setCertificates(certData.certificates || []);
        }
      } catch (error) {
        console.error("Failed to fetch user data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchUserData();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tz-dropdown]")) {
        setTzDropdownOpen(false);
      }
    }
    if (tzDropdownOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [tzDropdownOpen]);

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return TIMEZONES;
    const q = tzSearch.toLowerCase();
    return TIMEZONES.map(group => ({
      ...group,
      zones: group.zones.filter(
        z => z.label.toLowerCase().includes(q) || z.value.toLowerCase().includes(q) || z.offset.toLowerCase().includes(q)
      ),
    })).filter(g => g.zones.length > 0);
  }, [tzSearch]);

  const selectedTzLabel = useMemo(() => {
    for (const group of TIMEZONES) {
      const found = group.zones.find(z => z.value === formData.timezone);
      if (found) return `${found.label} (${found.offset})`;
    }
    return formData.timezone;
  }, [formData.timezone]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const birthday = normalizeDateOnly(formData.birthday);
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          image: formData.image,
          timezone: formData.timezone,
          birthday,
          bio: formData.bio,
          // SMS consents are owned by their switches in Communication
          // preferences; Save only sends the phone and call choice.
          phone: phoneForm.phone,
          callConsent: phoneForm.callConsent,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as ProfileResponse;
        setFormData(prev => ({ ...prev, image: data.image || prev.image, bio: data.bio || prev.bio }));
        setPhoneForm(phoneFormStateFromResponse(data));
        setMessage({ type: "success", text: "Settings updated successfully!" });
      } else {
        let errorText = "Failed to update settings";
        try {
          const data = await res.json();
          errorText = data.error || errorText;
        } catch {
          errorText = `Error: ${res.status} ${res.statusText}`;
        }
        setMessage({ type: "error", text: errorText });
      }
    } catch (error) {
      setMessage({ type: "error", text: `Network error: ${error instanceof Error ? error.message : "Unknown error"}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePreference = async (
    key: CommunicationPreferenceKey,
    enabled: boolean
  ) => {
    setPreferenceError("");
    const plan = planCommunicationPreferenceRequest(key, enabled, {
      savedPhone: phoneForm.savedPhone,
      enteredPhone: phoneForm.phone,
      smsOptOutAt: phoneForm.smsOptOutAt,
    });
    if (!plan.ok) {
      setPreferenceError(plan.error);
      return;
    }

    setPendingPreference(key);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.body),
      });
      const data = (await res.json().catch(() => ({}))) as PreferenceResponse;
      if (!res.ok) {
        setPreferenceError(data.error || "Could not save that preference. Please try again.");
        return;
      }

      if (typeof data.marketingEmail === "boolean" && typeof data.courseEmail === "boolean") {
        setEmailPreferences({
          marketingEmail: data.marketingEmail,
          courseEmail: data.courseEmail,
        });
      }
      if (hasPhoneConsentState(data)) {
        const next = phoneFormStateFromResponse(data);
        // Keep the input as typed unless this request bound a number.
        setPhoneForm((current) => ({
          ...next,
          phone: "phone" in plan.body ? next.phone : current.phone,
          callConsent: current.callConsent,
        }));
      }
    } catch (error) {
      setPreferenceError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setPendingPreference(null);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500 * 1024) {
        setMessage({ type: "error", text: "Image size should be less than 500KB" });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Check if base64 is too large when encoded
        if (result.length > 1024 * 1024) {
          setMessage({ type: "error", text: "Image file is too large after encoding. Please choose a smaller image." });
          return;
        }
        setFormData({ ...formData, image: result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordMessage(null);

    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setPasswordMessage({ type: "error", text: "Please fill in all password fields" });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordMessage({ type: "error", text: "New password must be at least 6 characters" });
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordMessage({ type: "error", text: "New passwords do not match" });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      });

      if (res.ok) {
        setPasswordMessage({ type: "success", text: "Password updated successfully!" });
        setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setShowPasswords({ current: false, new: false, confirm: false });
      } else {
        const data = await res.json();
        setPasswordMessage({ type: "error", text: data.error || "Failed to update password" });
      }
    } catch {
      setPasswordMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/me/export");
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${brand.ids.dataExportFilePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ type: "success", text: "Your data has been exported and downloaded." });
    } catch {
      setMessage({ type: "error", text: "Failed to export data. Please try again." });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE MY ACCOUNT") {
      setDeleteError('Please type "DELETE MY ACCOUNT" exactly to confirm.');
      return;
    }

    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/me/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete account");
      }

      // Sign out and redirect to home
      signOut({ callbackUrl: "/" });
    } catch (error: unknown) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete account");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <>
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center px-4 md:px-8 flex-shrink-0 shadow-sm z-10">
        <MobileMenuButton />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 ml-2 md:ml-0">
          <SettingsIcon className="h-6 w-6 text-primary flex-shrink-0" />
          Settings
        </h1>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {message && (
            <div className={`p-4 rounded-lg text-sm ${
              message.type === "success" 
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" 
                : "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"
            }`}>
              {message.text}
            </div>
          )}

          {/* Profile */}
          <div className="relative z-10 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-8">
              <User className="h-5 w-5 text-primary" />
              Profile Settings
            </h2>

            {/* Avatar Section */}
            <div className="flex flex-col items-center sm:flex-row gap-6 mb-8 pb-8 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <div className="h-24 w-24 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center">
                  {formData.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={formData.image} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-10 w-10 text-slate-400" />
                  )}
                </div>
                <label className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-primary hover:bg-primary-dark text-white flex items-center justify-center cursor-pointer shadow-lg transition-colors border-2 border-white dark:border-slate-900">
                  <Camera className="h-4 w-4" />
                  <input type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                </label>
                {formData.image && (
                  <button 
                    onClick={() => setFormData({ ...formData, image: "" })}
                    className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-sm transition-colors border-2 border-white dark:border-slate-900"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="text-center sm:text-left">
                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">Avatar Image</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Format: JPG, PNG. Max size 1MB.
                </p>
                <div className="flex gap-2 justify-center sm:justify-start">
                  <button 
                    onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
                    className="text-xs font-medium text-primary hover:text-primary-dark transition-colors"
                  >
                    Upload New
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                />
                {emailVerified ? (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle className="h-3.5 w-3.5" /> Email verified
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Email not verified
                    </span>
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resendingVerification}
                      className="font-semibold text-primary hover:text-primary-dark disabled:opacity-50 transition-colors"
                    >
                      {resendingVerification ? "Sending…" : "Resend verification email"}
                    </button>
                    {verificationMessage && (
                      <span className="text-slate-500 dark:text-slate-400">
                        {verificationMessage}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Role</label>
                <input 
                  type="text" 
                  value={formData.role} 
                  readOnly 
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-sm focus:outline-none cursor-not-allowed" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Birthday</label>
                <input
                  type="date"
                  value={formData.birthday}
                  onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                />
              </div>
              <div className="relative" data-tz-dropdown>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  <Globe className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                  Timezone
                </label>
                <button
                  type="button"
                  onClick={() => { setTzDropdownOpen(!tzDropdownOpen); setTzSearch(""); }}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-left flex items-center justify-between"
                >
                  <span className="truncate text-slate-900 dark:text-white">{selectedTzLabel}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${tzDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {tzDropdownOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-72 flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-slate-100 dark:border-slate-700">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search timezones..."
                          value={tzSearch}
                          onChange={(e) => setTzSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {filteredTimezones.length === 0 ? (
                        <div className="py-6 text-center text-sm text-slate-400">No timezones found</div>
                      ) : (
                        filteredTimezones.map(group => (
                          <div key={group.group}>
                            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                              {group.group}
                            </div>
                            {group.zones.map(tz => (
                              <button
                                key={tz.value}
                                onClick={() => {
                                  setFormData({ ...formData, timezone: tz.value });
                                  setTzDropdownOpen(false);
                                  setTzSearch("");
                                }}
                                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors ${
                                  formData.timezone === tz.value ? "bg-primary/10 text-primary font-medium" : "text-slate-700 dark:text-slate-300"
                                }`}
                              >
                                <span>{tz.label}</span>
                                <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{tz.offset}</span>
                              </button>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bio Section */}
            <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                Bio
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Tell others about yourself. You can use rich text formatting, links, images, and videos.
              </p>
              <Editor
                content={formData.bio}
                onChange={(bio) => setFormData({ ...formData, bio })}
                placeholder="Write your bio here..."
              />
            </div>
          </div>

          <CommunicationPreferences
            preferences={{
              ...emailPreferences,
              marketingSms: phoneForm.smsMarketingConsentAt !== null,
              courseSms: phoneForm.smsTransactionalConsentAt !== null,
            }}
            smsOptOutAt={phoneForm.smsOptOutAt}
            pendingKey={pendingPreference}
            error={preferenceError}
            onToggle={handleTogglePreference}
            phoneField={
              <>
                <PhoneConsentField
                  phone={phoneForm.phone}
                  phoneConsentAt={phoneForm.phoneConsentAt}
                  smsMarketingConsentAt={phoneForm.smsMarketingConsentAt}
                  smsTransactionalConsentAt={phoneForm.smsTransactionalConsentAt}
                  smsMarketingConsent={phoneForm.smsMarketingConsentAt !== null}
                  smsTransactionalConsent={phoneForm.smsTransactionalConsentAt !== null}
                  callConsent={phoneForm.callConsent}
                  smsOptOutAt={phoneForm.smsOptOutAt}
                  doNotCall={phoneForm.doNotCall}
                  onPhoneChange={(phone) =>
                    setPhoneForm((current) => ({ ...current, phone }))
                  }
                  // Texts are toggled by the switches below, not checkboxes here.
                  onSmsMarketingConsentChange={() => undefined}
                  onSmsTransactionalConsentChange={() => undefined}
                  onCallConsentChange={(callConsent) =>
                    setPhoneForm((current) => ({ ...current, callConsent }))
                  }
                  kinds={["calls"]}
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Your phone number and call choice save with Save Changes. Texts go to this number.
                </p>
              </>
            }
          />

          {/* Change Password */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-5">
              <Lock className="h-5 w-5 text-primary" />
              Change Password
            </h2>

            {passwordMessage && (
              <div className={`mb-4 p-4 rounded-lg text-sm ${
                passwordMessage.type === "success" 
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" 
                  : "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"
              }`}>
                {passwordMessage.text}
              </div>
            )}

            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Current Password</label>
                <div className="relative">
                  <input 
                    type={showPasswords.current ? "text" : "password"}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all" 
                  />
                  <button type="button" onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">New Password</label>
                <div className="relative">
                  <input 
                    type={showPasswords.new ? "text" : "password"}
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all" 
                  />
                  <button type="button" onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input 
                    type={showPasswords.confirm ? "text" : "password"}
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all" 
                  />
                  <button type="button" onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="pt-2">
                <button 
                  onClick={handlePasswordChange}
                  disabled={savingPassword}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2 hover:shadow-md hover:shadow-primary/20"
                >
                  {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {savingPassword ? "Updating..." : "Update Password"}
                </button>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button 
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2 hover:shadow-md hover:shadow-primary/20"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>

          {/* Membership */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in z-0 relative">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-5">
              <CreditCard className="h-5 w-5 text-primary" />
              Membership
            </h2>
            <MembershipPanel />
          </div>

          {/* My Certificates */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in z-0 relative">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-5">
              <Award className="h-5 w-5 text-primary" />
              My Certificates
            </h2>

            {certificates.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 p-4 border border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-800/20">
                You haven&apos;t earned any certificates yet. Successfully complete a cohort program to get certified!
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {certificates.map(cert => (
                  <div key={cert.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col gap-4">
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white line-clamp-1" title={cert.cohort.title}>{cert.cohort.title}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Issued: {new Date(cert.issuedAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 truncate" title={cert.id}>
                        ID: {cert.id}
                      </p>
                    </div>
                    
                    <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 mt-auto pt-3 border-t border-slate-200 dark:border-slate-700">
                      {cert.pdfUrl && (
                        <a 
                          href={cert.pdfUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                        >
                          <Download className="h-4 w-4" />
                          PDF Target
                        </a>
                      )}
                      {cert.pngUrl && (
                        <a 
                          href={cert.pngUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
                        >
                          <Download className="h-4 w-4" />
                          PNG Image
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Data & Privacy */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in relative z-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
              <Shield className="h-5 w-5 text-primary" />
              Data &amp; Privacy
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Manage your personal data in accordance with our{" "}
              <a href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</a>.
              You have the right to export or delete your data at any time.
            </p>

            {/* Export Data */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50 mb-4">
              <div>
                <h3 className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                  <Download className="h-4 w-4 text-emerald-500" />
                  Export My Data
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Download all your personal data including profile, enrollments,
                  assessment submissions, certificates, and group memberships as a JSON file.
                </p>
              </div>
              <button
                onClick={handleExportData}
                disabled={exporting}
                className="shrink-0 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2 hover:shadow-md"
                id="export-data-btn"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {exporting ? "Exporting..." : "Download Data"}
              </button>
            </div>

            {/* Delete Account */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-rose-50/50 dark:bg-rose-900/10 border border-rose-200/50 dark:border-rose-800/30">
              <div>
                <h3 className="text-sm font-medium text-rose-700 dark:text-rose-400 flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete My Account
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Permanently delete your account and all associated data.
                  This action is irreversible.
                </p>
              </div>
              <button
                onClick={() => { setShowDeleteModal(true); setDeleteConfirmation(""); setDeleteError(""); }}
                className="shrink-0 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-rose-500 hover:bg-rose-600 transition-colors shadow-sm flex items-center gap-2 hover:shadow-md"
                id="delete-account-btn"
              >
                <Trash2 className="h-4 w-4" />
                Delete Account
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleting && setShowDeleteModal(false)}
          />

          {/* Modal */}
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md animate-fade-in overflow-hidden">
            {/* Danger header */}
            <div className="bg-gradient-to-r from-rose-500 to-red-600 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Delete Account</h3>
                  <p className="text-sm text-white/80">This action cannot be undone</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5">
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                Deleting your account will <strong>permanently remove</strong> all of your data, including:
              </p>
              <ul className="text-sm text-slate-500 dark:text-slate-400 space-y-1.5 mb-6 pl-4">
                <li className="flex items-start gap-2">
                  <span className="text-rose-400 mt-0.5">•</span>
                  Your profile and account information
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-400 mt-0.5">•</span>
                  All cohort enrollments and group memberships
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-400 mt-0.5">•</span>
                  Assessment submissions and scores
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-400 mt-0.5">•</span>
                  Connected accounts (Google, etc.)
                </li>
              </ul>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Type <span className="font-mono text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-1.5 py-0.5 rounded">DELETE MY ACCOUNT</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  placeholder="DELETE MY ACCOUNT"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500 transition-all font-mono"
                  disabled={deleting}
                  autoFocus
                  id="delete-confirmation-input"
                />
              </div>

              {deleteError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-400">
                  {deleteError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  id="delete-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirmation !== "DELETE MY ACCOUNT"}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  id="delete-confirm-btn"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {deleting ? "Deleting..." : "Delete Forever"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
