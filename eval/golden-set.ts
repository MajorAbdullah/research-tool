/**
 * The golden set.
 *
 * CLAUDE.md → RAG requires retrieval and generation to be scored SEPARATELY, as four
 * distinct numbers, never one blended score: a good answer built on bad context is a
 * fragile system that will fail elsewhere, and a blended score hides exactly that.
 *
 *   pnpm eval      -> context precision + context recall   (retrieval)
 *   pnpm eval:rag  -> faithfulness + answer relevancy      (generation)
 *
 * Re-run BOTH before any change to chunking, embeddings, retrieval, or prompts.
 */

export interface Document {
  id: string
  kind: 'github' | 'video' | 'article' | 'social' | 'pdf'
  title: string
  /** Body text; for a video this stands in for the transcript. */
  text: string
}

export interface RetrievalCase {
  query: string
  /** Document ids that SHOULD be retrieved. Order-insensitive. */
  relevant: string[]
  /** Why this case exists — keep it, so nobody deletes a case they don't understand. */
  rationale: string
}

export interface GenerationCase {
  query: string
  /** Substrings the answer must be grounded in. */
  mustMention: string[]
  /** True when the corpus genuinely cannot answer — the model must say so, not invent. */
  expectInsufficient?: boolean
  rationale: string
}

/**
 * A miniature stand-in for a real library. Deliberately includes items whose TITLES do
 * not contain the words a user would search for — that asymmetry is the entire reason
 * hybrid search exists here, and a corpus without it would score suspiciously well.
 */
export const CORPUS: Document[] = [
  {
    id: 'vllm',
    kind: 'github',
    title: 'vllm-project/vllm',
    text: 'A high-throughput, memory-efficient inference and serving engine for LLMs. Uses PagedAttention to manage attention key and value memory, continuous batching of incoming requests, and quantization support including AWQ and GPTQ.',
  },
  {
    id: 'reel-diffusion',
    kind: 'video',
    // Title says nothing useful — this is the hybrid-search test case.
    title: 'this changes EVERYTHING 🤯',
    text: 'Walkthrough of fine-tuning a video diffusion transformer on consumer hardware. Covers LoRA adapters for temporal layers, latent caching to cut VRAM, and why naive frame-wise training produces flicker.',
  },
  {
    id: 'longctx-paper',
    kind: 'pdf',
    title: 'Lost in the Middle: How Language Models Use Long Contexts',
    text: 'Evaluates how retrieval-augmented models use information placed at different positions in a long input. Performance degrades when relevant evidence sits in the middle rather than at the beginning or end of the context window.',
  },
  {
    id: 'langgraph',
    kind: 'github',
    title: 'langchain-ai/langgraph',
    text: 'Library for building stateful multi-actor agent applications as graphs. Supports cycles, checkpointing, human-in-the-loop interrupts and durable execution of agent workflows.',
  },
  {
    id: 'crewai',
    kind: 'github',
    title: 'crewAIInc/crewAI',
    text: 'Framework for orchestrating role-playing autonomous AI agents that collaborate on tasks. Agents have roles, goals and tools, and are composed into crews with sequential or hierarchical process.',
  },
  {
    id: 'rrf-post',
    kind: 'article',
    title: 'Why we switched to Reciprocal Rank Fusion',
    text: 'Blog post on combining BM25 keyword ranking with dense vector retrieval. Argues RRF beats hand-tuned weighted score averaging because it needs no score normalization across retrievers with incomparable scales.',
  },
  {
    id: 'quant-thread',
    kind: 'social',
    title: 'thread on 4-bit quantization tradeoffs',
    text: 'Thread comparing GPTQ, AWQ and bitsandbytes NF4 for 7B models. Notes perplexity deltas, throughput gains, and that activation outliers hurt naive round-to-nearest quantization badly.',
  },
]

export const RETRIEVAL_CASES: RetrievalCase[] = [
  {
    query: 'video diffusion fine-tuning',
    relevant: ['reel-diffusion'],
    rationale:
      'THE flagship case. The only relevant item has a title of pure clickbait, so keyword search alone cannot find it. If this regresses, semantic retrieval is broken.',
  },
  {
    query: 'PagedAttention',
    relevant: ['vllm'],
    rationale:
      'A rare exact technical term. Dense embeddings blur these; BM25 catches them. If this regresses, the keyword half of the hybrid is broken.',
  },
  {
    query: 'agent frameworks',
    relevant: ['langgraph', 'crewai'],
    rationale: 'Multi-result topical query — checks recall, not just top-1 precision.',
  },
  {
    query: 'how should I combine keyword and vector search',
    relevant: ['rrf-post'],
    rationale: 'Natural-language question whose wording differs from the document phrasing.',
  },
  {
    query: '4-bit quantization',
    relevant: ['quant-thread', 'vllm'],
    rationale:
      'Spans two kinds (social + github) — verifies kind is not accidentally acting as a filter.',
  },
  {
    query: 'does answer quality drop when evidence is in the middle of a long prompt',
    relevant: ['longctx-paper'],
    rationale: 'Paraphrase with almost no lexical overlap with the title. Pure semantic case.',
  },
  {
    query: 'AWQ GPTQ',
    relevant: ['vllm', 'quant-thread'],
    rationale: 'Acronym-only query — adversarial for embeddings, easy for BM25.',
  },
]

export const GENERATION_CASES: GenerationCase[] = [
  {
    query: 'What did I save about long-context evaluation?',
    mustMention: ['middle'],
    rationale: 'Must cite the long-context paper and state its actual finding.',
  },
  {
    query: 'Which agent frameworks do I have, and how do they differ?',
    mustMention: ['langgraph', 'crewai'],
    rationale: 'Multi-document synthesis with citations for both.',
  },
  {
    query: 'What did I save about Kubernetes operators?',
    mustMention: [],
    expectInsufficient: true,
    rationale:
      'Nothing in the corpus covers this. The model MUST say it has nothing saved rather than inventing an answer — this is the primary hallucination guard.',
  },
]
