export type Volume = {
  id: string
  volumeNumber: number
  year: number | null
  startDate: Date | null
  endDate: Date | null
  description: string | null
  issues: Issue[]
}

export type Issue = {
  id: string
  volumeId: string
  issueNumber: number
  title: string | null
  releaseDate: Date | null
  description: string | null
  articleCount: number
}

export type VolumeFormData = {
  volumeNumber: string
  year: string
  startDate: string
  endDate: string
  description: string
}

export type IssueFormData = {
  issueNumber: string
  title: string
  releaseDate: string
  description: string
}

export const emptyVolumeForm: VolumeFormData = {
  volumeNumber: '',
  year: '',
  startDate: '',
  endDate: '',
  description: '',
}

export const emptyIssueForm: IssueFormData = {
  issueNumber: '',
  title: '',
  releaseDate: '',
  description: '',
}
