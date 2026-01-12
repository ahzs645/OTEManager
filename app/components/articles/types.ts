export type ViewMode = 'list' | 'board' | 'issue'
export type SortField = 'title' | 'author' | 'volume' | 'status' | 'submitted' | 'tier'
export type SortOrder = 'asc' | 'desc'

export type Article = {
  id: string
  title: string
  internalStatus: string
  articleTier: string
  volume: number | null
  issue: number | null
  submittedAt: Date | null
  createdAt: Date
  prefersAnonymity: boolean
  paymentStatus: boolean
  author: {
    id: string
    givenName: string
    surname: string
  } | null
  attachments: Array<{ id: string }>
  multimediaTypes: Array<{ id: string; multimediaType: string }>
  publicationIssue?: {
    issueNumber: number
    volume?: {
      volumeNumber: number
    }
  } | null
}

export const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Pending Review', label: 'Pending Review' },
  { value: 'In Review', label: 'In Review' },
  { value: 'Needs Revision', label: 'Needs Revision' },
  { value: 'Approved', label: 'Approved' },
  { value: 'In Editing', label: 'In Editing' },
  { value: 'Ready for Publication', label: 'Ready' },
  { value: 'Published', label: 'Published' },
  { value: 'Archived', label: 'Archived' },
]

export const TIER_OPTIONS = [
  { value: '', label: 'All Tiers' },
  { value: 'Tier 1 (Basic)', label: 'T1 Basic' },
  { value: 'Tier 2 (Standard)', label: 'T2 Standard' },
  { value: 'Tier 3 (Advanced)', label: 'T3 Advanced' },
]
