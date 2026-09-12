import { cn } from '@/lib/utils'

/**
 * A small, dependency-free stand-in for `class-variance-authority`.
 *
 * We intentionally don't add the `cva` package — this project's variant
 * needs are simple (a handful of named variant groups, no slots, no
 * animation presets) and a ~30-line local helper keeps one fewer dependency
 * in a phone-first bundle. The API is a deliberate subset of `cva`'s so the
 * primitives in this folder read exactly like their shadcn/ui equivalents.
 */

type VariantShape = Record<string, Record<string, string>>

/** For a variant shape `{ size: { sm: ...; lg: ... } }`, the props a caller passes. */
export type VariantProps<V extends VariantShape> = {
  [K in keyof V]?: keyof V[K]
}

interface CompoundVariant<V extends VariantShape> {
  /** Class applied only when every listed variant matches (others are ignored). */
  class: string
}

interface CvaConfig<V extends VariantShape> {
  variants: V
  defaultVariants?: VariantProps<V>
  compoundVariants?: Array<Partial<VariantProps<V>> & CompoundVariant<V>>
}

/**
 * Build a `(props) => className` function from a base class string plus a
 * table of named variants. Unspecified variant props fall back to
 * `defaultVariants`; a bare `className` is always merged in last so callers
 * can still override anything via `cn()`'s conflict resolution.
 */
export function cva<V extends VariantShape>(base: string, config: CvaConfig<V>) {
  const variantKeys = Object.keys(config.variants) as Array<keyof V>

  // `key` is `keyof V` on a *generic* V, so TS (correctly, under this repo's
  // noUncheckedIndexedAccess) can't prove a lookup is always present the way
  // it could for a concrete Record<FiniteUnion, X>. Resolved once here with
  // explicit fallbacks/casts rather than fought at every call site below.
  function resolve(key: keyof V, props: VariantProps<V> | undefined): string | undefined {
    const requested = props?.[key] ?? config.defaultVariants?.[key]
    if (requested == null) return undefined
    const group: Record<string, string> | undefined = config.variants[key]
    return group?.[requested as string]
  }

  return (props?: VariantProps<V> & { className?: string }): string => {
    const classes: string[] = [base]

    for (const key of variantKeys) {
      const cls = resolve(key, props)
      if (cls) classes.push(cls)
    }

    for (const compound of config.compoundVariants ?? []) {
      const matches = variantKeys.every((key) => {
        // A key the compound doesn't mention imposes no condition.
        if (!(key in compound)) return true
        const chosen = props?.[key] ?? config.defaultVariants?.[key]
        const required = (compound as Partial<VariantProps<V>>)[key]
        return chosen === required
      })
      if (matches) classes.push(compound.class)
    }

    return cn(...classes, props?.className)
  }
}

/** Extract the prop type a `cva()`-built function accepts, mirroring cva's `VariantProps<typeof x>`. */
export type VariantPropsOf<F> = F extends (props?: infer P) => string ? P : never
