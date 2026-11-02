"use client";

import { Building2, Globe, Lock, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import { useState } from "react";

import { ClientsPanel } from "@/components/admin/ClientsPanel";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { PageError, SyncStatus } from "@/components/shared/SyncStatus";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSupervisor, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Client, User } from "@/lib/types";

export default function AdminPage() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const clientsQuery = useApi<Client[]>("/api/clients", 30000);
  const { data: clients, reload: reloadClients } = clientsQuery;
  // Only admins may list users; everyone else on staff manages clients.
  const usersQuery = useApi<User[]>(admin ? "/api/users" : null, 30000);
  const { data: users, reload: reloadUsers } = usersQuery;
  const [tab, setTab] = useState("clients");

  const header = (
    <PageHeader
      title="Clients & Users"
      subtitle="Client companies, their data policies, and the people who can sign in."
      actions={
        <SyncStatus
          updatedAt={clientsQuery.updatedAt}
          refreshing={clientsQuery.refreshing || usersQuery.refreshing}
          error={clients ? (clientsQuery.error ?? usersQuery.error) : null}
          onRefresh={() => {
            void reloadClients();
            if (admin) void reloadUsers();
          }}
        />
      }
    />
  );

  if (!clients || !user) {
    return (
      <>
        {header}
        {clientsQuery.error ? (
          <PageError message={clientsQuery.error} status={clientsQuery.errorStatus} onRetry={reloadClients} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-80 rounded-xl" />
          </div>
        )}
      </>
    );
  }

  const external = clients.filter((c) => c.allow_external_llm).length;
  const activeUsers = users?.filter((u) => u.is_active).length ?? 0;
  const staffUsers = users?.filter((u) => u.role !== "client").length ?? 0;

  return (
    <>
      {header}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Client companies" value={clients.length} hint="each sees only its own projects" icon={<Building2 />} />
        <StatCard
          label="Data policy"
          value={`${clients.length - external} local · ${external} external`}
          hint="clients allowed to use hosted LLMs"
          tone="blue"
          icon={external ? <Globe /> : <Lock />}
        />
        {admin ? (
          <>
            <StatCard
              label="People who can sign in"
              value={users ? `${activeUsers} / ${users.length}` : "–"}
              hint={users ? `${users.length - activeUsers} deactivated` : usersQuery.error ?? "loading…"}
              tone="green"
              icon={<UserCheck />}
            />
            <StatCard
              label="Staff · client users"
              value={users ? `${staffUsers} · ${users.length - staffUsers}` : "–"}
              hint="admins, supervisors and operators · client logins"
              tone="violet"
              icon={<UsersRound />}
            />
          </>
        ) : (
          <StatCard
            label="Your role"
            value="Staff"
            hint="Managing user accounts requires the admin role"
            icon={<ShieldCheck />}
            className="col-span-2"
          />
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="clients">
            <Building2 /> Clients <span className="text-xs text-muted-foreground tabular-nums">{clients.length}</span>
          </TabsTrigger>
          <TabsTrigger value="users" disabled={!admin}>
            <UsersRound /> Users
            {users && <span className="text-xs text-muted-foreground tabular-nums">{users.length}</span>}
            {!admin && <Lock className="size-3" />}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="clients">
          <ClientsPanel
            clients={clients}
            users={admin ? users : null}
            canSetAutonomy={isSupervisor(user.role)}
            onChanged={() => void reloadClients()}
          />
        </TabsContent>
        {admin && (
          <TabsContent value="users">
            {usersQuery.error && !users ? (
              <PageError message={usersQuery.error} status={usersQuery.errorStatus} onRetry={reloadUsers} />
            ) : users ? (
              <UsersPanel users={users} clients={clients} currentUserId={user.id} onChanged={() => void reloadUsers()} />
            ) : (
              <Skeleton className="h-80 rounded-xl" />
            )}
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
