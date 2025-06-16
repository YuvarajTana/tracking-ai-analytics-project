// File: frontend/src/pages/index.tsx
import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout/Layout';
import { MetricCard } from '../components/Metrics/MetricCard';
import { CustomLineChart } from '../components/Charts/LineChart';
import { CustomBarChart } from '../components/Charts/BarChart';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { wsClient } from '../lib/websocket';
import {
  UsersIcon,
  ChartBarIcon,
  CursorArrowRaysIcon,
  EyeIcon
} from '@heroicons/react/24/outline';

export default function Dashboard() {
  const {
    overview,
    topEvents,
    dailyActiveUsers,
    realtimeMetrics,
    isLoading,
    error,
    selectedProject,
    dateRange,
    setSelectedProject,
    setDateRange,
    fetchOverview,
    fetchDailyActiveUsers,
    fetchRealtimeMetrics
  } = useAnalyticsStore();

  const [realtimeEvents, setRealtimeEvents] = useState<any[]>([]);

  useEffect(() => {
    // Set default project (in real app, this would come from user settings)
    if (!selectedProject) {
      setSelectedProject('demo-project-id');
    }
  }, [selectedProject, setSelectedProject]);

  useEffect(() => {
    if (selectedProject) {
      // Connect to WebSocket
      wsClient.connect(selectedProject);
      
      // Set up real-time event listener
      wsClient.on('new_event', (event) => {
        setRealtimeEvents(prev => [event, ...prev.slice(0, 9)]);
      });

      // Fetch initial realtime metrics
      fetchRealtimeMetrics();
      
      // Set up periodic realtime updates
      const interval = setInterval(fetchRealtimeMetrics, 30000);

      return () => {
        clearInterval(interval);
        wsClient.off('new_event');
      };
    }
  }, [selectedProject, fetchRealtimeMetrics]);

  const dateRangeOptions = [
    { value: '1d', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' }
  ];

  if (isLoading && !overview) {
    return (
      <Layout>
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow h-32" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow h-96" />
            <div className="bg-white p-6 rounded-lg shadow h-96" />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="md:flex md:items-center md:justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
              Analytics Overview
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Real-time insights and analytics for your application
            </p>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md"
            >
              {dateRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  Error loading data
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Metrics Cards */}
        {overview && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title="Total Events"
              value={overview.total_events}
              icon={ChartBarIcon}
              color="blue"
            />
            <MetricCard
              title="Unique Users"
              value={overview.unique_users}
              icon={UsersIcon}
              color="green"
            />
            <MetricCard
              title="Sessions"
              value={overview.sessions}
              icon={CursorArrowRaysIcon}
              color="purple"
            />
            <MetricCard
              title="Page Views"
              value={overview.page_views}
              icon={EyeIcon}
              color="yellow"
            />
          </div>
        )}

        {/* Real-time Metrics */}
        {realtimeMetrics && (
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Real-time Activity (Last 5 minutes)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-600">
                  {realtimeMetrics.realtime_metrics?.events_last_5min || 0}
                </div>
                <div className="text-sm text-gray-500">Events</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {realtimeMetrics.realtime_metrics?.active_users_last_5min || 0}
                </div>
                <div className="text-sm text-gray-500">Active Users</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {realtimeMetrics.realtime_metrics?.active_sessions_last_5min || 0}
                </div>
                <div className="text-sm text-gray-500">Active Sessions</div>
              </div>
            </div>
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily Active Users Chart */}
          {dailyActiveUsers.length > 0 && (
            <CustomLineChart
              data={dailyActiveUsers}
              xKey="date"
              yKey="active_users"
              title="Daily Active Users"
              color="#0ea5e9"
            />
          )}

          {/* Top Events Chart */}
          {topEvents.length > 0 && (
            <CustomBarChart
              data={topEvents.slice(0, 10)}
              xKey="event_name"
              yKey="event_count"
              title="Top Events"
              color="#10b981"
            />
          )}
        </div>

        {/* Recent Events */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              Recent Events
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Live
              </span>
            </h3>
          </div>
          <div className="divide-y divide-gray-200">
            {realtimeEvents.length > 0 ? (
              realtimeEvents.map((event, index) => (
                <div key={`${event.id}-${index}`} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {event.event_name}
                      </p>
                      <p className="text-sm text-gray-500">
                        User: {event.user_id} • Platform: {event.platform}
                      </p>
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  {event.properties && Object.keys(event.properties).length > 0 && (
                    <div className="mt-2 text-xs text-gray-400">
                      {JSON.stringify(event.properties, null, 2).slice(0, 100)}...
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="px-6 py-4 text-center text-gray-500">
                No recent events. Events will appear here in real-time.
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

// File: frontend/src/pages/ai.tsx
import React, { useState, useEffect } from 'react';
import { Layout } from '../components/Layout/Layout';
import { apiClient } from '../lib/api';
import { useAnalyticsStore } from '../stores/analyticsStore';
import {
  SparklesIcon,
  ChartBarIcon,
  TableCellsIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { CustomLineChart } from '../components/Charts/LineChart';
import { CustomBarChart } from '../components/Charts/BarChart';

interface AIQueryResult {
  question: string;
  sql: string;
  data: any[];
  insights: string[];
  visualization: string;
  execution_time_ms: number;
  generated_at: string;
}

export default function AIPage() {
  const { selectedProject, setSelectedProject } = useAnalyticsStore();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AIQueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [queryHistory, setQueryHistory] = useState<any[]>([]);

  useEffect(() => {
    if (!selectedProject) {
      setSelectedProject('demo-project-id');
    }
  }, [selectedProject, setSelectedProject]);

  useEffect(() => {
    if (selectedProject) {
      loadSuggestions();
      loadQueryHistory();
    }
  }, [selectedProject]);

  const loadSuggestions = async () => {
    try {
      const response = await apiClient.getQuerySuggestions(selectedProject!);
      setSuggestions(response.suggestions);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  };

  const loadQueryHistory = async () => {
    try {
      const response = await apiClient.getQueryHistory(selectedProject!);
      setQueryHistory(response.history);
    } catch (error) {
      console.error('Failed to load query history:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !selectedProject) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.queryAI(selectedProject, query.trim());
      setResult(response);
      loadQueryHistory(); // Refresh history
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Query failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
  };

  const renderVisualization = (data: any[], visualization: string) => {
    if (!data || data.length === 0) return null;

    const firstRow = data[0];
    const columns = Object.keys(firstRow);
    const numericColumns = columns.filter(col => 
      typeof firstRow[col] === 'number' && !col.includes('id')
    );
    const stringColumns = columns.filter(col => 
      typeof firstRow[col] === 'string' && !col.includes('id')
    );

    const xKey = stringColumns[0] || columns[0];
    const yKey = numericColumns[0] || columns[1];

    switch (visualization) {
      case 'line_chart':
        return (
          <CustomLineChart
            data={data}
            xKey={xKey}
            yKey={yKey}
            title="Query Results"
            height={400}
          />
        );
      case 'bar_chart':
        return (
          <CustomBarChart
            data={data.slice(0, 20)} // Limit for readability
            xKey={xKey}
            yKey={yKey}
            title="Query Results"
            height={400}
          />
        );
      case 'table':
      default:
        return (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {columns.map(col => (
                    <th
                      key={col}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {col.replace('_', ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.slice(0, 100).map((row, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {columns.map(col => (
                      <td key={col} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {typeof row[col] === 'number' 
                          ? row[col].toLocaleString() 
                          : String(row[col] || '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length > 100 && (
              <div className="px-6 py-3 bg-gray-50 text-sm text-gray-500 text-center">
                Showing first 100 rows of {data.length} total results
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="md:flex md:items-center md:justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate flex items-center">
              <SparklesIcon className="h-8 w-8 text-primary-500 mr-3" />
              AI Analytics
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Ask questions about your data in natural language
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Query Interface */}
          <div className="lg:col-span-3 space-y-6">
            {/* Query Form */}
            <div className="bg-white shadow rounded-lg p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Ask a question about your data
                  </label>
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., Show me daily active users for the past 30 days"
                    rows={3}
                    className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    disabled={isLoading}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-sm text-gray-500">
                    Powered by Claude 3.5 Sonnet
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading || !query.trim()}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <ArrowPathIcon className="animate-spin -ml-1 mr-2 h-4 w-4" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <SparklesIcon className="-ml-1 mr-2 h-4 w-4" />
                        Ask AI
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Error State */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      Query Failed
                    </h3>
                    <div className="mt-2 text-sm text-red-700">
                      <p>{error}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-6">
                {/* Query Info */}
                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      Query Results
                    </h3>
                    <div className="flex items-center text-sm text-gray-500">
                      <ClockIcon className="h-4 w-4 mr-1" />
                      {result.execution_time_ms}ms
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Question:</h4>
                      <p className="text-sm text-gray-900 bg-gray-50 rounded p-3">
                        {result.question}
                      </p>
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Generated SQL:</h4>
                      <pre className="text-sm text-gray-900 bg-gray-50 rounded p-3 overflow-x-auto">
                        {result.sql}
                      </pre>
                    </div>

                    {result.insights.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">AI Insights:</h4>
                        <ul className="space-y-1">
                          {result.insights.map((insight, index) => (
                            <li key={index} className="text-sm text-gray-600 flex items-start">
                              <span className="text-primary-500 mr-2">•</span>
                              {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Data Visualization */}
                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      Data Visualization
                    </h3>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-500">
                        {result.data.length} results
                      </span>
                      {result.visualization === 'line_chart' && <ChartBarIcon className="h-4 w-4 text-gray-400" />}
                      {result.visualization === 'bar_chart' && <ChartBarIcon className="h-4 w-4 text-gray-400" />}
                      {result.visualization === 'table' && <TableCellsIcon className="h-4 w-4 text-gray-400" />}
                    </div>
                  </div>
                  
                  {renderVisualization(result.data, result.visualization)}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Query Suggestions */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Suggested Questions
              </h3>
              <div className="space-y-2">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full text-left text-sm text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded p-2 transition-colors"
                    disabled={isLoading}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {/* Query History */}
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                Recent Queries
              </h3>
              <div className="space-y-3">
                {queryHistory.slice(0, 10).map((historyItem, index) => (
                  <div key={index} className="border-b border-gray-200 pb-3 last:border-b-0">
                    <button
                      onClick={() => setQuery(historyItem.natural_language_query)}
                      className="w-full text-left text-sm text-gray-900 hover:text-primary-600 transition-colors"
                      disabled={isLoading}
                    >
                      {historyItem.natural_language_query}
                    </button>
                    <div className="mt-1 text-xs text-gray-500">
                      {new Date(historyItem.created_at).toLocaleDateString()}
                      {historyItem.execution_time_ms && (
                        <span className="ml-2">
                          {historyItem.execution_time_ms}ms
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {queryHistory.length === 0 && (
                  <p className="text-sm text-gray-500">No recent queries</p>
                )}
              </div>
            </div>

            {/* Help */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-blue-900 mb-2">
                Tips for better queries
              </h3>
              <ul className="text-xs text-blue-800 space-y-1">
                <li>• Be specific about time ranges</li>
                <li>• Use event names from your data</li>
                <li>• Ask for comparisons or trends</li>
                <li>• Request top/bottom results</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

// File: frontend/src/pages/login.tsx
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuthStore } from '../stores/authStore';
import { CubeIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export default function Login() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading, error, clearError } = useAuthStore();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    clearError();
  }, [clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(formData.email, formData.password);
    } catch (error) {
      // Error is handled by the store
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <CubeIcon className="h-12 w-12 text-primary-600" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to AI Analytics
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <Link href="/register" className="font-medium text-primary-600 hover:text-primary-500">
              create a new account
            </Link>
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div className="relative">
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                className="appearance-none rounded-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeSlashIcon className="h-5 w-5 text-gray-400" />
                ) : (
                  <EyeIcon className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <div className="text-sm text-red-600">{error}</div>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="text-center">
            <Link href="/forgot-password" className="text-sm text-primary-600 hover:text-primary-500">
              Forgot your password?
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

// File: frontend/src/pages/_app.tsx
import React, { useEffect } from 'react';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useAuthStore } from '../stores/authStore';
import '../styles/globals.css';

const publicRoutes = ['/login', '/register', '/forgot-password'];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const { isAuthenticated, loadUser, isLoading } = useAuthStore();

  useEffect(() => {
    // Load user on app start
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    // Redirect logic
    const isPublicRoute = publicRoutes.includes(router.pathname);
    
    if (!isLoading) {
      if (!isAuthenticated && !isPublicRoute) {
        router.push('/login');
      } else if (isAuthenticated && isPublicRoute) {
        router.push('/');
      }
    }
  }, [isAuthenticated, isLoading, router]);

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return <Component {...pageProps} />;
}

// File: frontend/src/styles/globals.css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    font-family: 'Inter', system-ui, sans-serif;
  }
}

@layer components {
  .btn-primary {
    @apply inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500;
  }
  
  .btn-secondary {
    @apply inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500;
  }
  
  .form-input {
    @apply block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm;
  }
  
  .form-label {
    @apply block text-sm font-medium text-gray-700;
  }
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: #f1f5f9;
}

::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Animations */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.3s ease-out;
}

/* Loading states */
.skeleton {
  @apply animate-pulse bg-gray-200;
}

.skeleton-text {
  @apply skeleton h-4 rounded;
}

.skeleton-avatar {
  @apply skeleton h-10 w-10 rounded-full;
}

.skeleton-button {
  @apply skeleton h-10 rounded-md;
}