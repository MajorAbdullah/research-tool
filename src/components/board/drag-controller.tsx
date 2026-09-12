'use client'

/**
 * The board's drag-and-drop engine — hand-rolled on the Pointer Events API, deliberately NOT the
 * native HTML5 Drag and Drop API (`draggable` + `dragstart`/`dragover`/`drop`).
 *
 * WHY POINTER EVENTS AND NOT HTML5 DND: HTML5 DnD is mouse-only in practice — Android Chrome and
 * iOS Safari do not fire `dragstart`/`dragover`/`drop` for touch input at all, full stop, and this
 * board's hard requirement is "must work with touch on Android." Pointer Events
 * (`pointerdown`/`pointermove`/`pointerup`, plus `setPointerCapture`) unify mouse, touch, and pen
 * into one event model with no separate touch code path to maintain — that is the actual reason
 * Pointer Events exist, and it is why this is one engine, not "HTML5 DnD for desktop, something
 * else for mobile." No drag-and-drop library is used either: none is in `package.json` today,
 * this phase cannot run `pnpm install`, and every other interactive primitive in
 * `src/components/ui/**` (Dialog, Sheet, DropdownMenu, Tooltip) is already hand-rolled rather than
 * pulling in a dependency for something native APIs can do — this follows the same house style.
 *
 * Split from the rest of the board on purpose: this file only knows about pointer geometry and a
 * generic `{itemId, fromColumn, toColumn, toIndex}` result. It has no idea what a "status" is or
 * which columns are legal targets — `canDropOn` is injected by the caller (board-view.tsx, backed
 * by status-transitions.ts) so this engine could just as easily drive a different kanban tomorrow.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { indexForPointerY, pointInBox, type RectLike } from './pointer-geometry'
import type { BoardColumnKey, ItemStatus } from './board-types'

export interface DragState {
  itemId: string
  fromStatus: ItemStatus
  fromColumn: BoardColumnKey
  startX: number
  startY: number
  currentX: number
  currentY: number
  overColumn: BoardColumnKey | null
  overIndex: number | null
}

export interface DragDropResult {
  itemId: string
  fromColumn: BoardColumnKey
  toColumn: BoardColumnKey
  toIndex: number
}

interface BeginDragParams {
  itemId: string
  fromStatus: ItemStatus
  fromColumn: BoardColumnKey
  pointerId: number
  startX: number
  startY: number
}

interface DragControllerApi {
  dragState: DragState | null
  isColumnAllowed: (column: BoardColumnKey) => boolean
  registerColumnEl: (column: BoardColumnKey, el: HTMLElement | null) => void
  registerItemEl: (itemId: string, el: HTMLElement | null) => void
  registerColumnItemIds: (column: BoardColumnKey, ids: readonly string[]) => void
  beginDrag: (params: BeginDragParams) => void
}

const DragControllerContext = createContext<DragControllerApi | null>(null)

export function useDragController(): DragControllerApi {
  const ctx = useContext(DragControllerContext)
  if (!ctx) throw new Error('useDragController must be used inside <DragProvider>')
  return ctx
}

export interface DragProviderProps {
  children: ReactNode
  /** Whether the item currently being dragged (by its origin status) may land in `column`. */
  canDropOn: (fromStatus: ItemStatus, column: BoardColumnKey) => boolean
  onDrop: (result: DragDropResult) => void
}

export function DragProvider({ children, canDropOn, onDrop }: DragProviderProps) {
  const [dragState, setDragState] = useState<DragState | null>(null)
  const columnEls = useRef(new Map<BoardColumnKey, HTMLElement>())
  const itemEls = useRef(new Map<string, HTMLElement>())
  const columnItemIds = useRef(new Map<BoardColumnKey, readonly string[]>())

  const registerColumnEl = useCallback((column: BoardColumnKey, el: HTMLElement | null) => {
    if (el) columnEls.current.set(column, el)
    else columnEls.current.delete(column)
  }, [])

  const registerItemEl = useCallback((itemId: string, el: HTMLElement | null) => {
    if (el) itemEls.current.set(itemId, el)
    else itemEls.current.delete(itemId)
  }, [])

  const registerColumnItemIds = useCallback((column: BoardColumnKey, ids: readonly string[]) => {
    columnItemIds.current.set(column, ids)
  }, [])

  const isColumnAllowed = useCallback(
    (column: BoardColumnKey) => {
      if (!dragState) return true
      return canDropOn(dragState.fromStatus, column)
    },
    [dragState, canDropOn],
  )

  /** Hit-test a viewport point against every registered column, then that column's item rects. */
  const locate = useCallback(
    (x: number, y: number): { column: BoardColumnKey; index: number } | null => {
      let hitColumn: BoardColumnKey | null = null
      for (const [key, el] of columnEls.current) {
        if (pointInBox(x, y, el.getBoundingClientRect())) {
          hitColumn = key
          break
        }
      }
      if (!hitColumn) return null

      const ids = columnItemIds.current.get(hitColumn) ?? []
      const rects: RectLike[] = []
      for (const id of ids) {
        const el = itemEls.current.get(id)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        rects.push({ id, top: rect.top, height: rect.height })
      }
      return { column: hitColumn, index: indexForPointerY(rects, y) }
    },
    [],
  )

  const beginDrag = useCallback(
    ({ itemId, fromStatus, fromColumn, pointerId, startX, startY }: BeginDragParams) => {
      setDragState({
        itemId,
        fromStatus,
        fromColumn,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        overColumn: fromColumn,
        overIndex: null,
      })

      const handleMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        const target = locate(event.clientX, event.clientY)
        setDragState((current) =>
          current
            ? {
                ...current,
                currentX: event.clientX,
                currentY: event.clientY,
                overColumn: target?.column ?? null,
                overIndex: target?.index ?? null,
              }
            : current,
        )
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
      }

      const handleUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        cleanup()
        const target = locate(event.clientX, event.clientY)
        setDragState(null)
        if (target && canDropOn(fromStatus, target.column)) {
          onDrop({ itemId, fromColumn, toColumn: target.column, toIndex: target.index })
        }
      }

      const handleCancel = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        cleanup()
        setDragState(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [locate, canDropOn, onDrop],
  )

  const api = useMemo<DragControllerApi>(
    () => ({
      dragState,
      isColumnAllowed,
      registerColumnEl,
      registerItemEl,
      registerColumnItemIds,
      beginDrag,
    }),
    [
      dragState,
      isColumnAllowed,
      registerColumnEl,
      registerItemEl,
      registerColumnItemIds,
      beginDrag,
    ],
  )

  return <DragControllerContext.Provider value={api}>{children}</DragControllerContext.Provider>
}

/**
 * Wires a drag-handle element's `onPointerDown` to `beginDrag`. `touchAction: 'none'` is scoped to
 * just the handle (not the card, not the column) precisely so it never fights the column's normal
 * vertical scrolling or the mobile carousel's horizontal swipe — see the phase report for why a
 * dedicated handle (rather than "drag from anywhere on the card") was the deliberate choice here.
 */
export function useDragHandle(itemId: string, fromStatus: ItemStatus, fromColumn: BoardColumnKey) {
  const { beginDrag } = useDragController()

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      beginDrag({
        itemId,
        fromStatus,
        fromColumn,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      })
    },
    [beginDrag, itemId, fromStatus, fromColumn],
  )

  return { onPointerDown, style: { touchAction: 'none' as const } }
}
