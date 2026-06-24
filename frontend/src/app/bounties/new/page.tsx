"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useApiResource } from "@/hooks/useApiResource";
import { apiFetch } from "@/lib/api";
import { createBounty } from "@/lib/bounties";
import type { Tag } from "@/types";
import { PageCenter, PageShell } from "@/components/ui/PageShell";
import { FilePreviewGrid } from "@/components/ui/FilePreviewGrid";
import { TagPicker } from "@/components/ui/TagPicker";
import FieldHelp from "@/components/ui/FieldHelp";
import {
  FORM_ERROR_BANNER,
  FORM_INPUT,
  FORM_LABEL,
} from "@/components/ui/form-styles";
import { PRIMARY_BUTTON } from "@/components/ui/styles";
import { FIELD_HELP } from "@/lib/fieldHelp";


export default function NewBountyPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // useState, not useApiResource: TagPicker appends newly created tags
  // via setTags, so the list is server-seeded but locally mutable.
  const [tags, setTags] = useState<Tag[]>([]);
  // Curated taxonomy (conflict + capture_source) via `?curated=true` so
  // the author can tag one even when no live geo references it yet.
  const { data: curatedTagsData } = useApiResource<Tag[]>("/tags?curated=true");
  const curatedTags = curatedTagsData ?? [];
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    apiFetch<Tag[]>("/tags")
      .then(setTags)
      .catch(() => {});
  }, []);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!sourceUrl.trim()) {
      setError("Source URL is required");
      return;
    }
    if (files.length === 0) {
      setError("At least one media file is required");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createBounty({
        title: title.trim(),
        source_url: sourceUrl.trim(),
        tag_ids: selectedTagIds,
        files,
      });
      router.push(`/bounties/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || !user) {
    return (
      <PageCenter>
        <span className="text-neutral-500">Loading...</span>
      </PageCenter>
    );
  }

  return (
    <PageShell
      title="New bounty"
      subtitle="Post the media + source you couldn't geolocate. Another analyst will pick it up and turn it into a full geolocation. Once the geolocation is submitted, this bounty is archived."
    >
        <form onSubmit={handleSubmit} className="space-y-6">
          <p className="text-xs text-neutral-500">
            All fields are required unless marked <span className="text-neutral-400">optional</span>.
          </p>

          {/* Title leads, mirroring the detail page where it's the heading. */}
          <div className="space-y-1.5">
            <label htmlFor="title" className={FORM_LABEL}>
              Title <FieldHelp text={FIELD_HELP.title} label="What makes a good title?" />
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unidentified strike, residential block"
              className={FORM_INPUT}
            />
          </div>

          {/* Sections mirror the bounty detail page's reading order
              (media → details) so what the author fills in maps to what
              readers see. */}
          <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
            <header>
              <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
                Source media
                <FieldHelp text={FIELD_HELP.source_media} label="What is the source media?" />
              </h2>
            </header>
            <div className="space-y-1.5">
              <label htmlFor="files" className={FORM_LABEL}>
                Files
              </label>
              <input
                id="files"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                onChange={handleFiles}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-300 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-sm file:border-0 file:bg-neutral-700 file:text-neutral-300 file:cursor-pointer"
              />
            </div>
            {files.length > 0 && <FilePreviewGrid files={files} />}
          </section>

          <section className="bg-neutral-900 rounded-lg border border-neutral-700 p-5 space-y-4">
            <header>
              <h2 className="text-sm font-medium text-neutral-200 inline-flex items-center gap-1.5">
                Details
                <FieldHelp text={FIELD_HELP.section_details_bounty} label="What goes in Details?" />
              </h2>
            </header>

            <div className="space-y-1.5">
              <label htmlFor="source_url" className={FORM_LABEL}>
                Source URL{" "}
                <FieldHelp text={FIELD_HELP.source_url} label="What is the Source URL?" />
              </label>
              <input
                id="source_url"
                type="url"
                required
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://t.me/channel/12345"
                className={FORM_INPUT}
              />
            </div>
          </section>

          <TagPicker
            tags={tags}
            setTags={setTags}
            curatedTags={curatedTags}
            selectedTagIds={selectedTagIds}
            setSelectedTagIds={setSelectedTagIds}
          />

          {error && (
            <div className={FORM_ERROR_BANNER} role="alert">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={submitting}
              className={`px-4 py-2 disabled:opacity-50 rounded-md text-sm font-medium ${PRIMARY_BUTTON}`}
            >
              {submitting ? "Posting…" : "Post bounty"}
            </button>
            <Link
              href="/bounties"
              className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
    </PageShell>
  );
}
