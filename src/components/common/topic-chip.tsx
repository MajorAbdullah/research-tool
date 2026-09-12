import { cn } from '@/lib/utils'

export interface TopicChipProps {
  label: string
  /** CSS color from the Topic record (LLM/user-assigned, arbitrary — not a design-system token). */
  color?: string | null
  className?: string
}

/**
 * Renders a topic *or* a plain tag (ItemCard uses the same component for
 * both — visually they're the same "small labeled pill," differing only in
 * whether a color is present). The per-topic `color` is genuinely
 * user/LLM-controlled data with no accessibility guarantee, so it's used
 * only as a small decorative dot, never as the text/background color of the
 * chip itself — the label stays in the system's normal, contrast-checked
 * foreground/background pair regardless of which arbitrary hue a topic was
 * assigned. That also keeps a card grid with a dozen topics from turning
 * into a wall of random-hued confetti.
 */
export function TopicChip({ label, color, className }: TopicChipProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      {color && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </span>
  )
}
