"use client";

import Link from "next/link";
import { useState } from "react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  ADMIN_ORGANIZATIONS_PATH,
  appointOrganizationManager,
  createOrganization,
  deleteOrganization,
  organizationPath,
  type AdminOrganization,
  type Organization,
} from "@/lib/organizations";
import { Button, DANGER_CONFIRM } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK, WARNING_CALLOUT } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";

const EMPTY = { name: "", slug: "", x_handle: "", manager_username: "", bio: "" };
type Draft = typeof EMPTY;

const FIELDS: { key: Exclude<keyof Draft, "bio">; label: string; placeholder: string }[] = [
  { key: "name", label: "Name", placeholder: "Open Source Watch" },
  { key: "slug", label: "Slug (the URL, fixed once set)", placeholder: "open-source-watch" },
  { key: "x_handle", label: "X handle (verified by you)", placeholder: "@handle" },
  { key: "manager_username", label: "First org manager (username)", placeholder: "username" },
];

/** A flagged organization's way back: name a live analyst its org manager. */
function AppointManager({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const appoint = useMutation(() => appointOrganizationManager(slug, username.trim()), {
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
      <Input
        variant="compact"
        aria-label={`New org manager of ${slug} (username)`}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username"
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="secondary" disabled={!username.trim() || appoint.loading}>
        Name org manager
      </Button>
      {appoint.error && <div className={`${FORM_ERROR_BANNER} w-full`}>{appoint.error}</div>}
    </form>
  );
}

/** Delete an organization: the site admin types its slug to confirm, since the delete takes
 *  its members, invites, approval requests and every approval given in its name. */
function DeleteOrganization({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = useMutation(() => deleteOrganization(slug), {
    fallback: "Could not delete the organization",
    onSuccess: onDone,
  });
  if (!open) {
    return (
      <Button variant="dangerGhost" onClick={() => setOpen(true)}>
        Delete
      </Button>
    );
  }
  return (
    <div className={`${WARNING_CALLOUT} w-full space-y-2 rounded-md px-3 py-2 text-xs`}>
      <p>
        <strong>Deleting {slug} is irreversible.</strong> Its members, pending invites, approval
        requests and every approval given in its name go with it; the owners of the events it
        approved are told. Type the slug to confirm.
      </p>
      <Input
        variant="compact"
        aria-label={`Type ${slug} to confirm`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={slug}
      />
      <div className="flex gap-2">
        <Button
          variant="danger"
          className={typed === slug ? DANGER_CONFIRM : ""}
          disabled={typed !== slug || remove.loading}
          onClick={() => void remove.run()}
        >
          {remove.loading ? "Deleting…" : "Delete organization"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Cancel
        </Button>
      </div>
      {remove.error && <div className={FORM_ERROR_BANNER}>{remove.error}</div>}
    </div>
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
        <ul className="space-y-1.5 text-sm">
          {list.data.map((org) => (
            <li key={org.slug} className="flex flex-wrap items-center gap-2">
              <Link href={organizationPath(org.slug)} className={TEXT_LINK}>
                {org.name}
              </Link>
              <span className="text-xs text-neutral-500">
                {org.member_count} member{org.member_count === 1 ? "" : "s"}
              </span>
              {org.manager_count === 0 && (
                <>
                  <Pill tone="danger">No org manager</Pill>
                  <AppointManager slug={org.slug} onDone={list.refetch} />
                </>
              )}
              <DeleteOrganization slug={org.slug} onDone={list.refetch} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
