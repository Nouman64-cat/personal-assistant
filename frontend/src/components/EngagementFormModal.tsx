"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

import { ApiError, createEngagement, deleteEngagement, updateEngagement } from "@/lib/api";
import type { EngagementCategory } from "@/lib/types";
import { CATEGORY_LABELS, cn } from "@/lib/utils";

const CATEGORY_OPTIONS: EngagementCategory[] = ["meeting", "interview", "office_hours", "personal"];

interface EngagementFormModalProps {
  mode: "create" | "edit";
  initialStart: Date;
  initialEnd: Date;
  initialTitle?: string;
  initialDescription?: string | null;
  initialCategory?: EngagementCategory;
  initialIsBlocking?: boolean;
  /** Required in edit mode — the engagement being updated/deleted. */
  engagementId?: string;
  onClose: () => void;
  /** Called after a successful create/update/delete so the parent can refetch and close. */
  onSaved: () => void;
}

function timeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Applies an "HH:MM" `<input type="time">` value to a copy of `date`, keeping its calendar day intact. */
function withTimeOfDay(date: Date, timeValue: string): Date {
  const [hours, minutes] = timeValue.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return next;
}

export default function EngagementFormModal({
  mode,
  initialStart,
  initialEnd,
  initialTitle = "",
  initialDescription = "",
  initialCategory = "meeting",
  initialIsBlocking = true,
  engagementId,
  onClose,
  onSaved,
}: EngagementFormModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [category, setCategory] = useState<EngagementCategory>(initialCategory);
  const [isBlocking, setIsBlocking] = useState(initialIsBlocking);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (start >= end) {
      setError("Start time must be before end time.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        category,
        is_blocking: isBlocking,
      };
      if (mode === "create") {
        await createEngagement(payload);
      } else if (engagementId) {
        await updateEngagement(engagementId, payload);
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to save engagement.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!engagementId) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      await deleteEngagement(engagementId);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to delete engagement.");
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {mode === "create" ? "Add engagement" : "Edit engagement"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Title</label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Interview with Avalara"
              autoFocus
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Start</label>
              <input
                type="time"
                value={timeInputValue(start)}
                onChange={(event) => setStart((previous) => withTimeOfDay(previous, event.target.value))}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">End</label>
              <input
                type="time"
                value={timeInputValue(end)}
                onChange={(event) => setEnd((previous) => withTimeOfDay(previous, event.target.value))}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Category</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as EngagementCategory)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>

          <label className="flex items-start gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={isBlocking}
              onChange={(event) => setIsBlocking(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-600"
            />
            <span>
              Counts as busy time
              <span className="mt-0.5 block font-normal text-zinc-400 dark:text-zinc-500">
                Shows on the calendar and blocks this slot from free-time search. Uncheck for a reminder that
                shouldn&apos;t reserve the time.
              </span>
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50",
                  confirmingDelete
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40",
                )}
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {confirmingDelete ? "Confirm delete?" : "Delete"}
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mode === "create" ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
