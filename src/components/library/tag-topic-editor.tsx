'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { slugify } from '@/components/library/slugify'
import type { Topic } from '@/components/library/types'

export interface TagTopicEditorProps {
  tags: string[]
  topic: Topic | null
  onSaveTags: (tags: string[]) => void
  onSaveTopic: (topicSlug: string | null) => void
  isSaving: boolean
}

/**
 * The other half of deliverable #10 — manual tag/topic override. `PATCH /api/v1/items/:id`'s
 * `tags` field is a full-replacement array (docs/API.md §3.5, §4) — every add/remove below sends
 * the complete next array, never a diff. Topic override takes a free-text label and slugifies it
 * client-side; the API creates the topic if the slug doesn't exist yet (§3.5), which is exactly
 * the human-curation path this control is for.
 */
export function TagTopicEditor({
  tags,
  topic,
  onSaveTags,
  onSaveTopic,
  isSaving,
}: TagTopicEditorProps) {
  const [tagInput, setTagInput] = useState('')
  const [topicInput, setTopicInput] = useState(topic?.label ?? '')
  const [prevTopicLabel, setPrevTopicLabel] = useState(topic?.label ?? '')
  if ((topic?.label ?? '') !== prevTopicLabel) {
    setPrevTopicLabel(topic?.label ?? '')
    setTopicInput(topic?.label ?? '')
  }

  function addTag() {
    const value = tagInput.trim()
    if (!value) return
    if (!tags.includes(value)) onSaveTags([...tags, value])
    setTagInput('')
  }

  function removeTag(tag: string) {
    onSaveTags(tags.filter((t) => t !== tag))
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="item-tag-input">Tags</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => removeTag(tag)}
                disabled={isSaving}
                className="inline-flex h-11 items-center gap-1.5 rounded-md bg-muted px-3 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {tag}
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Remove tag {tag}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            id="item-tag-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder="Add a tag and press Enter"
            disabled={isSaving}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addTag}
            disabled={isSaving || !tagInput.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="item-topic-input">Topic</Label>
        <div className="flex gap-2">
          <Input
            id="item-topic-input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="e.g. Agent Frameworks"
            disabled={isSaving}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onSaveTopic(topicInput.trim() ? slugify(topicInput) : null)}
            disabled={isSaving || !topicInput.trim()}
          >
            Set
          </Button>
          {topic && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setTopicInput('')
                onSaveTopic(null)
              }}
              disabled={isSaving}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {topic
            ? `Currently "${topic.label}"${topic.confidence >= 1 ? ' (manually set)' : ` — AI-assigned, ${Math.round(topic.confidence * 100)}% confidence`}.`
            : 'No topic assigned yet.'}
        </p>
      </div>
    </div>
  )
}
