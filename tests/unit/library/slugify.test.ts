import { describe, expect, it } from 'vitest'
import { slugify } from '@/components/library/slugify'

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Agent Frameworks')).toBe('agent-frameworks')
  })

  it('strips non-alphanumeric characters', () => {
    expect(slugify('RAG & Evals!!')).toBe('rag-evals')
  })

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugify('  --Video Diffusion--  ')).toBe('video-diffusion')
  })

  it('returns an empty string for input with no alphanumeric characters', () => {
    expect(slugify('***')).toBe('')
  })
})
