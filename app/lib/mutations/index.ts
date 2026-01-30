// Re-export all mutations from domain-specific files

// Connection/Configuration mutations
export {
  getConnectionConfig,
  saveConnectionConfig,
  testDatabaseConnection,
  testStorageConnection,
  type ConnectionConfig,
} from "./connectionMutations";

// Payment mutations
export {
  updatePaymentRateConfig,
  calculateArticlePayment,
  setManualPayment,
  markPaymentComplete,
  updateArticleBonusFlags,
} from "./paymentMutations";

// Article mutations
export {
  createArticle,
  updateArticleStatus,
  updateArticle,
  updateArticleContent,
  updateArticleFeedbackLetter,
  updateArticleTier,
  toggleArticleFeatured,
  deleteArticle,
  updateAttachmentCaption,
  updateArticleIssue,
} from "./articleMutations";

// Note mutations
export {
  addArticleNote,
  updateArticleNote,
  deleteArticleNote,
} from "./noteMutations";

// Volume/Issue mutations
export {
  createVolume,
  updateVolume,
  deleteVolume,
  createIssue,
  updateIssue,
  deleteIssue,
  migrateLegacyVolumeIssues,
} from "./volumeIssueMutations";

// Author mutations
export { updateAuthorPaymentInfo } from "./authorMutations";

// Saved view mutations
export {
  getSavedViews,
  getDefaultView,
  createSavedView,
  updateSavedView,
  setDefaultView,
  clearDefaultView,
  deleteSavedView,
  type SavedViewConfig,
  type SavedView,
} from "./savedViewMutations";
