import type { ReactNode } from 'react'
import { Download, Plus, Search, Settings, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { KindBadge } from '@/components/common/kind-badge'
import { StatusPill } from '@/components/common/status-pill'
import { TopicChip } from '@/components/common/topic-chip'
import { ExtractionTierWarning } from '@/components/common/extraction-tier-warning'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { LoadingGrid } from '@/components/common/loading-grid'
import { ItemCard } from '@/components/common/item-card'
import { ThemeToggle } from '@/components/common/theme-toggle'
import type { ItemKind, ItemStatus } from '@/components/common/types'

import { FIXTURE_ITEMS } from './fixtures'
import { ToastDemoButtons } from './toast-demo'

const ALL_KINDS: ItemKind[] = ['github', 'video', 'article', 'social', 'pdf', 'audio', 'other']
const ALL_STATUSES: ItemStatus[] = [
  'queued',
  'processing',
  'inbox',
  'to_test',
  'testing',
  'tested',
  'archived',
  'dropped',
  'failed',
]

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-b border-border py-10 first:pt-0 last:border-b-0">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

/**
 * Dev-only component gallery — not linked from the app shell's nav, reached
 * directly at /gallery. Server Component: every interactive primitive here
 * already owns its 'use client' boundary internally, so this page needs
 * none of its own except the one isolated ToastDemoButtons file (see its
 * comment for why calling `toast()` forces that one exception).
 */
export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="space-y-2 pb-8">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Dev-only · P5 UI Foundation</p>
        <h1 className="text-3xl font-semibold text-foreground">Component gallery</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every primitive and shared composite in <code className="text-xs">src/components/</code>, rendered from
          fixture data. Resize the window (390px and up) and toggle the theme below to check both axes this page
          exists to prove out.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <span className="text-sm text-muted-foreground">Theme:</span>
          <ThemeToggle />
        </div>
      </header>

      <Section title="Buttons" description="Every variant × size. All sizes meet the 44×44pt touch-target floor — density comes from padding and type, never from shrinking the tap height.">
        <div className="space-y-3">
          <Row>
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add item">
              <Plus className="size-4" />
            </Button>
            <Button disabled>Disabled</Button>
          </Row>
        </div>
      </Section>

      <Section title="Form controls" description="Native elements wherever one genuinely suffices (select, checkbox) — see each file's comment for why.">
        <div className="grid max-w-md gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="gallery-input">Search query</Label>
            <Input id="gallery-input" placeholder="agentic RAG evals" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gallery-invalid">Server URL (invalid state)</Label>
            <Input id="gallery-invalid" defaultValue="not a url" aria-invalid />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gallery-textarea">Note</Label>
            <Textarea id="gallery-textarea" placeholder="Why did you save this?" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gallery-select">Status</Label>
            <Select id="gallery-select" defaultValue="to_test">
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="gallery-checkbox" defaultChecked />
            <Label htmlFor="gallery-checkbox">Only show starred items</Label>
          </div>
        </div>
      </Section>

      <Section title="Badges">
        <Row>
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="muted">Muted</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="success">Success</Badge>
        </Row>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="inbox" className="max-w-md">
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="testing">Testing</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
          <TabsContent value="inbox">Unreviewed items land here as soon as the pipeline finishes.</TabsContent>
          <TabsContent value="testing">Items you're actively trying out.</TabsContent>
          <TabsContent value="archived">Kept for reference, off the active board.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Tooltip" description="Shows on hover and on keyboard focus alike.">
        <Row>
          <Tooltip id="gallery-tooltip-reextract" label="Re-run extraction from the browser extension">
            <Button variant="outline" size="icon" aria-label="Re-extract">
              <Download className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip id="gallery-tooltip-settings" label="Open settings" side="bottom">
            <Button variant="outline" size="icon" aria-label="Settings">
              <Settings className="size-4" />
            </Button>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Dialog" description="Built on the native <dialog> element — free focus trap, Escape-to-close, and focus restoration.">
        <Dialog>
          <DialogTrigger>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Re-extract this item?</DialogTitle>
              <DialogDescription>
                This re-runs the extraction ladder from the top. It won't touch your note or status.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Currently at <strong className="text-foreground">metadata only</strong> — re-extracting after opening
              the source with the browser extension usually upgrades it to full.
            </p>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button>Re-extract</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Sheet" description="Same native <dialog> mechanics as Dialog, docked to an edge. Default is a bottom sheet on phones, a right-side panel from sm: up — resize to see it switch.">
        <Sheet>
          <SheetTrigger>
            <Button variant="outline">Open filters</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filter library</SheetTitle>
              <SheetDescription>Narrow the grid by kind, topic, status, or date.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sheet-kind">Kind</Label>
                <Select id="sheet-kind" defaultValue="">
                  <option value="">All kinds</option>
                  {ALL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="sheet-starred" />
                <Label htmlFor="sheet-starred">Starred only</Label>
              </div>
            </div>
            <SheetFooter>
              <Button variant="outline">Reset</Button>
              <Button>Apply</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Section>

      <Section title="Dropdown menu">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="outline">Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Item actions</DropdownMenuLabel>
            <DropdownMenuItem>Star</DropdownMenuItem>
            <DropdownMenuItem>Move to Testing</DropdownMenuItem>
            <DropdownMenuItem>Re-extract</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Drop</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Toast">
        <ToastDemoButtons />
      </Section>

      <Section title="Skeleton" description="Carries the app's one signature motion moment — the shimmer sweep. See globals.css for the reasoning.">
        <div className="max-w-sm space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Section>

      <Section title="Loading grid">
        <LoadingGrid count={4} />
      </Section>

      <Section title="Kind badge" description="All 7 ItemKind values (the enum has 7, not 6 — see the final report).">
        <Row>
          {ALL_KINDS.map((k) => (
            <KindBadge key={k} kind={k} />
          ))}
        </Row>
      </Section>

      <Section title="Status pill" description="All 9 ItemStatus values, bucketed into the system's five semantic tones.">
        <Row>
          {ALL_STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </Row>
      </Section>

      <Section title="Topic chip">
        <Row>
          <TopicChip label="RAG Evals" color="#6366f1" />
          <TopicChip label="Diffusion Models" color="#0ea5e9" />
          <TopicChip label="fine-tuning" />
          <TopicChip label="+3" />
        </Row>
      </Section>

      <Section
        title="Extraction tier warning"
        description="Renders nothing for `full` — degradation must be visible, so its absence is the tell that everything came through."
      >
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">full (renders nothing):</p>
            <div className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground italic">
              <ExtractionTierWarning tier="full" />
              nothing rendered
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">compact (used inside ItemCard):</p>
            <Row>
              <ExtractionTierWarning tier="partial" />
              <ExtractionTierWarning tier="metadata_only" />
            </Row>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">detailed (item-detail-style banner, with an action slot):</p>
            <ExtractionTierWarning
              tier="metadata_only"
              variant="detailed"
              className="max-w-lg"
              action={
                <Button size="sm" variant="outline">
                  Re-extract
                </Button>
              }
            />
          </div>
        </div>
      </Section>

      <Section title="Empty state" description="One flexible component, two different usages below.">
        <div className="grid gap-6 sm:grid-cols-2">
          <EmptyState
            icon={Download}
            title="Nothing saved yet"
            description="Share a link from the extension, the Android share sheet, or paste one below to get started."
            action={<Button size="sm">Paste a link</Button>}
          />
          <EmptyState
            icon={Search}
            title="No results for “video diffusion fine-tuning”"
            description="Try a broader term, or check the kind/status filters in the rail."
          />
        </div>
      </Section>

      <Section title="Error state">
        <ErrorState
          title="Couldn't load your library"
          description="The request timed out. Nothing was lost — your items are still saved."
          action={
            <Button size="sm" variant="outline">
              <TriangleAlert className="size-4" />
              Try again
            </Button>
          }
        />
      </Section>

      <Section title="ItemCard" description="All 7 kinds, plus edge cases: no thumbnail, no summary yet, a still-processing shimmer, starred, a long title, and a dropped-vs-failed distinction.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIXTURE_ITEMS.map((item) => (
            <ItemCard key={item.id} item={item} href={`#${item.id}`} />
          ))}
        </div>
      </Section>
    </div>
  )
}
