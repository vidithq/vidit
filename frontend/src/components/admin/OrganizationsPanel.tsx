"use client";

import Link from "next/link";
import { useState } from "react";

import { useApiResource } from "@/hooks/useApiResource";
import { useMutation } from "@/hooks/useMutation";
import {
  ADMIN_ORGANIZATIONS_PATH,
  appointOrganizationAdmin,
  createOrganization,
  organizationPath,
  type AdminOrganization,
  type Organization,
} from "@/lib/organizations";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { TEXT_LINK } from "@/components/ui/styles";
import {
  FORM_ERROR_BANNER,
  FORM_LABEL,
  FORM_SUCCESS_BANNER,
} from "@/components/ui/form-styles";

const EMPTY = { name: "", slug: "", x_handle: "", admin_username: "", bio: "" };
type Draft = typeof EMPTY;

const FIELDS: { key: Exclude<keyof Draft, "bio">; label: string; placeholder: string }[] = [
  { key: "name", label: "Name", placeholder: "Open Source Watch" },
  { key: "slug", label: "Slug (the URL, fixed once set)", placeholder: "open-source-watch" },
  { key: "x_handle", label: "X handle (verified by you)", placeholder: "@handle" },
  { key: "admin_username", label: "First org-admin (username)", placeholder: "username" },
];

/** A flagged organization's way back: name a live analyst its org-admin. */
function AppointAdmin({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const appoint = useMutation(() => appointOrganizationAdmin(slug, username.trim()), {
    fallback: "Could not name the org-admin",
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
        aria-label={`New org-admin of ${slug} (username)`}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="username"
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="secondary" disabled={!username.trim() || appoint.loading}>
        Name org-admin
      </Button>
      {appoint.error && <div className={`${FORM_ERROR_BANNER} w-full`}>{appoint.error}</div>}
    </form>
  );
}

/** Create an organization and name its first org-admin, who joins at once. The picture and the
 * links are set afterwards on the organization page, where a site admin can edit like an
 * org-admin. Below the form, every organization with its counts; one left without a live
 * org-admin (its last one erased with no member to inherit) leads the list, flagged, with a
 * field to name its new org-admin. */
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
        admin_username: draft.admin_username.trim(),
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

  const ready = draft.name.trim() && draft.slug.trim() && draft.admin_username.trim();

  return (
    <Card as="section">
      <header>
        <SectionEyebrow title="Organizations" margin="none" />
        <p className="text-xs text-neutral-500 mt-0.5">
          Create an organization and name its first org-admin. Add its picture and links on
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
              {org.admin_count === 0 && (
                <>
                  <Pill tone="danger">No org-admin</Pill>
                  <AppointAdmin slug={org.slug} onDone={list.refetch} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
