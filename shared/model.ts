// Application IDs stay stable across backup restores; Convex also assigns an internal _id.
export interface Authors {
  id: string;
  givenName: string;
  surname: string;
  email: string;
  role:
    | "Staff Writer"
    | "Guest Contributor"
    | "Editor"
    | "Photographer"
    | "Graphic Designer"
    | "Other"
    | null;
  authorType:
    "Student" | "Faculty" | "Staff" | "Organization" | "External" | null;
  studentType: "Undergrad" | "Grad" | "Alumni" | "Other" | null;
  autoDepositAvailable: boolean | null;
  etransferEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Articles {
  id: string;
  title: string;
  authorId: string;
  articleTier:
    "Tier 1 (Basic)" | "Tier 2 (Standard)" | "Tier 3 (Advanced)" | null;
  internalStatus:
    | "Draft"
    | "Pending Review"
    | "In Review"
    | "Needs Revision"
    | "Approved"
    | "In Editing"
    | "Ready for Publication"
    | "Published"
    | "Archived"
    | null;
  automationStatus:
    "Processing" | "Pending Review" | "Completed" | "Failed" | null;
  prefersAnonymity: boolean | null;
  articleFilePath: string | null;
  content: string | null;
  feedbackLetter: string | null;
  volume: number | null;
  issue: number | null;
  issueId: string | null;
  paymentStatus: boolean | null;
  paymentAmount: number | null;
  paidAt: Date | null;
  paymentRateSnapshot: string | null;
  paymentCalculatedAt: Date | null;
  paymentIsManual: boolean | null;
  isFeatured: boolean | null;
  hasResearchBonus: boolean | null;
  hasTimeSensitiveBonus: boolean | null;
  hasMultimediaBonus: boolean | null;
  hasProfessionalPhotos: boolean | null;
  hasProfessionalGraphics: boolean | null;
  formResponseId: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleMultimediaTypes {
  id: string;
  articleId: string;
  multimediaType: "Photo" | "Graphic" | "Video" | "Audio" | "Other";
}

export interface Attachments {
  id: string;
  articleId: string;
  attachmentType: "word_document" | "photo" | "graphic" | "other";
  fileName: string;
  originalFileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  caption: string | null;
  photoNumber: number | null;
  createdAt: Date;
}

export interface ArticleNotes {
  id: string;
  articleId: string;
  content: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface StatusHistory {
  id: string;
  articleId: string;
  fromStatus:
    | "Draft"
    | "Pending Review"
    | "In Review"
    | "Needs Revision"
    | "Approved"
    | "In Editing"
    | "Ready for Publication"
    | "Published"
    | "Archived"
    | null;
  toStatus:
    | "Draft"
    | "Pending Review"
    | "In Review"
    | "Needs Revision"
    | "Approved"
    | "In Editing"
    | "Ready for Publication"
    | "Published"
    | "Archived";
  changedBy: string | null;
  changedAt: Date;
  notes: string | null;
}

export interface PaymentRateConfig {
  id: string;
  tier1Rate: number;
  tier2Rate: number;
  tier3Rate: number;
  researchBonus: number;
  multimediaBonus: number;
  timeSensitiveBonus: number;
  professionalPhotoBonus: number;
  professionalGraphicBonus: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface PaymentRateHistory {
  id: string;
  ratesSnapshot: string;
  changedBy: string | null;
  changedAt: Date;
  notes: string | null;
}

export interface Volumes {
  id: string;
  volumeNumber: number;
  year: number | null;
  startDate: Date | null;
  endDate: Date | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Issues {
  id: string;
  volumeId: string;
  issueNumber: number;
  title: string | null;
  releaseDate: Date | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedArticleViews {
  id: string;
  name: string;
  isDefault: boolean | null;
  status: string | null;
  tier: string | null;
  search: string | null;
  sortBy: string | null;
  sortOrder: string | null;
  viewMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RowMap {
  authors: Authors;
  articles: Articles;
  articleMultimediaTypes: ArticleMultimediaTypes;
  attachments: Attachments;
  articleNotes: ArticleNotes;
  statusHistory: StatusHistory;
  paymentRateConfig: PaymentRateConfig;
  paymentRateHistory: PaymentRateHistory;
  volumes: Volumes;
  issues: Issues;
  savedArticleViews: SavedArticleViews;
}
export type TableName = keyof RowMap;
export const tableNames = [
  "authors",
  "articles",
  "articleMultimediaTypes",
  "attachments",
  "articleNotes",
  "statusHistory",
  "paymentRateConfig",
  "paymentRateHistory",
  "volumes",
  "issues",
  "savedArticleViews",
] as const;
export const recordDefaults: Record<TableName, Record<string, unknown>> = {
  authors: {
    role: "Guest Contributor",
    authorType: "Student",
    studentType: null,
    autoDepositAvailable: false,
    etransferEmail: null,
    createdAt: "$now",
    updatedAt: "$now",
  },
  articles: {
    articleTier: "Tier 1 (Basic)",
    internalStatus: "Draft",
    automationStatus: "Pending Review",
    prefersAnonymity: false,
    articleFilePath: null,
    content: null,
    feedbackLetter: null,
    volume: null,
    issue: null,
    issueId: null,
    paymentStatus: false,
    paymentAmount: null,
    paidAt: null,
    paymentRateSnapshot: null,
    paymentCalculatedAt: null,
    paymentIsManual: false,
    isFeatured: false,
    hasResearchBonus: false,
    hasTimeSensitiveBonus: false,
    hasMultimediaBonus: null,
    hasProfessionalPhotos: false,
    hasProfessionalGraphics: false,
    formResponseId: null,
    submittedAt: null,
    createdAt: "$now",
    updatedAt: "$now",
  },
  articleMultimediaTypes: {},
  attachments: {
    fileSize: null,
    mimeType: null,
    caption: null,
    photoNumber: null,
    createdAt: "$now",
  },
  articleNotes: {
    createdBy: null,
    createdAt: "$now",
  },
  statusHistory: {
    fromStatus: null,
    changedBy: null,
    changedAt: "$now",
    notes: null,
  },
  paymentRateConfig: {
    tier1Rate: 2000,
    tier2Rate: 3500,
    tier3Rate: 5000,
    researchBonus: 1000,
    multimediaBonus: 500,
    timeSensitiveBonus: 500,
    professionalPhotoBonus: 1500,
    professionalGraphicBonus: 1500,
    updatedAt: "$now",
    updatedBy: null,
  },
  paymentRateHistory: {
    changedBy: null,
    changedAt: "$now",
    notes: null,
  },
  volumes: {
    year: null,
    startDate: null,
    endDate: null,
    description: null,
    createdAt: "$now",
    updatedAt: "$now",
  },
  issues: {
    title: null,
    releaseDate: null,
    description: null,
    createdAt: "$now",
    updatedAt: "$now",
  },
  savedArticleViews: {
    isDefault: false,
    status: null,
    tier: null,
    search: null,
    sortBy: null,
    sortOrder: null,
    viewMode: "list",
    createdAt: "$now",
    updatedAt: "$now",
  },
};
export const dateFields: Record<TableName, readonly string[]> = {
  authors: ["createdAt", "updatedAt"],
  articles: [
    "paidAt",
    "paymentCalculatedAt",
    "submittedAt",
    "createdAt",
    "updatedAt",
  ],
  articleMultimediaTypes: [],
  attachments: ["createdAt"],
  articleNotes: ["createdAt"],
  statusHistory: ["changedAt"],
  paymentRateConfig: ["updatedAt"],
  paymentRateHistory: ["changedAt"],
  volumes: ["startDate", "endDate", "createdAt", "updatedAt"],
  issues: ["releaseDate", "createdAt", "updatedAt"],
  savedArticleViews: ["createdAt", "updatedAt"],
};
export const recordFields = {
  authors: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    givenName: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    surname: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    email: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    role: {
      kind: "contributorRoleEnum",
      nullable: true,
      enum: [
        "Staff Writer",
        "Guest Contributor",
        "Editor",
        "Photographer",
        "Graphic Designer",
        "Other",
      ],
    },
    authorType: {
      kind: "authorTypeEnum",
      nullable: true,
      enum: ["Student", "Faculty", "Staff", "Organization", "External"],
    },
    studentType: {
      kind: "studentTypeEnum",
      nullable: true,
      enum: ["Undergrad", "Grad", "Alumni", "Other"],
    },
    autoDepositAvailable: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    etransferEmail: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    updatedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
  articles: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    title: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    authorId: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    articleTier: {
      kind: "articleTierEnum",
      nullable: true,
      enum: ["Tier 1 (Basic)", "Tier 2 (Standard)", "Tier 3 (Advanced)"],
    },
    internalStatus: {
      kind: "internalStatusEnum",
      nullable: true,
      enum: [
        "Draft",
        "Pending Review",
        "In Review",
        "Needs Revision",
        "Approved",
        "In Editing",
        "Ready for Publication",
        "Published",
        "Archived",
      ],
    },
    automationStatus: {
      kind: "automationStatusEnum",
      nullable: true,
      enum: ["Processing", "Pending Review", "Completed", "Failed"],
    },
    prefersAnonymity: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    articleFilePath: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    content: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    feedbackLetter: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    volume: {
      kind: "integer",
      nullable: true,
      enum: null,
    },
    issue: {
      kind: "integer",
      nullable: true,
      enum: null,
    },
    issueId: {
      kind: "uuid",
      nullable: true,
      enum: null,
    },
    paymentStatus: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    paymentAmount: {
      kind: "integer",
      nullable: true,
      enum: null,
    },
    paidAt: {
      kind: "timestamp",
      nullable: true,
      enum: null,
    },
    paymentRateSnapshot: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    paymentCalculatedAt: {
      kind: "timestamp",
      nullable: true,
      enum: null,
    },
    paymentIsManual: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    isFeatured: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    hasResearchBonus: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    hasTimeSensitiveBonus: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    hasMultimediaBonus: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    hasProfessionalPhotos: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    hasProfessionalGraphics: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    formResponseId: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    submittedAt: {
      kind: "timestamp",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    updatedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
  articleMultimediaTypes: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    articleId: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    multimediaType: {
      kind: "multimediaTypeEnum",
      nullable: false,
      enum: ["Photo", "Graphic", "Video", "Audio", "Other"],
    },
  },
  attachments: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    articleId: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    attachmentType: {
      kind: "attachmentTypeEnum",
      nullable: false,
      enum: ["word_document", "photo", "graphic", "other"],
    },
    fileName: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    originalFileName: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    filePath: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    fileSize: {
      kind: "integer",
      nullable: true,
      enum: null,
    },
    mimeType: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    caption: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    photoNumber: {
      kind: "integer",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
  articleNotes: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    articleId: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    content: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    createdBy: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
  statusHistory: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    articleId: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    fromStatus: {
      kind: "internalStatusEnum",
      nullable: true,
      enum: [
        "Draft",
        "Pending Review",
        "In Review",
        "Needs Revision",
        "Approved",
        "In Editing",
        "Ready for Publication",
        "Published",
        "Archived",
      ],
    },
    toStatus: {
      kind: "internalStatusEnum",
      nullable: false,
      enum: [
        "Draft",
        "Pending Review",
        "In Review",
        "Needs Revision",
        "Approved",
        "In Editing",
        "Ready for Publication",
        "Published",
        "Archived",
      ],
    },
    changedBy: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    changedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    notes: {
      kind: "text",
      nullable: true,
      enum: null,
    },
  },
  paymentRateConfig: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    tier1Rate: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    tier2Rate: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    tier3Rate: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    researchBonus: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    multimediaBonus: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    timeSensitiveBonus: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    professionalPhotoBonus: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    professionalGraphicBonus: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    updatedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    updatedBy: {
      kind: "text",
      nullable: true,
      enum: null,
    },
  },
  paymentRateHistory: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    ratesSnapshot: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    changedBy: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    changedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    notes: {
      kind: "text",
      nullable: true,
      enum: null,
    },
  },
  volumes: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    volumeNumber: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    year: {
      kind: "integer",
      nullable: true,
      enum: null,
    },
    startDate: {
      kind: "timestamp",
      nullable: true,
      enum: null,
    },
    endDate: {
      kind: "timestamp",
      nullable: true,
      enum: null,
    },
    description: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    updatedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
  issues: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    volumeId: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    issueNumber: {
      kind: "integer",
      nullable: false,
      enum: null,
    },
    title: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    releaseDate: {
      kind: "timestamp",
      nullable: true,
      enum: null,
    },
    description: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    updatedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
  savedArticleViews: {
    id: {
      kind: "uuid",
      nullable: false,
      enum: null,
    },
    name: {
      kind: "text",
      nullable: false,
      enum: null,
    },
    isDefault: {
      kind: "boolean",
      nullable: true,
      enum: null,
    },
    status: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    tier: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    search: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    sortBy: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    sortOrder: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    viewMode: {
      kind: "text",
      nullable: true,
      enum: null,
    },
    createdAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
    updatedAt: {
      kind: "timestamp",
      nullable: false,
      enum: null,
    },
  },
} as const;
export type AuthorType = NonNullable<Authors["authorType"]>;
export type StudentType = NonNullable<Authors["studentType"]>;
export const NON_PAID_AUTHOR_TYPES = ["Faculty", "Staff"] as const;
