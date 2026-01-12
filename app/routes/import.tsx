import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Upload, FileText, AlertCircle, CheckCircle, Loader } from "lucide-react";
import { createServerFn } from "@tanstack/start";

// Server function to import data
const importSharePointData = createServerFn({ method: "POST" })
  .validator((data: { articles: any[] }) => data)
  .handler(async ({ data }) => {
    const { db, authors, articles, attachments, articleMultimediaTypes } =
      await import("@db/index");
    const { eq } = await import("drizzle-orm");

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const item of data.articles) {
      try {
        // Find or create author
        let author = await db.query.authors.findFirst({
          where: eq(authors.email, item.ContactEmail),
        });

        if (!author) {
          const [newAuthor] = await db
            .insert(authors)
            .values({
              givenName: item.GivenName || "Unknown",
              surname: item.Surname || "Unknown",
              email: item.ContactEmail,
              role: item.role?.Value || "Guest Contributor",
              autoDepositAvailable: item.Auto_x002d_depositAvailability || false,
              etransferEmail: item.EtransferEmail,
            })
            .returning();
          author = newAuthor;
        }

        // Create article
        const [article] = await db
          .insert(articles)
          .values({
            title: item.Title,
            authorId: author.id,
            articleTier: item.ArticleTier?.Value || "Tier 1 (Basic)",
            internalStatus: mapStatus(item.InternalStaus?.Value),
            automationStatus: item.AutomationStatus?.Value || "Completed",
            prefersAnonymity: item.PrefersAnonymity || false,
            paymentStatus: item.PaymentStatus || false,
            articleFilePath: item.ArticleFileName,
            submittedAt: item.Created ? new Date(item.Created) : new Date(),
          })
          .returning();

        // Add multimedia types if present
        if (item.MultimediaType_x0028_s_x0029_?.results) {
          for (const type of item.MultimediaType_x0028_s_x0029_.results) {
            await db.insert(articleMultimediaTypes).values({
              articleId: article.id,
              multimediaType: type.Value,
            });
          }
        }

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Failed to import "${item.Title}": ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }

    return results;
  });

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

export const Route = createFileRoute("/import")({
  component: ImportPage,
});

function ImportPage() {
  const [jsonData, setJsonData] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const handleImport = async () => {
    if (!jsonData.trim()) return;

    try {
      const parsed = JSON.parse(jsonData);
      const articles = Array.isArray(parsed) ? parsed : parsed.value || [parsed];

      setIsImporting(true);
      setResults(null);

      const result = await importSharePointData({ data: { articles } });
      setResults(result);
    } catch (error) {
      setResults({
        success: 0,
        failed: 1,
        errors: [
          `JSON parse error: ${error instanceof Error ? error.message : "Invalid JSON"}`,
        ],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setJsonData(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <>
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">
          Import from SharePoint
        </h2>
        <p className="text-sm text-gray-500">
          Migrate your existing article data from SharePoint
        </p>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="font-medium text-blue-900 mb-2">How to export from SharePoint</h3>
        <ol className="list-decimal list-inside text-sm text-blue-800 space-y-1">
          <li>Go to your SharePoint list containing articles</li>
          <li>Click the gear icon → List settings → Export to Excel (or use Power Automate)</li>
          <li>Or use the SharePoint REST API to get JSON data</li>
          <li>Paste the JSON data below or upload a JSON file</li>
        </ol>
      </div>

      {/* Import Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload JSON file
          </label>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Or paste JSON data
          </label>
          <textarea
            value={jsonData}
            onChange={(e) => setJsonData(e.target.value)}
            placeholder={`[
  {
    "Title": "Article Title",
    "GivenName": "John",
    "Surname": "Doe",
    "ContactEmail": "john@example.com",
    "ArticleTier": { "Value": "Tier 2 (Standard)" },
    "InternalStaus": { "Value": "Pending Review" },
    ...
  }
]`}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 font-mono text-sm"
          />
        </div>

        <button
          onClick={handleImport}
          disabled={isImporting || !jsonData.trim()}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <>
              <Loader className="w-4 h-4 mr-2 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Import Data
            </>
          )}
        </button>

        {/* Results */}
        {results && (
          <div className="mt-6 p-4 rounded-lg border">
            <div className="flex items-center gap-4 mb-4">
              {results.success > 0 && (
                <div className="flex items-center text-green-600">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  {results.success} imported successfully
                </div>
              )}
              {results.failed > 0 && (
                <div className="flex items-center text-red-600">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  {results.failed} failed
                </div>
              )}
            </div>

            {results.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <h4 className="font-medium text-red-800 mb-2">Errors:</h4>
                <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                  {results.errors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expected Format */}
      <div className="mt-6 bg-white rounded-lg shadow p-6">
        <h3 className="font-medium text-gray-900 mb-3">Expected JSON Format</h3>
        <p className="text-sm text-gray-500 mb-3">
          Based on your SharePoint list structure, the import expects these fields:
        </p>
        <pre className="bg-gray-50 p-4 rounded text-xs overflow-x-auto">
{`{
  "Title": "Article Title",
  "GivenName": "First Name",
  "Surname": "Last Name",
  "ContactEmail": "email@example.com",
  "role": { "Value": "Staff Writer" },
  "ArticleTier": { "Value": "Tier 2 (Standard)" },
  "InternalStaus": { "Value": "Pending Review" },
  "AutomationStatus": { "Value": "Completed" },
  "PrefersAnonymity": false,
  "PaymentStatus": false,
  "Auto_x002d_depositAvailability": true,
  "EtransferEmail": "payment@example.com",
  "ArticleFileName": "path/to/article",
  "MultimediaType_x0028_s_x0029_": {
    "results": [{ "Value": "Photo" }, { "Value": "Graphic" }]
  },
  "Created": "2024-01-15T12:00:00Z"
}`}
        </pre>
      </div>
    </>
  );
}
