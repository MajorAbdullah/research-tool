'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface NoteEditorProps {
  note: string | null
  onSave: (note: string | null) => void
  isSaving: boolean
}

/** Half of deliverable #10 ("editable note ... optimistic"). Save/Cancel only appear once the draft actually differs from the saved note, so the common "just reading" case shows no dangling always-on controls. */
export function NoteEditor({ note, onSave, isSaving }: NoteEditorProps) {
  const [draft, setDraft] = useState(note ?? '')
  // Render-time state adjustment (see library-toolbar.tsx for the same pattern/rationale): resets
  // the draft whenever the saved note changes from elsewhere (a successful save, a refetch).
  const [prevNote, setPrevNote] = useState(note)
  if (note !== prevNote) {
    setPrevNote(note)
    setDraft(note ?? '')
  }

  const dirty = draft !== (note ?? '')

  return (
    <div className="space-y-1.5">
      <Label htmlFor="item-note">Your note</Label>
      <Textarea
        id="item-note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Why did you save this? What do you want to remember?"
        rows={4}
      />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft(note ?? '')}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onSave(draft.trim() ? draft : null)}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      )}
    </div>
  )
}
