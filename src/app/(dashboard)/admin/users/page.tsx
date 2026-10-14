// src/app/(dashboard)/admin/users/page.tsx

"use client";

import { useEffect, useState } from "react";
import { 
  Users, 
  UserCog, 
  Shield, 
  GraduationCap, 
  CalendarDays,
  Briefcase, 
  User, 
  Check,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Loader2,
  Search,
  Trash2,
  Plus,
  Pencil
} from "lucide-react";
import { InviteUsersModal } from "./InviteUsersModal";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import UserProfileModal from "@/components/admin/UserProfileModal";
import { getRoles } from "@/lib/roles";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string;
  image?: string;
  createdAt: string;
}

type SortKey = "name" | "role" | "createdAt";
type SortDirection = "asc" | "desc";

const ROLES = [
  { value: "STUDENT", label: "Student", icon: GraduationCap, color: "text-blue-500 bg-blue-50" },
  { value: "EVENT_ORGANIZER", label: "Event Organizer", icon: CalendarDays, color: "text-amber-500 bg-amber-50" },
  { value: "TEAM_MEMBER", label: "Team Member", icon: Briefcase, color: "text-emerald-500 bg-emerald-50" },
  { value: "INSTRUCTOR", label: "Instructor", icon: UserCog, color: "text-purple-500 bg-purple-50" },
  { value: "ADMIN", label: "Admin", icon: Shield, color: "text-rose-500 bg-rose-50" },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "createdAt",
    direction: "desc"
  });

  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (res.ok) setUsers(data);
    } catch (error) {
      console.error("Failed to fetch users", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleToggle = async (user: UserData, role: string) => {
    const current = getRoles(user);
    const nextRoles = current.includes(role)
      ? current.filter(r => r !== role)
      : [...current, role];

    if (nextRoles.length === 0) {
      alert("A user must have at least one role.");
      return;
    }

    setUpdating(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: nextRoles }),
      });

      if (res.ok) {
        const updated = await res.json();
        setUsers(users.map(u => u.id === user.id ? { ...u, role: updated.role, roles: updated.roles } : u));
      }
    } catch (error) {
      console.error("Failed to update roles", error);
    } finally {
      setUpdating(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
    
    setUpdating(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setUsers(users.filter(u => u.id !== userId));
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete user");
      }
    } catch (error) {
      console.error("Failed to delete user", error);
      alert("Something went wrong");
    } finally {
      setUpdating(null);
    }
  };

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  };

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (sortConfig.key === "name") {
      const valA = (a.name || a.email).toLowerCase();
      const valB = (b.name || b.email).toLowerCase();
      return sortConfig.direction === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    if (sortConfig.key === "role") {
      return sortConfig.direction === "asc" ? a.role.localeCompare(b.role) : b.role.localeCompare(a.role);
    }
    if (sortConfig.key === "createdAt") {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
    }
    return 0;
  });

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortConfig.key !== columnKey) {
      return <ArrowUpDown className="h-4 w-4 text-slate-400 opacity-0 group-hover:opacity-50 transition-opacity" />;
    }
    return sortConfig.direction === "asc" 
      ? <ChevronUp className="h-4 w-4 text-primary" /> 
      : <ChevronDown className="h-4 w-4 text-primary" />;
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div className="flex items-start gap-3 md:gap-0">
          <div className="mt-1 md:hidden">
            <MobileMenuButton />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="h-5 w-5 md:h-6 md:w-6 text-primary flex-shrink-0" />
              User Management
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Manage roles and permissions for all users
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsInviteModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl font-medium text-sm hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/20 transition-all shadow-sm min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Invite Users</span>
          <span className="sm:hidden">Invite</span>
        </button>
      </div>

      <InviteUsersModal 
        isOpen={isInviteModalOpen} 
        onClose={() => setIsInviteModalOpen(false)} 
        onSuccess={() => {
          setIsInviteModalOpen(false);
          fetchUsers(); // Refresh table automatically after successful invite
        }}
      />

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>
        </div>

        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-left relative">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-3 py-2">
                  <button 
                    onClick={() => handleSort('name')}
                    className="group flex items-center gap-1.5 focus-visible:outline-none focus-visible:text-primary min-h-[44px] px-3 w-full rounded-md transition-colors"
                  >
                    User
                    <SortIcon columnKey="name" />
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button 
                    onClick={() => handleSort('role')}
                    className="group flex items-center gap-1.5 focus-visible:outline-none focus-visible:text-primary min-h-[44px] px-3 w-full rounded-md transition-colors"
                  >
                    Current Role
                    <SortIcon columnKey="role" />
                  </button>
                </th>
                <th className="px-6 py-4 align-middle">
                  Actions
                </th>
                <th className="px-3 py-2">
                  <button 
                    onClick={() => handleSort('createdAt')}
                    className="group flex items-center gap-1.5 focus-visible:outline-none focus-visible:text-primary min-h-[44px] px-3 w-full rounded-md transition-colors"
                  >
                    Joined
                    <SortIcon columnKey="createdAt" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                    <p className="text-slate-500">Loading users...</p>
                  </td>
                </tr>
              ) : sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <p className="text-slate-500">No users found</p>
                  </td>
                </tr>
              ) : (
                sortedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 font-bold uppercase overflow-hidden border border-slate-200 dark:border-slate-700">
                          {user.image ? (
                            <img src={user.image} alt={user.name} className="w-full h-full object-cover" />
                          ) : (
                            user.name?.[0] || user.email[0]
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{user.name || "Unnamed"}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {getRoles(user).map(roleValue => {
                          const role = ROLES.find(r => r.value === roleValue);
                          if (!role) return null;
                          return (
                            <span key={role.value} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${role.color}`}>
                              <role.icon className="h-3 w-3" />
                              {role.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        {ROLES.map((role) => {
                          const active = getRoles(user).includes(role.value);
                          return (
                            <button
                              key={role.value}
                              disabled={updating === user.id}
                              onClick={() => handleRoleToggle(user, role.value)}
                              title={active ? `Remove ${role.label}` : `Grant ${role.label}`}
                              aria-pressed={active}
                              className={`p-2 rounded-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary ${
                                active
                                  ? "bg-primary text-white shadow-sm ring-2 ring-primary/20"
                                  : "text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
                              }`}
                            >
                              <role.icon className="h-4 w-4" />
                            </button>
                          );
                        })}
                        
                        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                        <button
                          disabled={updating === user.id}
                          onClick={() => setEditingUserId(user.id)}
                          title="Edit profile"
                          className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>

                        <button
                          disabled={updating === user.id}
                          onClick={() => handleDeleteUser(user.id)}
                          title="Delete User"
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingUserId && (
        <UserProfileModal
          userId={editingUserId}
          onClose={() => setEditingUserId(null)}
          onSaved={() => {
            setEditingUserId(null);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}
