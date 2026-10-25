"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2 } from "lucide-react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  ADMIN_ORGANIZATIONS_PATH,
  appointOrganizationManager,
  createOrganization,
  deleteOrganization,
  memberCountLabel,
  organizationPath,
  type AdminOrganization,
  type Organization,
} from "@/lib/organizations";
import { searchUsers } from "@/lib/admin";
import {
  AccountPicker,
  accountName,
  analystAccount,
  type Account,
} from "@/components/ui/AccountPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Textarea } from "@/components/ui/Input";
import { LinkRow } from "@/components/ui/LinkRow";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";

const EMPTY = { name: "", slug: "", x_handle: "", manager_username: "", bio: "" };
type Draft = typeof EMPTY;

const FIELDS: {
  key: Exclude<keyof Draft, "bio" | "manager_username">;
  label: string;
  placeholder: string;
}[] = [
  { key: "name", label: "Name", placeholder: "Open Source Watch" },
  { key: "slug", label: "Slug (the URL, fixed once set)", placeholder: "open-source-watch" },
  { key: "x_handle", label: "X handle (verified by you)", placeholder: "@handle" },
];

const searchAnalysts = (query: string) => searchUsers(query).then((users) => users.map(analystAccount));

/** A site admin's pick of one analyst by username: the admin user search, or an exact username
 *  typed and committed with Enter. */
function ManagerPicker({
  id,
  label,
  username,
  onChange,
}: {
  id?: string;
  label?: string;
  username: string;
  onChange: (username: string) => void;
}) {
  return (
    <AccountPicker
      id={id}
      aria-label={label}
      search={searchAnalysts}
      minQueryLength={1}
      selected={username ? analystAccount({ username }) : null}
      onSelect={(account) => onChange(accountName(account))}
      onSubmitText={onChange}
      onClear={() => onChange("")}
      placeholder="username"
      emptyText="No analyst matches. Press Enter to use this exact username."
    />
  );
}

/** A flagged organization's way back: name a live analyst its org manager. */
function AppointManager({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const appoint = useMutation(() => appointOrganizationManager(slug, username), {
    fallback: "Could not name the org manager",
    onSuccess: () => {
      setUsername("");
      onDone();
    },
  });
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void appoint.run();
      }}
    >
      <div className="min-w-0 flex-1">
        <ManagerPicker
          label={`New org manager of ${slug} (username)`}
          username={username}
          onChange={setUsername}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={!username || appoint.loading}>
        Name org manager
      </Button>
      {appoint.error && <div className={`${FORM_ERROR_BANNER} w-full`}>{appoint.error}</div>}
    </form>
  );
}

/** Confirm deleting an organization: the site admin types its slug, since the delete takes
 *  its members, invites, approval requests and every approval given in its name. */
function DeleteOrganization({
  slug,
  onCancel,
  onDone,
}: {
  slug: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const remove = useMutation(() => deleteOrganization(slug), {
    fallback: "Could not delete the organization",
    onSuccess: onDone,
  });
  return (
    <ConfirmDialog
      title={`Delete ${slug}?`}
      confirmLabel="Delete organization"
      busyLabel="Deleting…"
      busy={remove.loading}
      confirmDisabled={typed !== slug}
      error={remove.error}
      onConfirm={() => void remove.run()}
      onCancel={onCancel}
    >
      <p>
        <strong>Deleting {slug} is irreversible.</strong> Its
        members, pending invites, approval requests and every approval given in its name go with
        it; the owners of the events it approved are told. Type the slug to confirm.
      </p>
      <Input
        variant="compact"
        aria-label={`Type ${slug} to confirm`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={slug}
      />
    </ConfirmDialog>
  );
}

/** One organization: a row to its page with its member count and Delete, which opens the typed
 *  confirm, and below it, when it has no org manager, the field to name one. */
function OrganizationRow({ org, onChanged }: { org: AdminOrganization; onChanged: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const orphan = org.manager_count === 0;
  return (
    <li className="space-y-2">
      <LinkRow
        variant="arrow"
        icon={Building2}
        value={org.name}
        meta={
          <>
            <span>{memberCountLabel(org.member_count)}</span>
            {orphan && <Pill tone="danger">No org manager</Pill>}
          </>
        }
        href={organizationPath(org.slug)}
        external={false}
        action={
          <Button variant="dangerGhost" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
      />
      {orphan && <AppointManager slug={org.slug} onDone={onChanged} />}
      {deleting && (
        <DeleteOrganization
          slug={org.slug}
          onCancel={() => setDeleting(false)}
          onDone={() => {
            setDeleting(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** Create an organization and name its first org manager, who joins at once. The picture and the
 * links are set afterwards on the organization page, where a site admin can edit like an
 * org manager. Below the form, every organization with its counts; one left without a live
 * org manager (its last one erased with no member to inherit) leads the list, flagged, with a
 * field to name its new org manager. */
export function OrganizationsPanel() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [created, setCreated] = useState<Organization | null>(null);
  const list = useApiResource<AdminOrganization[]>(ADMIN_ORGANIZATIONS_PATH);

  const create = useMutation(
    () =>
      createOrganization({
        name: draft.name,
        slug: draft.slug,
        x_handle: draft.x_handle.trim() || null,
        manager_username: draft.manager_username.trim(),
        bio: draft.bio,
      }),
    {
      fallback: "Could not create the organization",
      onSuccess: (org) => {
        setCreated(org);
        setDraft(EMPTY);
        list.refetch();
      },
    },
  );

  const ready = draft.name.trim() && draft.slug.trim() && draft.manager_username.trim();

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Organizations" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Create an organization and name its first org manager. Add its picture and links on
          its page.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setCreated(null);
          void create.run();
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className={FORM_LABEL} htmlFor={`org-${f.key}`}>
                {f.label}
              </label>
              <Input
                variant="compact"
                id={`org-${f.key}`}
                value={draft[f.key]}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="mt-1"
              />
            </div>
          ))}
          <div>
            <label className={FORM_LABEL} htmlFor="org-manager_username">
              First org manager (username)
            </label>
            <div className="mt-1">
              <ManagerPicker
                id="org-manager_username"
                username={draft.manager_username}
                onChange={(manager_username) => setDraft((d) => ({ ...d, manager_username }))}
              />
            </div>
          </div>
        </div>
        <div>
          <label className={FORM_LABEL} htmlFor="org-bio">
            Bio
          </label>
          <Textarea
            id="org-bio"
            value={draft.bio}
            onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
            className="mt-1 min-h-[72px] resize-y"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!ready || create.loading}>
          {create.loading ? "Creating…" : "Create organization"}
        </Button>
      </form>

      {create.error && <div className={FORM_ERROR_BANNER}>{create.error}</div>}
      {created && (
        <div className={FORM_SUCCESS_BANNER}>
          Created{" "}
          <Link href={organizationPath(created.slug)} className={TEXT_LINK}>
            {created.name}
          </Link>
          .
        </div>
      )}

      {list.error && <div className={FORM_ERROR_BANNER}>{list.error}</div>}
      {list.data && list.data.length > 0 && (
        <ul className="space-y-2">
          {list.data.map((org) => (
            <OrganizationRow key={org.slug} org={org} onChanged={list.refetch} />
          ))}
        </ul>
      )}
    </Card>
  );
}
