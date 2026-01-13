import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  DollarSign,
  TrendingUp,
  CheckCircle,
  Clock,
  Gift,
  Users,
} from "lucide-react";
import { StatCard, Section } from "~/components/Layout";
import { DateRangePicker, getDateRange } from "~/components/analytics/DateRangePicker";
import { PaymentStatusChart, TierDistributionChart } from "~/components/analytics/PaymentCharts";
import { BonusFrequencyChart } from "~/components/analytics/BonusCharts";
import { TopEarnersChart, AuthorTypeChart } from "~/components/analytics/AuthorCharts";
import { SpendingTrendChart } from "~/components/analytics/SpendingTrendChart";
import {
  getPaymentStats,
  getPaymentStatusBreakdown,
  getTierAnalytics,
  getBonusFrequency,
  getTopEarningAuthors,
  getEarningsByAuthorType,
  getMonthlySpendingTrends,
} from "~/lib/queries/analyticsQueries";

// Format cents to dollars
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export const Route = createFileRoute("/analytics")({
  component: AnalyticsPage,
  staleTime: 60_000, // Cache for 1 minute
  gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  loader: async () => {
    // Load all analytics data in parallel (no date filter initially)
    const [
      paymentStats,
      statusBreakdown,
      tierAnalytics,
      bonusFrequency,
      topAuthors,
      authorTypeEarnings,
      monthlyTrends,
    ] = await Promise.all([
      getPaymentStats({}),
      getPaymentStatusBreakdown({}),
      getTierAnalytics({}),
      getBonusFrequency({}),
      getTopEarningAuthors({ limit: 10 }),
      getEarningsByAuthorType({}),
      getMonthlySpendingTrends({ months: 12 }),
    ]);

    return {
      paymentStats,
      statusBreakdown,
      tierAnalytics,
      bonusFrequency,
      topAuthors,
      authorTypeEarnings,
      monthlyTrends,
    };
  },
});

function AnalyticsPage() {
  const data = Route.useLoaderData();
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [isLoading, setIsLoading] = useState(false);

  // Local state for filtered data
  const [filteredData, setFilteredData] = useState(data);

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
      ] = await Promise.all([
        getPaymentStats(filter),
        getPaymentStatusBreakdown(filter),
        getTierAnalytics(filter),
        getBonusFrequency(filter),
        getTopEarningAuthors({ ...filter, limit: 10 }),
        getEarningsByAuthorType(filter),
      ]);

      setFilteredData({
        ...data,
        paymentStats,
        statusBreakdown,
        tierAnalytics,
        bonusFrequency,
        topAuthors,
        authorTypeEarnings,
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

  const { paymentStats, statusBreakdown, tierAnalytics, bonusFrequency, topAuthors, authorTypeEarnings, monthlyTrends } = filteredData;

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

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          title="Total Paid"
          value={paymentStats.totalPayments}
          icon={DollarSign}
        />
        <StatCard
          title="Avg/Article"
          value={paymentStats.avgPayment}
          icon={TrendingUp}
        />
        <StatCard
          title="Paid Articles"
          value={paymentStats.paidCount}
          icon={CheckCircle}
        />
        <StatCard
          title="Unpaid"
          value={paymentStats.unpaidCount}
          icon={Clock}
        />
      </div>

      {/* Summary cards with formatted amounts */}
      <div className="grid grid-cols-2 gap-3">
        <div
          className="p-4 rounded-lg"
          style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
        >
          <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--fg-muted)" }}>
            Total Paid Out
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--status-success)" }}>
            {formatCents(paymentStats.totalPayments)}
          </div>
        </div>
        <div
          className="p-4 rounded-lg"
          style={{ background: "var(--bg-surface)", border: "0.5px solid var(--border-default)" }}
        >
          <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--fg-muted)" }}>
            Pending Payments
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--status-pending)" }}>
            {formatCents(paymentStats.unpaidAmount)}
          </div>
        </div>
      </div>

      {/* Payment Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Payment Status">
          <PaymentStatusChart data={statusBreakdown} />
        </Section>
        <Section title="Average Payment by Tier">
          <TierDistributionChart data={tierAnalytics.tierStats} />
        </Section>
      </div>

      {/* Bonus Analytics */}
      <Section title="Bonus Usage">
        <BonusFrequencyChart
          data={bonusFrequency.bonuses}
          totalArticles={bonusFrequency.totalArticles}
        />
      </Section>

      {/* Author Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title="Top Earners">
          <TopEarnersChart data={topAuthors.topAuthors} />
        </Section>
        <Section title="Earnings by Author Type">
          <AuthorTypeChart data={authorTypeEarnings.byType} />
        </Section>
      </div>

      {/* Spending Trends */}
      <Section title="Monthly Spending">
        <SpendingTrendChart data={monthlyTrends.trends} />
      </Section>
    </div>
  );
}
