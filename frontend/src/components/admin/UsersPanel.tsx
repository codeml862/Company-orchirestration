"use client";

import { Loader2, Pencil, Plus, Search, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { FormField } from "@/components/shared/FormField";
import { SectionCard } from "@/components/shared/SectionCard";
import { ToneBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { patch, post } from "@/lib/api";
import { type Tone, formatDate, humanize, timeAgo } from "@/lib/format";
import type { Client, Role, User } from "@/lib/types";

const ROLES: { value: Role; tone: Tone; description: string }[] = [
  { value: "admin", tone: "violet", description: "Everything, including users and creating agents." },
  { value: "supervisor", tone: "blue", description: "Approvals, budgets and every staff screen." },
  { value: "operator", tone: "gray", description: "Projects, clients and agent configuration; answers clarifications." },
  { value: "client", tone: "amber", description: "Submits and follows their own company's projects only." },
];

const roleInfo = (role: Role) => ROLES.find((r) => r.value === role) ?? ROLES[2];

function UserForm({
  user,
  clients,
  isSelf,
  onSaved,
  onCancel,
}: {
  user: User | null;
  clients: Client[];
  isSelf: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "client");
  const [clientId, setClientId] = useState(user?.client_id ?? "");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "client" && !clientId) {
      setError("Choose the client company this user belongs to.");
      return;
    }
    setBusy(true);
    setError(null);
    const common = { full_name: fullName.trim(), role, client_id: role === "client" ? clientId : null };
    try {
      if (user) {
        await patch<User>(`/api/users/${user.id}`, { ...common, is_active: active, ...(password ? { password } : {}) });
      } else {
        await post<User>("/api/users", { ...common, email: email.trim(), password });
      }
      toast.success(user ? `${common.full_name} updated` : `${common.full_name} can now sign in`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the user");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{user ? `Edit ${user.full_name}` : "New user"}</DialogTitle>
        <DialogDescription>{user ? user.email : "Creates a sign-in for a staff member or a client contact."}</DialogDescription>
      </DialogHeader>
      <ErrorAlert message={error} className="mb-0" />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Full name" htmlFor="user-name">
          <Input id="user-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
        </FormField>
        {!user && (
          <FormField label="Email" htmlFor="user-email">
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </FormField>
        )}
      </div>
      <FormField
        label="Role"
        htmlFor="user-role"
        hint={isSelf ? "You can't change your own role." : roleInfo(role).description}
      >
        <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={isSelf}>
          <SelectTrigger id="user-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {humanize(r.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {role === "client" && (
        <FormField label="Client company" htmlFor="user-client" hint={clients.length ? undefined : "Create a client first."}>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="user-client" className="w-full">
              <SelectValue placeholder="Select a client…" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      <FormField
        label={user ? "New password" : "Password"}
        htmlFor="user-password"
        hint={user ? "Leave empty to keep the current password. At least 10 characters." : "At least 10 characters."}
      >
        <Input
          id="user-password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!user}
        />
      </FormField>
      {user && (
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-1">
            <Label htmlFor="user-active">Active</Label>
            <p className="text-xs text-muted-foreground">
              {isSelf ? "You can't deactivate your own account." : "Inactive users are signed out and cannot sign in."}
            </p>
          </div>
          <Switch id="user-active" checked={active} onCheckedChange={setActive} disabled={isSelf} />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          {user ? "Save changes" : "Create user"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function UsersPanel({
  users,
  clients,
  currentUserId,
  onChanged,
}: {
  users: User[];
  clients: Client[];
  currentUserId: string;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [dialog, setDialog] = useState<{ open: boolean; user: User | null }>({ open: false, user: null });
  const close = () => setDialog((d) => ({ ...d, open: false }));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const term = search.trim().toLowerCase();
  const shown = users.filter(
    (u) => (role === "all" || u.role === role) && (!term || `${u.full_name} ${u.email}`.toLowerCase().includes(term)),
  );

  return (
    <SectionCard
      flush
      title={`${users.length} user${users.length === 1 ? "" : "s"}`}
      actions={
        <Button size="sm" onClick={() => setDialog({ open: true, user: null })}>
          <Plus /> New user
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-40" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {humanize(r.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No users match your filters" icon={<UsersRound className="size-5" />} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="pr-5 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((u) => (
              <TableRow key={u.id} className={u.is_active ? undefined : "opacity-60"}>
                <TableCell className="pl-5">
                  <div className="font-medium">
                    {u.full_name}
                    {u.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <ToneBadge tone={roleInfo(u.role).tone}>{humanize(u.role)}</ToneBadge>
                </TableCell>
                <TableCell>{u.client_id ? (clientName.get(u.client_id) ?? "Unknown client") : "—"}</TableCell>
                <TableCell>
                  <ToneBadge tone={u.is_active ? "green" : "gray"}>{u.is_active ? "Active" : "Inactive"}</ToneBadge>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                <TableCell className="pr-5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, user: u })}>
                    <Pencil /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={dialog.open} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <UserForm
            key={dialog.user?.id ?? "new"}
            user={dialog.user}
            clients={clients}
            isSelf={dialog.user?.id === currentUserId}
            onCancel={close}
            onSaved={() => {
              close();
              onChanged();
            }}
          />
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
