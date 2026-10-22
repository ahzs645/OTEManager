import JSZip from "jszip";
import type { Attachments, Authors, Issues, Volumes } from "../shared/model";
import type { StorageProvider } from "../storage/types";

type ExportIssue = Pick<
  Issues,
  "id" | "issueNumber" | "releaseDate" | "title"
> & {
  volume: Pick<Volumes, "volumeNumber" | "year">;
};
type ExportArticle = {
  id: string;
  title: string;
  content: string | null;
  prefersAnonymity: boolean | null;
  author: Pick<Authors, "givenName" | "surname"> | null;
  attachments: Attachments[];
};

export class IncompleteDesignCraftExport extends Error {}
export class InvalidDesignCraftSelection extends Error {}

/** Resolve an explicit export selection only within the requested issue. */
export function selectDesignCraftArticles<T extends { id: string }>(
  articles: T[],
  articleIds: unknown,
): T[] {
  if (
    !Array.isArray(articleIds) ||
    articleIds.length === 0 ||
    articleIds.some((id) => typeof id !== "string" || !id) ||
    new Set(articleIds).size !== articleIds.length
  ) {
    throw new InvalidDesignCraftSelection(
      "Choose at least one distinct article to export.",
    );
  }
  const byId = new Map(articles.map((article) => [article.id, article]));
  if (articleIds.some((id) => !byId.has(id))) {
    throw new InvalidDesignCraftSelection(
      "Some selected articles no longer belong to this issue. Reload the export dialog and try again.",
    );
  }
  return articleIds.map((id) => byId.get(id)!);
}

function segment(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function mediaExtension(photo: Attachments) {
  const match = photo.originalFileName.match(/\.([a-zA-Z0-9]{1,10})$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function mediaMimeType(photo: Attachments) {
  const extension = mediaExtension(photo);
  return (
    photo.mimeType ||
    (
      {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".pdf": "application/pdf",
      } as Record<string, string>
    )[extension] ||
    "application/octet-stream"
  );
}

/** Build an issue bundle without rewriting the stored Markdown or leaking author records. */
export async function buildDesignCraftIssueZip(
  issue: ExportIssue,
  articles: ExportArticle[],
  storage: Pick<StorageProvider, "getFile">,
) {
  const missingText = articles.find((article) => !article.content?.trim());
  if (missingText) throw new IncompleteDesignCraftExport(`Full article text is missing for “${missingText.title}”. Add the recovered text before exporting an article layout, or recreate the original issue from the source pages in Utilities → DesignCraft.`);
  const zip = new JSZip();
  const manifest = {
    schemaVersion: "ote.designcraft.issue.v1",
    issue: {
      id: issue.id,
      volume: issue.volume.volumeNumber,
      number: issue.issueNumber,
      date: issue.releaseDate
        ? issue.releaseDate.toISOString().slice(0, 10)
        : null,
      year: issue.releaseDate?.getUTCFullYear() ?? issue.volume.year,
      title: issue.title || "",
    },
    articles: [] as Array<{
      id: string;
      title: string;
      body: string;
      author: string;
      photos: Array<{
        id: string;
        path: string;
        caption: string;
        photoNumber: number | null;
        mimeType: string;
        attachmentType: string;
      }>;
    }>,
    layoutPlan: {
      pages: [],
      cover: { mode: "preserve" },
      truck: { mode: "preserve", pageIds: [] },
    },
    templateLibrary: "/designcraft/templates.json",
  };

  // IDs determine paths, so duplicate titles and original filenames cannot overwrite files.
  for (const article of articles) {
    const exported = {
      id: article.id,
      title: article.title,
      body: article.content ?? "",
      author: article.prefersAnonymity
        ? "Anonymous"
        : [article.author?.givenName, article.author?.surname]
            .filter(Boolean)
            .join(" ") || "Unknown Author",
      photos: [] as (typeof manifest.articles)[number]["photos"],
    };
    zip.file(`articles/${segment(article.id)}/article.md`, exported.body);
    const media = article.attachments
      .filter(
        (attachment) =>
          attachment.attachmentType === "photo" ||
          attachment.attachmentType === "graphic",
      )
      .filter((attachment) => attachment.includeInExport !== false)
      .sort(
        (a, b) =>
          (a.photoNumber ?? Number.MAX_SAFE_INTEGER) -
            (b.photoNumber ?? Number.MAX_SAFE_INTEGER) ||
          a.id.localeCompare(b.id),
      );
    for (const photo of media) {
      const buffer = await storage.getFile(photo.filePath);
      if (
        !buffer ||
        buffer.length === 0 ||
        (photo.fileSize !== null && buffer.length !== photo.fileSize)
      ) {
        throw new IncompleteDesignCraftExport(
          `The issue cannot be exported because media ${photo.id} for “${article.title}” is missing or incomplete. Restore the file and try again.`,
        );
      }
      const path = `media/${segment(article.id)}/${segment(photo.id)}${mediaExtension(photo)}`;
      zip.file(path, buffer);
      exported.photos.push({
        id: photo.id,
        path,
        caption: photo.caption ?? "",
        photoNumber: photo.photoNumber,
        mimeType: mediaMimeType(photo),
        attachmentType: photo.attachmentType,
      });
    }
    manifest.articles.push(exported);
  }
  zip.file("issue.json", JSON.stringify(manifest, null, 2));
  zip.file(
    "README.txt",
    [
      "OTEManager → DesignCraft issue bundle",
      "",
      "Open Utilities → DesignCraft layouts and import this ZIP to load the selected articles and original image bytes together.",
      "Choose page layouts and article assignments, set cover fields and featured articles, then download a page or whole-issue recipe.",
      "Article Markdown is preserved exactly. Only display author names are included; anonymous articles say Anonymous.",
      "Cover and double truck preservation are requested in the plan. No existing layout or spread is embedded in this content export.",
      "This is a content bundle, not a native DesignCraft document. To open the layout in the DesignCraft program, compile the saved recipe using the template kit's compile-template.py or compile-issue.py and official CLI.",
      "The compiler produces editable .designcraft, PDF and IDML when preflight passes; full copy is retained if fitting fails. See native-readme.md in the template kit.",
    ].join("\n"),
  );
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
