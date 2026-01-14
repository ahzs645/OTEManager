import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  DollarSign,
  TrendingUp,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Section } from "~/components/Layout";
import { DateRangePicker, getDateRange } from "~/components/analytics/DateRangePicker";
import { PaymentStatusChart, TierDistributionChart, TierArticleCountChart } from "~/components/analytics/PaymentCharts";
import { BonusFrequencyChart } from "~/components/analytics/BonusCharts";
import { TopEarnersChart, AuthorTypeChart, StudentTypeChart } from "~/components/analytics/AuthorCharts";
import { SpendingTrendChart } from "~/components/analytics/SpendingTrendChart";
import { SemesterBreakdownChart } from "~/components/analytics/SemesterChart";
import { DrillDownModal, type DrillDownType } from "~/components/analytics/DrillDownModal";
import {
  getPaymentStats,
  getPaymentStatusBreakdown,
  getTierAnalytics,
  getBonusFrequency,
  getTopEarningAuthors,
  getEarningsByAuthorType,
  getEarningsByStudentType,
  getMonthlySpendingTrends,
  getSemesterBreakdown,
  // Drill-down queries
  getArticlesByTier,
  getArticlesByBonus,
  getArticlesByPaymentStatus,
  getAuthorWithArticles,
  getAuthorsByType,
  getAuthorsByStudentType,
  getArticlesBySemester,
} from "~/lib/queries/analyticsQueries";

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Tab types
type TabId = "payments" | "authors" | "trends";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "payments", label: "Payments" },
  { id: "authors", label: "Authors" },
  { id: "trends", label: "Trends" },
];

export const Route = createFileRoute("/analytics")({
  component: AnalyticsPage,
  staleTime: 60_000,
  gcTime: 5 * 60 * 1000,
  loader: async () => {
    const [
      paymentStats,
      statusBreakdown,
      tierAnalytics,
      bonusFrequency,
      topAuthors,
      authorTypeEarnings,
      studentTypeEarnings,
      monthlyTrends,
      semesterBreakdown,
    ] = await Promise.all([
      getPaymentStats({ data: {} }),
      getPaymentStatusBreakdown({ data: {} }),
      getTierAnalytics({ data: {} }),
      getBonusFrequency({ data: {} }),
      getTopEarningAuthors({ data: { limit: 10 } }),
      getEarningsByAuthorType({ data: {} }),
      getEarningsByStudentType({ data: {} }),
      getMonthlySpendingTrends({ data: { months: 12 } }),
      getSemesterBreakdown({ data: { years: 3 } }),
    ]);

    return {
      paymentStats,
      statusBreakdown,
      tierAnalytics,
      bonusFrequency,
      topAuthors,
      authorTypeEarnings,
      studentTypeEarnings,
      monthlyTrends,
      semesterBreakdown,
    };
  },
});

// Drill-down modal state
interface DrillDownState {
  isOpen: boolean;
  isLoading: boolean;
  data: {
    type: DrillDownType;
    title: string;
    subtitle?: string;
    articles?: any[];
    authors?: any[];
    author?: any;
  } | null;
}

function AnalyticsPage() {
  const data = Route.useLoaderData();
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [filteredData, setFilteredData] = useState(data);
  const [activeTab, setActiveTab] = useState<TabId>("payments");

  // Drill-down modal state
  const [drillDown, setDrillDown] = useState<DrillDownState>({
    isOpen: false,
    isLoading: false,
    data: null,
  });

  // Handle date range changes
  const handleDateChange = async (startDate: string, endDate: string) => {
    setDateRange({ startDate, endDate });
    setIsLoading(true);

    try {
      const filter = { startDate: startDate || undefined, endDate: endDate || undefined };

      const [
        paymentStats,
        statusBreakdown,
        tierAnalytics,
        bonusFrequency,
        topAuthors,
        authorTypeEarnings,
        studentTypeEarnings,
      ] = await Promise.all([
        getPaymentStats({ data: filter }),
        getPaymentStatusBreakdown({ data: filter }),
        getTierAnalytics({ data: filter }),
        getBonusFrequency({ data: filter }),
        getTopEarningAuthors({ data: { ...filter, limit: 10 } }),
        getEarningsByAuthorType({ data: filter }),
        getEarningsByStudentType({ data: filter }),
      ]);

      setFilteredData({
        ...data,
        paymentStats,
        statusBreakdown,
        tierAnalytics,
        bonusFrequency,
        topAuthors,
        authorTypeEarnings,
        studentTypeEarnings,
      });
    } catch (error) {
      console.error("Failed to fetch filtered data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetSelect = (preset: string) => {
    const range = getDateRange(preset);
    handleDateChange(range.startDate, range.endDate);
  };

  // ========== DRILL-DOWN HANDLERS ==========

  const openDrillDown = (title: string, subtitle?: string) => {
    setDrillDown({ isOpen: true, isLoading: true, data: { type: "tier", title, subtitle } });
  };

  const closeDrillDown = () => {
    setDrillDown({ isOpen: false, isLoading: false, data: null });
  };

  // Tier drill-down
  const handleTierClick = async (tier: string) => {
    const tierLabel = tier.replace(" (Basic)", "").replace(" (Standard)", "").replace(" (Advanced)", "");
    openDrillDown(`${tierLabel} Articles`, `Articles in ${tierLabel}`);
    try {
      const result = await getArticlesByTier({ data: { tier } });
      setDrillDown({
        isOpen: true,
        isLoading: false,
        data: { type: "tier", title: `${tierLabel} Articles`, subtitle: `${result.articles.length} articles`, articles: result.articles },
      });
    } catch (error) {
      console.error("Tier drill-down failed:", error);
      closeDrillDown();
    }
  };

  // Bonus drill-down
  const handleBonusClick = async (bonusName: string) => {
    openDrillDown(`${bonusName} Bonus Articles`);
    try {
      const result = await getArticlesByBonus({ data: { bonusType: bonusName } });
      setDrillDown({
        isOpen: true,
        isLoading: false,
        data: { type: "bonus", title: `${bonusName} Bonus`, subtitle: `${result.articles.length} articles`, articles: result.articles },
      });
    } catch (error) {
      console.error("Bonus drill-down failed:", error);
      closeDrillDown();
    }
  };

  // Payment status drill-down
  const handlePaymentStatusClick = async (paid: boolean) => {
    const status = paid ? "Paid" : "Unpaid";
    openDrillDown(`${status} Articles`);
    try {
      const result = await getArticlesByPaymentStatus({ data: { paid } });
      setDrillDown({
        isOpen: true,
        isLoading: false,
        data: { type: "paymentStatus", title: `${status} Articles`, subtitle: `${result.articles.length} articles`, articles: result.articles },
      });
    } catch (error) {
      console.error("Payment status drill-down failed:", error);
      closeDrillDown();
    }
  };

  // Top earner drill-down
  const handleTopEarnerClick = async (authorId: string) => {
    openDrillDown("Author Details");
    try {
      const result = await getAuthorWithArticles({ data: { authorId } });
      if (result.author) {
        setDrillDown({
          isOpen: true,
          isLoading: false,
          data: {
            type: "author",
            title: `${result.author.givenName} ${result.author.surname}`,
            subtitle: result.author.authorType || "Unknown type",
            author: result.author,
          },
        });
      } else {
        closeDrillDown();
      }
    } catch (error) {
      console.error("Author drill-down failed:", error);
      closeDrillDown();
    }
  };

  // Author type drill-down
  const handleAuthorTypeClick = async (authorType: string) => {
    openDrillDown(`${authorType} Authors`);
    try {
      const result = await getAuthorsByType({ data: { authorType } });
      setDrillDown({
        isOpen: true,
        isLoading: false,
        data: { type: "authorType", title: `${authorType} Authors`, subtitle: `${result.authors.length} authors`, authors: result.authors },
      });
    } catch (error) {
      console.error("Author type drill-down failed:", error);
      closeDrillDown();
    }
  };

  // Student type drill-down
  const handleStudentTypeClick = async (studentType: string) => {
    openDrillDown(`${studentType} Students`);
    try {
      const result = await getAuthorsByStudentType({ data: { studentType } });
      setDrillDown({
        isOpen: true,
        isLoading: false,
        data: { type: "authorType", title: `${studentType} Students`, subtitle: `${result.authors.length} students`, authors: result.authors },
      });
    } catch (error) {
      console.error("Student type drill-down failed:", error);
      closeDrillDown();
    }
  };

  // Semester drill-down
  const handleSemesterClick = async (semester: string, year: number) => {
    openDrillDown(`${semester} ${year}`);
    try {
      const result = await getArticlesBySemester({ data: { semester, year } });
      setDrillDown({
        isOpen: true,
        isLoading: false,
        data: { type: "semester", title: `${semester} ${year}`, subtitle: `${result.articles.length} articles`, articles: result.articles },
      });
    } catch (error) {
      console.error("Semester drill-down failed:", error);
      closeDrillDown();
    }
  };

  const { paymentStats, statusBreakdown, tierAnalytics, bonusFrequency, topAuthors, authorTypeEarnings, studentTypeEarnings, monthlyTrends, semesterBreakdown } = filteredData;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="page-header">
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Payment and contributor insights</p>
        </div>
        <DateRangePicker
          startDate={dateRange.startDate}
          endDate={dateRange.endDate}
          onStartChange={(date) => handleDateChange(date, dateRange.endDate)}
          onEndChange={(date) => handleDateChange(dateRange.startDate, date)}
          onPresetSelect={handlePresetSelect}
        />
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.5)" }}
        >
          <div
            className="animate-spin rounded-full h-8 w-8 border-2 border-current border-t-transparent"
            style={{ color: "var(--accent)" }}
          />
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          className="p-4 rounded-lg"
          style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4" style={{ color: "var(--status-success)" }} />
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
              Total Paid Out
            </div>
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--status-success)" }}>
            {formatCents(paymentStats.totalPayments)}
          </div>
        </div>
        <div
          className="p-4 rounded-lg"
          style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4" style={{ color: "var(--fg-muted)" }} />
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
              Avg per Article
            </div>
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--fg-default)" }}>
            {formatCents(paymentStats.avgPayment)}
          </div>
        </div>
        <div
          className="p-4 rounded-lg"
          style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4" style={{ color: "var(--status-pending)" }} />
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
              Pending Payments
            </div>
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--status-pending)" }}>
            {formatCents(paymentStats.unpaidAmount)}
          </div>
        </div>
        <div
          className="p-4 rounded-lg"
          style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4" style={{ color: "var(--fg-muted)" }} />
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
              Articles
            </div>
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--fg-default)" }}>
            {paymentStats.paidCount} <span className="text-sm font-normal" style={{ color: "var(--fg-muted)" }}>paid</span>
            {" / "}
            {paymentStats.unpaidCount} <span className="text-sm font-normal" style={{ color: "var(--fg-muted)" }}>unpaid</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-lg"
        style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors"
            style={{
              background: activeTab === tab.id ? "var(--accent)" : "transparent",
              color: activeTab === tab.id ? "white" : "var(--fg-muted)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "payments" && (
        <div className="space-y-6">
          {/* Payment Status & Tier */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Section title="Payment Status">
              <PaymentStatusChart data={statusBreakdown} onSliceClick={handlePaymentStatusClick} />
            </Section>
            <Section title="Average Payment by Tier">
              <TierDistributionChart data={tierAnalytics.tierStats} onBarClick={handleTierClick} />
            </Section>
          </div>

          {/* Bonus Analytics */}
          <Section title="Bonus Usage">
            <BonusFrequencyChart
              data={bonusFrequency.bonuses}
              totalArticles={bonusFrequency.totalArticles}
              onBarClick={handleBonusClick}
            />
          </Section>
        </div>
      )}

      {activeTab === "authors" && (
        <div className="space-y-6">
          {/* Top Earners & Author Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Section title="Top Earners">
              <TopEarnersChart data={topAuthors.topAuthors} onBarClick={handleTopEarnerClick} />
            </Section>
            <Section title="Earnings by Author Type">
              <AuthorTypeChart data={authorTypeEarnings.byType} onSliceClick={handleAuthorTypeClick} />
            </Section>
          </div>

          {/* Student Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Section title="Earnings by Student Type">
              <StudentTypeChart data={studentTypeEarnings.byStudentType} onSliceClick={handleStudentTypeClick} />
            </Section>
            <Section title="Articles by Tier">
              <TierArticleCountChart data={tierAnalytics.tierStats} onBarClick={handleTierClick} />
            </Section>
          </div>
        </div>
      )}

      {activeTab === "trends" && (
        <div className="space-y-6">
          {/* Monthly & Semester */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Section title="Monthly Spending">
              <SpendingTrendChart data={monthlyTrends.trends} />
            </Section>
            <Section title="Semester Breakdown">
              <SemesterBreakdownChart data={semesterBreakdown.semesters} onBarClick={handleSemesterClick} />
            </Section>
          </div>
        </div>
      )}

      {/* Drill-down Modal */}
      <DrillDownModal
        isOpen={drillDown.isOpen}
        onClose={closeDrillDown}
        data={drillDown.data}
        isLoading={drillDown.isLoading}
      />
    </div>
  );
}
