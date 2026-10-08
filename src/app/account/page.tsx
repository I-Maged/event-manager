import { Suspense } from "react";
import { auth } from "@/lib/auth/server";

async function AccountContent() {
  const { data: session } = await auth.getSession();

  return (
    <dl className="space-y-2 text-sm">
      <div className="flex gap-2">
        <dt className="text-muted w-20">Name</dt>
        <dd>{session?.user?.name ?? "—"}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted w-20">Email</dt>
        <dd>{session?.user?.email ?? "—"}</dd>
      </div>
      <div className="flex gap-2">
        <dt className="text-muted w-20">User ID</dt>
        <dd className="break-all">{session?.user?.id ?? "—"}</dd>
      </div>
    </dl>
  );
}

export default function AccountPage() {
  return (
    <div className="card p-8 space-y-4 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Account</h1>
      <Suspense fallback={<p className="text-sm text-muted">Loading...</p>}>
        <AccountContent />
      </Suspense>
      <p className="text-xs text-muted">
        Events and RSVPs you create are keyed by this Managed Auth user id.
      </p>
    </div>
  );
}
