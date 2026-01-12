import { createAPIFileRoute } from "@tanstack/start/api";
import archiver from "archiver";
import { PassThrough } from "stream";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";

// Convert markdown content to docx document
async function markdownToDocx(
  content: string,
  title: string,
  authorName: string
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  // Add title
  paragraphs.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
    })
  );

  // Add author
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `By ${authorName}`,
          italics: true,
          size: 24, // 12pt
        }),
      ],
      spacing: { after: 400 },
    })
  );

  // Add separator
  paragraphs.push(
    new Paragraph({
      text: "",
      spacing: { after: 200 },
    })
  );

  // Parse markdown content into paragraphs
  if (content) {
    const lines = content.split("\n");
    let currentParagraph: TextRun[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Handle headings
      if (trimmedLine.startsWith("### ")) {
        // Flush current paragraph
        if (currentParagraph.length > 0) {
          paragraphs.push(new Paragraph({ children: currentParagraph }));
          currentParagraph = [];
        }
        paragraphs.push(
          new Paragraph({
            text: trimmedLine.substring(4),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          })
        );
      } else if (trimmedLine.startsWith("## ")) {
        if (currentParagraph.length > 0) {
          paragraphs.push(new Paragraph({ children: currentParagraph }));
          currentParagraph = [];
        }
        paragraphs.push(
          new Paragraph({
            text: trimmedLine.substring(3),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
          })
        );
      } else if (trimmedLine.startsWith("# ")) {
        if (currentParagraph.length > 0) {
          paragraphs.push(new Paragraph({ children: currentParagraph }));
          currentParagraph = [];
        }
        paragraphs.push(
          new Paragraph({
            text: trimmedLine.substring(2),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          })
        );
      } else if (trimmedLine === "") {
        // Empty line - create new paragraph
        if (currentParagraph.length > 0) {
          paragraphs.push(
            new Paragraph({
              children: currentParagraph,
              spacing: { after: 200 },
            })
          );
          currentParagraph = [];
        }
      } else {
        // Regular text - handle basic markdown formatting
        let text = trimmedLine;

        // Handle bold (**text** or __text__)
        text = text.replace(/\*\*(.*?)\*\*/g, "$1");
        text = text.replace(/__(.*?)__/g, "$1");

        // Handle italic (*text* or _text_)
        text = text.replace(/\*(.*?)\*/g, "$1");
        text = text.replace(/_(.*?)_/g, "$1");

        // Handle links [text](url) -> just keep text
        text = text.replace(/\[(.*?)\]\(.*?\)/g, "$1");

        if (currentParagraph.length > 0) {
          // Add space before continuing text
          currentParagraph.push(new TextRun({ text: " " }));
        }
        currentParagraph.push(new TextRun({ text, size: 24 })); // 12pt
      }
    }

    // Flush remaining paragraph
    if (currentParagraph.length > 0) {
      paragraphs.push(
        new Paragraph({
          children: currentParagraph,
          spacing: { after: 200 },
        })
      );
    }
  } else {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "(No content available)",
            italics: true,
            color: "888888",
          }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export const APIRoute = createAPIFileRoute("/api/export-issue/$issueId")({
  GET: async ({ params }) => {
    const { issueId } = params;

    if (!issueId) {
      return new Response(JSON.stringify({ error: "Issue ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { db, issues, articles, attachments } = await import("@db/index");
      const { eq } = await import("drizzle-orm");
      const { getStorage } = await import("../../../storage");

      // Get the issue with its volume
      const issue = await db.query.issues.findFirst({
        where: eq(issues.id, issueId),
        with: {
          volume: true,
        },
      });

      if (!issue) {
        return new Response(JSON.stringify({ error: "Issue not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get all articles for this issue with their attachments and authors
      const issueArticles = await db.query.articles.findMany({
        where: eq(articles.issueId, issueId),
        with: {
          author: true,
          attachments: true,
        },
      });

      if (issueArticles.length === 0) {
        return new Response(
          JSON.stringify({ error: "No articles found for this issue" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const storage = getStorage();

      // Create archive
      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      // Create a PassThrough stream to collect the archive data
      const passthrough = new PassThrough();
      const chunks: Buffer[] = [];

      passthrough.on("data", (chunk) => chunks.push(chunk));

      // Pipe archive to passthrough
      archive.pipe(passthrough);

      // Base path for the export
      const volumeFolder = `Volume ${issue.volume.volumeNumber}`;
      const issueFolder = `Issue ${issue.issueNumber}${issue.title ? ` - ${issue.title}` : ""}`;
      const basePath = `${volumeFolder}/${issueFolder}`;

      // Process each article
      for (const article of issueArticles) {
        // Sanitize article title for folder name
        const articleFolder = article.title
          .replace(/[<>:"/\\|?*]/g, "-")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 100);

        const articlePath = `${basePath}/${articleFolder}`;

        // Determine author name based on anonymity preference
        const authorName = article.prefersAnonymity
          ? "Anonymous"
          : article.author
            ? `${article.author.givenName} ${article.author.surname}`
            : "Unknown Author";

        // Get word documents and photos
        const wordDocs = article.attachments.filter(
          (a) => a.attachmentType === "word_document"
        );
        const photos = article.attachments.filter(
          (a) => a.attachmentType === "photo"
        );

        // Add original word documents to the article folder
        for (const doc of wordDocs) {
          const fileBuffer = await storage.getFile(doc.filePath);
          if (fileBuffer) {
            archive.append(fileBuffer, {
              name: `${articlePath}/${doc.originalFileName}`,
            });
          }
        }

        // Create the final article docx from markdown content
        if (article.content) {
          const docxBuffer = await markdownToDocx(
            article.content,
            article.title,
            authorName
          );
          archive.append(docxBuffer, {
            name: `${articlePath}/${articleFolder} - Final.docx`,
          });
        }

        // Process photos
        let photoCount = 1;
        for (const photo of photos) {
          const photoFolder = `${articlePath}/Photos/Photo ${photo.photoNumber || photoCount}`;

          // Get photo file
          const photoBuffer = await storage.getFile(photo.filePath);
          if (photoBuffer) {
            archive.append(photoBuffer, {
              name: `${photoFolder}/${photo.originalFileName}`,
            });
          }

          // Create caption file - respecting article's anonymity preference
          const captionContent = `Author: ${authorName}
Caption: ${photo.caption || "(No caption provided)"}`;

          archive.append(captionContent, {
            name: `${photoFolder}/Caption.txt`,
          });

          photoCount++;
        }
      }

      // Create a summary file for the issue
      const summaryContent = `Issue Export Summary
====================

Volume: ${issue.volume.volumeNumber}${issue.volume.year ? ` (${issue.volume.year})` : ""}
Issue: ${issue.issueNumber}${issue.title ? ` - ${issue.title}` : ""}
Export Date: ${new Date().toISOString()}

Articles Included: ${issueArticles.length}

${issueArticles
  .map(
    (a, i) => `${i + 1}. ${a.title}
   Author: ${a.prefersAnonymity ? "Anonymous" : a.author ? `${a.author.givenName} ${a.author.surname}` : "Unknown"}
   Photos: ${a.attachments.filter((att) => att.attachmentType === "photo").length}
   Documents: ${a.attachments.filter((att) => att.attachmentType === "word_document").length}
`
  )
  .join("\n")}
`;

      archive.append(summaryContent, {
        name: `${basePath}/_Issue_Summary.txt`,
      });

      // Finalize the archive
      await archive.finalize();

      // Wait for all chunks to be collected
      await new Promise<void>((resolve, reject) => {
        passthrough.on("end", resolve);
        passthrough.on("error", reject);
      });

      // Combine chunks into a single buffer
      const zipBuffer = Buffer.concat(chunks);

      // Generate filename
      const filename = `Volume_${issue.volume.volumeNumber}_Issue_${issue.issueNumber}_Export.zip`;

      return new Response(zipBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": zipBuffer.length.toString(),
        },
      });
    } catch (error) {
      console.error("Export error:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to generate export",
          details: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
});
