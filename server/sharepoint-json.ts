// Server-only helpers shared by the import utilities.
import * as records from "./records";

export async function importSharePointJson(data: { articles: any[] }) {
  const results = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (const item of data.articles) {
    try {
      // Support both old format (ContactEmail) and new format (Contact_x0020_Email)
      const email = (item.ContactEmail || item.Contact_x0020_Email || "")
        .trim()
        .toLowerCase();
      if (!email) throw new Error("An author email is required");
      const givenName = item.GivenName || item.Given_x0020_Name || "Unknown";
      const surname = item.Surname || "Unknown";
      const etransferEmail =
        item.EtransferEmail || item["e_x002d_Transfer_x0020_Email"];
      const autoDeposit =
        item.Auto_x002d_depositAvailability || item.Autodeposit || false;

      // Handle role - could be an object with Value or a direct string
      const roleValue =
        typeof item.role === "object" ? item.role?.Value : item.role;
      const studentType = mapRoleToStudentType(roleValue);

      // Check for existing article by SharePoint ID
      const sharePointId = item.Id ? `sp-${item.Id}` : null;
      if (sharePointId) {
        const existingArticle = await records
          .list("articles")
          .then((rows) =>
            rows.find((row) =>
              (row.formResponseId || "").split(",").includes(sharePointId),
            ),
          );
        if (existingArticle) {
          results.skipped++;
          continue;
        }
      }

      // Find or create author
      let author = await records
        .list("authors")
        .then((rows) =>
          rows.find((row) => row.email.trim().toLowerCase() === email),
        );

      if (!author) {
        const [newAuthor] = await records
          .insert("authors", {
            givenName,
            surname,
            email,
            role: "Guest Contributor",
            authorType: "Student",
            studentType: studentType as any,
            autoDepositAvailable: autoDeposit,
            etransferEmail,
          })
          .then((row) => [row]);
        author = newAuthor;
      } else if (studentType && !author.studentType) {
        // Update existing author's studentType if not already set
        await records.patch("authors", author.id, {
          studentType: studentType as any,
          updatedAt: new Date(),
        });
      }

      // Create article
      const [article] = await records
        .insert("articles", {
          title: item.Title,
          authorId: author.id,
          articleTier:
            item.ArticleTier?.Value ||
            item.Article_x0020_Tier ||
            "Tier 1 (Basic)",
          internalStatus: mapStatus(
            item.InternalStaus?.Value || item.Internal_x0020_Status,
          ),
          automationStatus: item.AutomationStatus?.Value || "Completed",
          prefersAnonymity:
            item.PrefersAnonymity || item.Prefers_x0020_Anonymity || false,
          paymentStatus:
            item.PaymentStatus || item.Payment_x0020_Status || false,
          articleFilePath: item.ArticleFileName,
          submittedAt: item.Created ? new Date(item.Created) : new Date(),
          formResponseId: sharePointId,
        })
        .then((row) => [row]);

      // Add multimedia types if present
      if (item.MultimediaType_x0028_s_x0029_?.results) {
        for (const type of item.MultimediaType_x0028_s_x0029_.results) {
          await records.insert("articleMultimediaTypes", {
            articleId: article.id,
            multimediaType: type.Value,
          });
        }
      }

      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Failed to import "${item.Title}": ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return results;
}

export async function updateStudentTypes(data: { articles: any[] }) {
  const results = {
    updated: 0,
    skipped: 0,
    notFound: 0,
    errors: [] as string[],
    details: [] as string[],
  };

  // Build a map of email -> role from the import data
  const emailToRole = new Map<string, string>();

  for (const item of data.articles) {
    const email = (item.Contact_x0020_Email || item.ContactEmail || "")
      .trim()
      .toLowerCase();
    const role = typeof item.role === "object" ? item.role?.Value : item.role;

    if (email && role) {
      emailToRole.set(email.toLowerCase(), role);
    }
  }

  // Update each author
  for (const [email, role] of emailToRole) {
    try {
      const author = await records
        .list("authors")
        .then((rows) =>
          rows.find((row) => row.email.trim().toLowerCase() === email),
        );

      if (!author) {
        results.notFound++;
        continue;
      }

      // Only update if author is a Student type
      if (author.authorType !== "Student") {
        results.skipped++;
        results.details.push(
          `Skipped ${email} - not a Student type (${author.authorType})`,
        );
        continue;
      }

      const studentType = mapRoleToStudentType(role);

      if (!studentType) {
        results.skipped++;
        results.details.push(`Skipped ${email} - unknown role "${role}"`);
        continue;
      }

      // Skip if already set to the same value
      if (author.studentType === studentType) {
        results.skipped++;
        continue;
      }

      await records.patch("authors", author.id, {
        studentType: studentType as any,
        updatedAt: new Date(),
      });

      results.updated++;
      results.details.push(
        `Updated ${email}: ${author.studentType || "none"} -> ${studentType}`,
      );
    } catch (error) {
      results.errors.push(
        `Failed to update ${email}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return results;
}

function mapStatus(status: string | undefined): any {
  const statusMap: Record<string, string> = {
    Draft: "Draft",
    "Not Started": "Pending Review",
    "Pending Review": "Pending Review",
    "In Progress": "In Review",
    "In Review": "In Review",
    "Needs Revision": "Needs Revision",
    Approved: "Approved",
    "In Editing": "In Editing",
    "Ready for Publication": "Ready for Publication",
    Published: "Published",
    Archived: "Archived",
  };
  return statusMap[status || ""] || "Pending Review";
}

// Map role values to studentType (for Student authors)
function mapRoleToStudentType(role: string | undefined): string | null {
  if (!role) return null;

  const roleMap: Record<string, string> = {
    Undergrad: "Undergrad",
    Grad: "Grad",
    Graduate: "Grad",
    Alumni: "Alumni",
    Other: "Other",
  };

  return roleMap[role] || null;
}
