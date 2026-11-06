import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { emptyIssueStudioState } from "../shared/issue-studio";
import {
  mergePlannerRecipe,
  reconcileDepartedStories,
} from "../app/components/issue-studio/state";
const dependencies = vi.hoisted(() => ({ query: vi.fn(), getFile: vi.fn() }));
vi.mock("../server/convex", () => ({ query: dependencies.query }));
vi.mock("../storage", () => ({
  getStorage: () => ({ getFile: dependencies.getFile }),
}));
import { handleStudioBundle } from "../app/routes/api.issue-studio.$issueId.bundle";

describe("Issue Studio recipe reconciliation", () => {
  it("keeps cover teasers separate from actual interior story placement", () => {
    const state = emptyIssueStudioState();
    state.placements = [{ id: "story", articleId: "a", pageIds: [] }];
    const cover = { id: "cover", articleIds: ["a"], template: { kind: "cover" } };
    expect(mergePlannerRecipe(state, { savedPages: [cover] }).placements[0].pageIds).toEqual([]);
    expect(mergePlannerRecipe(state, { savedPages: [cover, { id: "interior", articleIds: ["a"], template: { kind: "story" } }] }).placements[0].pageIds).toEqual(["interior"]);
  });
  it("keeps local choices and locks while recording continuation order, and excludes live source from recipe", () => {
    const state = emptyIssueStudioState();
    state.pages = [{ id: "opening", pageNumber: 1, locked: true }];
    state.placements = [
      {
        id: "story",
        articleId: "a",
        pageIds: [],
        sourceRevision: "approved-source",
        locked: true,
        imageChoices: [{ attachmentId: "photo", caption: "Approved caption" }],
      },
    ];
    const result = mergePlannerRecipe(state, {
      savedPages: [
        { id: "opening", articleIds: ["a"], templateId: "interview" },
        { id: "continued", articleIds: ["a"] },
      ],
      issueBundle: {
        articles: [
          { id: "a", body: "Live source must not be saved as planner state" },
        ],
        layoutPlan: {
          articleFlows: { a: { pageIds: ["opening", "continued"] } },
        },
      },
      assetRefs: { "assets/user-ad.png": "issue-studio/issue/ad.png" },
    });
    expect(result.pages[0].locked).toBe(true);
    expect(result.placements[0]).toMatchObject({
      pageIds: ["opening", "continued"],
      sourceRevision: "approved-source",
      locked: true,
      imageChoices: [{ attachmentId: "photo", caption: "Approved caption" }],
    });
    expect((result.plannerState?.issueBundle as any).articles).toEqual([]);
    expect(result.plannerState?.assetRefs).toEqual({
      "assets/user-ad.png": "issue-studio/issue/ad.png",
    });
    expect(state.placements[0].pageIds).toEqual([]);
  });
  it("reconciles departed stories without deleting page geometry or active story copy", () => {
    const state = emptyIssueStudioState();
    state.plannerState = {
      articleIds: ["remaining", "departed"],
      savedPages: [
        {
          id: "page",
          articleIds: ["remaining", "departed"],
          template: { slots: [{ id: "body", rect: [36, 100, 720, 744] }] },
        },
      ],
      issueBundle: {
        layoutPlan: {
          cover: { articleIds: ["departed"] },
          articleFlows: {
            departed: { pageIds: ["page"] },
            remaining: { pageIds: ["page"] },
          },
        },
      },
    };
    const result = reconcileDepartedStories(state, ["remaining"]);
    expect(result.plannerState?.articleIds).toEqual(["remaining"]);
    expect((result.plannerState?.savedPages as any)[0]).toEqual({
      id: "page",
      articleIds: ["remaining"],
      template: { slots: [{ id: "body", rect: [36, 100, 720, 744] }] },
    });
    expect((result.plannerState?.issueBundle as any).layoutPlan).toEqual({
      cover: { articleIds: [] },
      articleFlows: { remaining: { pageIds: ["page"] } },
    });
    expect((state.plannerState?.savedPages as any)[0].articleIds).toEqual([
      "remaining",
      "departed",
    ]);
  });
});

describe("Issue Studio source bundle", () => {
  it("uses local print images and credits without altering web export preferences", async () => {
    const state = emptyIssueStudioState();
    state.placements = [
      {
        id: "p",
        articleId: "article",
        pageIds: [],
        included: true,
        imageChoices: [
          {
            attachmentId: "print",
            caption: "Print caption",
            credit: "Photographer",
          },
        ],
      },
    ];
    const attachments = [
      {
        id: "web",
        articleId: "article",
        attachmentType: "photo",
        originalFileName: "web.jpg",
        fileName: "web.jpg",
        filePath: "photos/web.jpg",
        includeInExport: true,
        caption: "Web caption",
        photoNumber: 1,
        fileSize: 3,
        mimeType: "image/jpeg",
        createdAt: new Date(),
      },
      {
        id: "print",
        articleId: "article",
        attachmentType: "photo",
        originalFileName: "print.jpg",
        fileName: "print.jpg",
        filePath: "photos/print.jpg",
        includeInExport: false,
        caption: "Original caption",
        photoNumber: 2,
        fileSize: 3,
        mimeType: "image/jpeg",
        createdAt: new Date(),
      },
    ];
    dependencies.query.mockImplementation(async (operation) =>
      operation === "getIssueStudio"
        ? {
            state,
            articles: [
              {
                id: "article",
                title: "Complete story",
                content: "One\n\nTwo",
                prefersAnonymity: true,
                author: null,
                attachments,
              },
            ],
          }
        : {
            issue: {
              id: "issue",
              issueNumber: 1,
              title: "Issue",
              releaseDate: null,
              volume: { volumeNumber: 1, year: 2026 },
            },
          },
    );
    dependencies.getFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    const response = await handleStudioBundle("issue");
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const manifest = JSON.parse(await zip.file("issue.json")!.async("string"));
    expect(manifest.articles[0]).toMatchObject({
      body: "One\n\nTwo",
      author: "Anonymous",
      photos: [
        { id: "print", caption: "Print caption — Credit: Photographer" },
      ],
    });
    expect(dependencies.getFile).toHaveBeenCalledWith("photos/print.jpg");
    expect(attachments.map((a) => a.includeInExport)).toEqual([true, false]);
  });
  it("allows a genuinely empty issue bundle for reservation-first planning", async () => {
    dependencies.query.mockImplementation(async (operation) =>
      operation === "getIssueStudio"
        ? { state: emptyIssueStudioState(), articles: [] }
        : {
            issue: {
              id: "empty",
              issueNumber: 2,
              title: "Empty",
              releaseDate: null,
              volume: { volumeNumber: 1, year: 2026 },
            },
          },
    );
    const response = await handleStudioBundle("empty");
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(
      JSON.parse(await zip.file("issue.json")!.async("string")).articles,
    ).toEqual([]);
  });
});
