import { format, isToday, isTomorrow } from "date-fns";
import { CalendarCheck } from "lucide-react";

import type { FreeSlotItem } from "@/lib/types";
import { formatClockTime, formatDuration } from "@/lib/utils";

interface FreeSlotsCardProps {
  /**
   * Offset-aware, already in the user's local timezone (see the `free_slots`
   * doc comment on `ChatMessageResponse`) — parse directly with `new Date`.
   */
  slots: FreeSlotItem[];
}

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

export default function FreeSlotsCard({ slots }: FreeSlotsCardProps) {
  if (slots.length === 0) return null;

  const byDay = new Map<string, { date: Date; slots: FreeSlotItem[] }>();
  for (const slot of slots) {
    const start = new Date(slot.start_time);
    const key = format(start, "yyyy-MM-dd");
    const entry = byDay.get(key) ?? { date: start, slots: [] };
    entry.slots.push(slot);
    byDay.set(key, entry);
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <CalendarCheck className="h-3.5 w-3.5" />
        Available slots
      </div>
      <div className="space-y-1.5">
        {[...byDay.values()].map(({ date, slots: daySlots }) => (
          <div key={format(date, "yyyy-MM-dd")} className="flex flex-wrap items-start gap-1.5">
            <span className="mt-1 w-20 shrink-0 text-xs font-medium text-zinc-600">{dayLabel(date)}</span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {daySlots.map((slot, index) => {
                const start = new Date(slot.start_time);
                const end = new Date(slot.end_time);
                const crossesMidnight = format(start, "yyyy-MM-dd") !== format(end, "yyyy-MM-dd");
                return (
                  <span
                    key={index}
                    title={formatDuration(slot.duration_minutes)}
                    className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700"
                  >
                    {formatClockTime(start)} – {formatClockTime(end)}
                    {crossesMidnight && <span className="ml-1 text-[10px] text-emerald-500">+1</span>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
