"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";

import { ApiError, createEngagement, parseEngagements } from "@/lib/api";
import type { ParsedEngagement, ParseResponse } from "@/lib/types";
import {
  CATEGORY_BADGE_CLASSES,
  CATEGORY_LABELS,
  cn,
  formatDateTime,
  formatTime,
} from "@/lib/utils";

interface QuickParseInputProps {
  /** Called after at least one engagement is successfully added, so the parent can refresh other views. */
  onAdded?: () => void;
  /**
   * Timezone to resolve relative expressions ("tomorrow at 3pm") against.
   * Defaults to the saved shift's timezone once loaded (falls back to the
   * browser's detected timezone before that, or if unset).
   */
  timezone?: string;
}

const PLACEHOLDER = `Paste an email, meeting invite, or raw notes, e.g.

"Hi, can we do a technical interview tomorrow at 2pm for about an hour?
Also don't forget office hours next Monday 10-12."`;

export default function QuickParseInput({ onAdded, timezone: timezoneProp }: QuickParseInputProps) {
  const [text, setText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  }, []);
  const timezone = timezoneProp ?? detectedTimezone;

  async function handleParse() {
    const trimmed = text.trim();
    if (!trimmed || isParsing) return;

    setIsParsing(true);
    setParseError(null);
    try {
      const response = await parseEngagements({ text: trimmed, timezone });
      setResult(response);
      setSelected(new Set(response.engagements.map((_, index) => index)));
      setSubmitError(null);
    } catch (error) {
      setParseError(error instanceof ApiError ? error.message : "Something went wrong while parsing.");
    } finally {
      setIsParsing(false);
    }
  }

  function closeModal() {
    setResult(null);
    setSubmitError(null);
  }

  function toggleSelected(index: number) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleConfirmAndAdd() {
    if (!result || selected.size === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const toAdd = result.engagements.filter((_, index) => selected.has(index));
    const failures: string[] = [];

    for (const candidate of toAdd) {
      try {
        await createEngagement({
          title: candidate.title,
          description: candidate.description,
          start_time: candidate.start_time,
          end_time: candidate.end_time,
          category: candidate.category,
          is_blocking: candidate.is_blocking,
        });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Unknown error";
        failures.push(`${candidate.title}: ${message}`);
      }
    }

    setIsSubmitting(false);

    if (failures.length > 0) {
      setSubmitError(`${failures.length} of ${toAdd.length} could not be added — ${failures.join("; ")}`);
      onAdded?.();
      return;
    }

    setText("");
    closeModal();
    onAdded?.();
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Quick Parse</h2>
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Paste an interview email, meeting invite, or raw notes and let AI turn it into
        structured engagements.
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PLACEHOLDER}
        rows={6}
        disabled={isParsing}
        className="mt-4 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Relative times resolved against <span className="font-medium">{timezone}</span>
        </p>
        <button
          type="button"
          onClick={handleParse}
          disabled={isParsing || text.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isParsing ? "Parsing…" : "Parse with AI"}
        </button>
      </div>

      {parseError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {result && (
        <ParsePreviewModal
          result={result}
          selected={selected}
          onToggle={toggleSelected}
          onClose={closeModal}
          onConfirm={handleConfirmAndAdd}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      )}
    </section>
  );
}

interface ParsePreviewModalProps {
  result: ParseResponse;
  selected: Set<number>;
  onToggle: (index: number) => void;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

function ParsePreviewModal({
  result,
  selected,
  onToggle,
  onClose,
  onConfirm,
  isSubmitting,
  submitError,
}: ParsePreviewModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Review extracted engagements"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Review extracted engagements
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {result.engagements.length} found · {selected.size} selected
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {result.warnings.length > 0 && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <ul className="space-y-0.5">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {result.engagements.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No engagements were found in that text.
            </p>
          ) : (
            result.engagements.map((candidate, index) => (
              <CandidateCard
                key={`${candidate.title}-${candidate.start_time}-${index}`}
                candidate={candidate}
                checked={selected.has(index)}
                onToggle={() => onToggle(index)}
              />
            ))
          )}
        </div>

        {submitError && (
          <div className="mx-5 mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={selected.size === 0 || isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isSubmitting ? "Adding…" : `Confirm & Add (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ParsedEngagement;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
        checked
          ? "border-violet-300 bg-violet-50/60 dark:border-violet-700/60 dark:bg-violet-500/10"
          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
            {candidate.title}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              CATEGORY_BADGE_CLASSES[candidate.category],
            )}
          >
            {CATEGORY_LABELS[candidate.category]}
          </span>
          {candidate.has_conflict && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              Conflict
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {formatDateTime(candidate.start_time)} – {formatTime(candidate.end_time)}
        </p>
        {candidate.description && (
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
            {candidate.description}
          </p>
        )}
      </div>
    </label>
  );
}
