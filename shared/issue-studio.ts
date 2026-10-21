/** Saved editorial choices. Extension fields preserve the planner's editable recipe. */
export interface IssueStudioPage {
  id: string;
  pageNumber: number;
  templateId?: string;
  locked?: boolean;
  [key: string]: unknown;
}
export interface IssueStudioPlacement {
  id: string;
  articleId: string;
  pageIds: string[];
  sourceRevision?: string;
  currentSourceRevision?: string;
  stale?: boolean;
  locked?: boolean;
  included?: boolean;
  imageChoices?: unknown[];
  [key: string]: unknown;
}
export interface IssueStudioReservation {
  id: string;
  pageNumber: number;
  /** Points: x, y, width, height, within the 756 × 792 point page. */
  rect: [number, number, number, number];
  kind: "booked-ad" | "house-ad" | "editorial";
  artworkStatus: "pending" | "ready";
  artworkPath?: string;
  locked?: boolean;
  [key: string]: unknown;
}
export interface IssueStudioState {
  pageBudget: number;
  houseStyle: string;
  pages: IssueStudioPage[];
  placements: IssueStudioPlacement[];
  reservations: IssueStudioReservation[];
  plannerState: Record<string, unknown> | null;
}
export const emptyIssueStudioState = (): IssueStudioState => ({
  pageBudget: 16,
  houseStyle: "ote-2025",
  pages: [],
  placements: [],
  reservations: [],
  plannerState: null,
});
export const studioTableNames = [
  "issueDesignPlans",
  "issuePages",
  "issuePlacements",
  "issueReservations",
  "issueDesignRevisions",
  "compositionJobs",
] as const;
export interface IssueDesignPlans {
  id: string;
  issueId: string;
  revision: number;
  pageBudget: number;
  houseStyle: string;
  plannerState: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface IssueStudioObject {
  id: string;
  issueId: string;
  planId: string;
  data: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface IssuePlacements extends IssueStudioObject {
  articleId: string;
}
export interface IssueDesignRevisions {
  id: string;
  issueId: string;
  planId: string;
  revision: number;
  snapshot: string;
  createdAt: Date;
}
export interface CompositionJobs extends IssueStudioObject {
  inputRevision: number;
  status: string;
}
const text = { kind: "text", nullable: false, enum: null } as const;
const integer = { kind: "integer", nullable: false, enum: null } as const;
const timestamp = { kind: "timestamp", nullable: false, enum: null } as const;
const objectFields = {
  id: text,
  issueId: text,
  planId: text,
  data: text,
  createdAt: timestamp,
  updatedAt: timestamp,
};
export const studioRecordFields = {
  issueDesignPlans: {
    id: text,
    issueId: text,
    revision: integer,
    pageBudget: integer,
    houseStyle: text,
    plannerState: text,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  issuePages: objectFields,
  issuePlacements: { ...objectFields, articleId: text },
  issueReservations: objectFields,
  issueDesignRevisions: {
    id: text,
    issueId: text,
    planId: text,
    revision: integer,
    snapshot: text,
    createdAt: timestamp,
  },
  compositionJobs: { ...objectFields, inputRevision: integer, status: text },
};
