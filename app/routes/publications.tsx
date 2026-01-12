import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getVolumes } from "../lib/queries";
import {
  createVolume,
  updateVolume,
  deleteVolume,
  createIssue,
  updateIssue,
  deleteIssue,
  migrateLegacyVolumeIssues,
} from "../lib/mutations";
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2, FileText, Calendar, Download } from "lucide-react";

export const Route = createFileRoute("/publications")({
  loader: async () => {
    const { volumes } = await getVolumes();
    return { volumes };
  },
  component: PublicationsPage,
});

type Volume = {
  id: string;
  volumeNumber: number;
  year: number | null;
  startDate: Date | null;
  endDate: Date | null;
  description: string | null;
  issues: Issue[];
};

type Issue = {
  id: string;
  volumeId: string;
  issueNumber: number;
  title: string | null;
  releaseDate: Date | null;
  description: string | null;
  articleCount: number;
};

function PublicationsPage() {
  const { volumes } = Route.useLoaderData();
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(
    new Set(volumes.map((v: Volume) => v.id))
  );
  const [editingVolume, setEditingVolume] = useState<string | null>(null);
  const [editingIssue, setEditingIssue] = useState<string | null>(null);
  const [showNewVolumeForm, setShowNewVolumeForm] = useState(false);
  const [newIssueForVolume, setNewIssueForVolume] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [exportingIssue, setExportingIssue] = useState<string | null>(null);

  const [volumeForm, setVolumeForm] = useState({
    volumeNumber: "",
    year: "",
    startDate: "",
    endDate: "",
    description: "",
  });

  const [issueForm, setIssueForm] = useState({
    issueNumber: "",
    title: "",
    releaseDate: "",
    description: "",
  });

  const toggleVolume = (volumeId: string) => {
    const newExpanded = new Set(expandedVolumes);
    if (newExpanded.has(volumeId)) {
      newExpanded.delete(volumeId);
    } else {
      newExpanded.add(volumeId);
    }
    setExpandedVolumes(newExpanded);
  };

  const handleCreateVolume = async () => {
    if (!volumeForm.volumeNumber) return;
    setIsLoading(true);
    try {
      await createVolume({
        data: {
          volumeNumber: parseInt(volumeForm.volumeNumber),
          year: volumeForm.year ? parseInt(volumeForm.year) : undefined,
          startDate: volumeForm.startDate || undefined,
          endDate: volumeForm.endDate || undefined,
          description: volumeForm.description || undefined,
        },
      });
      setShowNewVolumeForm(false);
      setVolumeForm({ volumeNumber: "", year: "", startDate: "", endDate: "", description: "" });
      window.location.reload();
    } catch (error) {
      console.error("Failed to create volume:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateVolume = async (volumeId: string) => {
    setIsLoading(true);
    try {
      await updateVolume({
        data: {
          id: volumeId,
          volumeNumber: parseInt(volumeForm.volumeNumber),
          year: volumeForm.year ? parseInt(volumeForm.year) : undefined,
          startDate: volumeForm.startDate || undefined,
          endDate: volumeForm.endDate || undefined,
          description: volumeForm.description || undefined,
        },
      });
      setEditingVolume(null);
      window.location.reload();
    } catch (error) {
      console.error("Failed to update volume:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteVolume = async (volumeId: string) => {
    if (!confirm("Are you sure you want to delete this volume and all its issues?")) return;
    setIsLoading(true);
    try {
      await deleteVolume({ data: { id: volumeId } });
      window.location.reload();
    } catch (error) {
      console.error("Failed to delete volume:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateIssue = async (volumeId: string) => {
    if (!issueForm.issueNumber) return;
    setIsLoading(true);
    try {
      await createIssue({
        data: {
          volumeId,
          issueNumber: parseInt(issueForm.issueNumber),
          title: issueForm.title || undefined,
          releaseDate: issueForm.releaseDate || undefined,
          description: issueForm.description || undefined,
        },
      });
      setNewIssueForVolume(null);
      setIssueForm({ issueNumber: "", title: "", releaseDate: "", description: "" });
      window.location.reload();
    } catch (error) {
      console.error("Failed to create issue:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateIssue = async (issueId: string) => {
    setIsLoading(true);
    try {
      await updateIssue({
        data: {
          id: issueId,
          issueNumber: parseInt(issueForm.issueNumber),
          title: issueForm.title || undefined,
          releaseDate: issueForm.releaseDate || undefined,
          description: issueForm.description || undefined,
        },
      });
      setEditingIssue(null);
      window.location.reload();
    } catch (error) {
      console.error("Failed to update issue:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteIssue = async (issueId: string) => {
    if (!confirm("Are you sure you want to delete this issue?")) return;
    setIsLoading(true);
    try {
      await deleteIssue({ data: { id: issueId } });
      window.location.reload();
    } catch (error) {
      console.error("Failed to delete issue:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const startEditVolume = (volume: Volume) => {
    setEditingVolume(volume.id);
    setVolumeForm({
      volumeNumber: volume.volumeNumber.toString(),
      year: volume.year?.toString() || "",
      startDate: volume.startDate ? new Date(volume.startDate).toISOString().split("T")[0] : "",
      endDate: volume.endDate ? new Date(volume.endDate).toISOString().split("T")[0] : "",
      description: volume.description || "",
    });
  };

  const startEditIssue = (issue: Issue) => {
    setEditingIssue(issue.id);
    setIssueForm({
      issueNumber: issue.issueNumber.toString(),
      title: issue.title || "",
      releaseDate: issue.releaseDate ? new Date(issue.releaseDate).toISOString().split("T")[0] : "",
      description: issue.description || "",
    });
  };

  // Calculate total articles per volume
  const getVolumeArticleCount = (volume: Volume) => {
    return volume.issues.reduce((sum, issue) => sum + (issue.articleCount || 0), 0);
  };

  // Export issue as ZIP
  const handleExportIssue = async (issueId: string, volumeNumber: number, issueNumber: number) => {
    setExportingIssue(issueId);
    try {
      const response = await fetch(`/api/exportIssue/${issueId}`);
      if (!response.ok) {
        const errorData = await response.json();
        alert(`Export failed: ${errorData.error || "Unknown error"}`);
        return;
      }

      // Get the blob and download it
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Volume_${volumeNumber}_Issue_${issueNumber}_Export.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export issue. Please try again.");
    } finally {
      setExportingIssue(null);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              color: "var(--fg-default)",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Publications
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--fg-muted)", margin: "0.25rem 0 0 0" }}>
            Manage volumes and issues
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowNewVolumeForm(true);
            setVolumeForm({ volumeNumber: "", year: "", startDate: "", endDate: "", description: "" });
          }}
        >
          <Plus className="w-4 h-4" />
          New Volume
        </button>
      </div>

      {/* New Volume Form */}
      {showNewVolumeForm && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "1rem" }}>
            Create New Volume
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                Volume Number *
              </label>
              <input
                type="number"
                className="input"
                value={volumeForm.volumeNumber}
                onChange={(e) => setVolumeForm({ ...volumeForm, volumeNumber: e.target.value })}
                placeholder="31"
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                Year
              </label>
              <input
                type="number"
                className="input"
                value={volumeForm.year}
                onChange={(e) => setVolumeForm({ ...volumeForm, year: e.target.value })}
                placeholder="2025"
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                Start Date
              </label>
              <input
                type="date"
                className="input"
                value={volumeForm.startDate}
                onChange={(e) => setVolumeForm({ ...volumeForm, startDate: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                End Date
              </label>
              <input
                type="date"
                className="input"
                value={volumeForm.endDate}
                onChange={(e) => setVolumeForm({ ...volumeForm, endDate: e.target.value })}
              />
            </div>
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
              Description
            </label>
            <input
              type="text"
              className="input"
              style={{ width: "100%" }}
              value={volumeForm.description}
              onChange={(e) => setVolumeForm({ ...volumeForm, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button
              className="btn btn-primary"
              onClick={handleCreateVolume}
              disabled={isLoading || !volumeForm.volumeNumber}
            >
              {isLoading ? "Creating..." : "Create Volume"}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowNewVolumeForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Volumes List */}
      {volumes.length === 0 ? (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "8px",
            padding: "3rem",
            textAlign: "center",
          }}
        >
          <p style={{ color: "var(--fg-muted)", marginBottom: "1rem" }}>
            No volumes yet. Create your first volume or import from existing article data.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => setShowNewVolumeForm(true)}>
              <Plus className="w-4 h-4" />
              Create Volume
            </button>
            <MigrateLegacyButton />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {volumes.map((volume: Volume) => (
            <div
              key={volume.id}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              {/* Volume Header */}
              {editingVolume === volume.id ? (
                <div style={{ padding: "1rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                        Volume Number
                      </label>
                      <input
                        type="number"
                        className="input"
                        value={volumeForm.volumeNumber}
                        onChange={(e) => setVolumeForm({ ...volumeForm, volumeNumber: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                        Year
                      </label>
                      <input
                        type="number"
                        className="input"
                        value={volumeForm.year}
                        onChange={(e) => setVolumeForm({ ...volumeForm, year: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                        Start Date
                      </label>
                      <input
                        type="date"
                        className="input"
                        value={volumeForm.startDate}
                        onChange={(e) => setVolumeForm({ ...volumeForm, startDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                        End Date
                      </label>
                      <input
                        type="date"
                        className="input"
                        value={volumeForm.endDate}
                        onChange={(e) => setVolumeForm({ ...volumeForm, endDate: e.target.value })}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleUpdateVolume(volume.id)}
                      disabled={isLoading}
                    >
                      Save
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingVolume(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0.75rem 1rem",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                  onClick={() => toggleVolume(volume.id)}
                >
                  <div style={{ marginRight: "0.5rem", color: "var(--fg-muted)" }}>
                    {expandedVolumes.has(volume.id) ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, color: "var(--fg-default)" }}>
                      Volume {volume.volumeNumber}
                    </span>
                    {volume.year && (
                      <span style={{ color: "var(--fg-muted)", marginLeft: "0.5rem" }}>
                        ({volume.year})
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: "0.75rem", color: "var(--fg-muted)" }}>
                      {volume.issues.length} issue{volume.issues.length !== 1 ? "s" : ""}
                    </span>
                    <Link
                      to="/articles"
                      search={{ volumeId: volume.id }}
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--accent)",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        textDecoration: "none",
                      }}
                    >
                      <FileText className="w-3 h-3" />
                      {getVolumeArticleCount(volume)} article{getVolumeArticleCount(volume) !== 1 ? "s" : ""}
                    </Link>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEditVolume(volume)}
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDeleteVolume(volume.id)}
                        title="Delete"
                        style={{ color: "var(--status-error)" }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Issues List */}
              {expandedVolumes.has(volume.id) && editingVolume !== volume.id && (
                <div
                  style={{
                    borderTop: "1px solid var(--border-default)",
                    background: "var(--bg-subtle)",
                  }}
                >
                  {volume.issues.length === 0 ? (
                    <div style={{ padding: "1rem", paddingLeft: "2.5rem" }}>
                      <p style={{ fontSize: "0.875rem", color: "var(--fg-muted)" }}>
                        No issues in this volume yet.
                      </p>
                    </div>
                  ) : (
                    <div>
                      {volume.issues.map((issue: Issue) => (
                        <div
                          key={issue.id}
                          style={{
                            borderBottom: "1px solid var(--border-subtle)",
                          }}
                        >
                          {editingIssue === issue.id ? (
                            <div style={{ padding: "0.75rem 1rem", paddingLeft: "2.5rem" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
                                <div>
                                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                                    Issue Number
                                  </label>
                                  <input
                                    type="number"
                                    className="input"
                                    value={issueForm.issueNumber}
                                    onChange={(e) => setIssueForm({ ...issueForm, issueNumber: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                                    Title
                                  </label>
                                  <input
                                    type="text"
                                    className="input"
                                    value={issueForm.title}
                                    onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })}
                                    placeholder="Fall Edition"
                                  />
                                </div>
                                <div>
                                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                                    Release Date
                                  </label>
                                  <input
                                    type="date"
                                    className="input"
                                    value={issueForm.releaseDate}
                                    onChange={(e) => setIssueForm({ ...issueForm, releaseDate: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                                    Description
                                  </label>
                                  <input
                                    type="text"
                                    className="input"
                                    value={issueForm.description}
                                    onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })}
                                  />
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleUpdateIssue(issue.id)}
                                  disabled={isLoading}
                                >
                                  Save
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => setEditingIssue(null)}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                padding: "0.625rem 1rem",
                                paddingLeft: "2.5rem",
                              }}
                            >
                              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                <span style={{ fontWeight: 500, color: "var(--fg-default)" }}>
                                  Issue {issue.issueNumber}
                                </span>
                                {issue.title && (
                                  <span style={{ color: "var(--fg-muted)" }}>
                                    {issue.title}
                                  </span>
                                )}
                                {issue.releaseDate && (
                                  <span style={{ fontSize: "0.75rem", color: "var(--fg-faint)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                    <Calendar className="w-3 h-3" />
                                    {new Date(issue.releaseDate).toLocaleDateString("en-US", {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                <Link
                                  to="/articles"
                                  search={{ issueId: issue.id }}
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "var(--accent)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.25rem",
                                    textDecoration: "none",
                                  }}
                                >
                                  <FileText className="w-3 h-3" />
                                  {issue.articleCount} article{issue.articleCount !== 1 ? "s" : ""}
                                </Link>
                                <div style={{ display: "flex", gap: "0.25rem" }}>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleExportIssue(issue.id, volume.volumeNumber, issue.issueNumber)}
                                    disabled={exportingIssue === issue.id || issue.articleCount === 0}
                                    title={issue.articleCount === 0 ? "No articles to export" : "Export issue as ZIP"}
                                    style={{ color: issue.articleCount === 0 ? "var(--fg-faint)" : "var(--accent)" }}
                                  >
                                    {exportingIssue === issue.id ? (
                                      <span style={{ fontSize: "0.625rem" }}>...</span>
                                    ) : (
                                      <Download className="w-3 h-3" />
                                    )}
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => startEditIssue(issue)}
                                    title="Edit"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleDeleteIssue(issue.id)}
                                    title="Delete"
                                    style={{ color: "var(--status-error)" }}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* New Issue Form */}
                  {newIssueForVolume === volume.id ? (
                    <div style={{ padding: "0.75rem 1rem", paddingLeft: "2.5rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                            Issue Number *
                          </label>
                          <input
                            type="number"
                            className="input"
                            value={issueForm.issueNumber}
                            onChange={(e) => setIssueForm({ ...issueForm, issueNumber: e.target.value })}
                            placeholder="1"
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                            Title
                          </label>
                          <input
                            type="text"
                            className="input"
                            value={issueForm.title}
                            onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })}
                            placeholder="Fall Edition"
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                            Release Date
                          </label>
                          <input
                            type="date"
                            className="input"
                            value={issueForm.releaseDate}
                            onChange={(e) => setIssueForm({ ...issueForm, releaseDate: e.target.value })}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--fg-muted)", marginBottom: "0.25rem" }}>
                            Description
                          </label>
                          <input
                            type="text"
                            className="input"
                            value={issueForm.description}
                            onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })}
                          />
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleCreateIssue(volume.id)}
                          disabled={isLoading || !issueForm.issueNumber}
                        >
                          {isLoading ? "Creating..." : "Add Issue"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setNewIssueForVolume(null);
                            setIssueForm({ issueNumber: "", title: "", releaseDate: "", description: "" });
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "0.5rem 1rem", paddingLeft: "2.5rem" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setNewIssueForVolume(volume.id);
                          setIssueForm({ issueNumber: "", title: "", releaseDate: "", description: "" });
                        }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Issue
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Component to migrate legacy volume/issue data
function MigrateLegacyButton() {
  const [isMigrating, setIsMigrating] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message?: string;
    created?: { volumes: number; issues: number };
    error?: string;
  } | null>(null);

  const handleMigrate = async () => {
    setIsMigrating(true);
    setResult(null);
    try {
      const res = await migrateLegacyVolumeIssues();
      setResult(res);
      if (res.success && res.created && (res.created.volumes > 0 || res.created.issues > 0)) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div style={{ display: "inline-block" }}>
      <button className="btn btn-secondary" onClick={handleMigrate} disabled={isMigrating}>
        {isMigrating ? "Importing..." : "Import from Articles"}
      </button>
      {result && (
        <p
          style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            color: result.success ? "var(--status-success)" : "var(--status-error)",
          }}
        >
          {result.success
            ? result.created?.volumes === 0 && result.created?.issues === 0
              ? "No legacy data found"
              : `Created ${result.created?.volumes} volumes and ${result.created?.issues} issues`
            : result.error}
        </p>
      )}
    </div>
  );
}
