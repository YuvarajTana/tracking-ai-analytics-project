// File: frontend/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001',
  },
  experimental: {
    appDir: false // Using pages directory for now
  }
}

module.exports = nextConfig

// File: frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}

// File: frontend/src/types/index.ts
export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  last_seen: string;
}

export interface Project {
  id: string;
  name: string;
  api_key: string;
  description?: string;
  created_at: string;
}

export interface Event {
  id: string;
  user_id: string;
  event_name: string;
  properties: Record<string, any>;
  timestamp: string;
  platform: 'web' | 'android' | 'ios';
  country?: string;
  city?: string;
}

export interface AnalyticsOverview {
  total_events: number;
  unique_users: number;
  sessions: number;
  page_views: number;
  avg_events_per_session: number;
}

export interface TopEvent {
  event_name: string;
  event_count: number;
  unique_users: number;
}

export interface DailyActiveUser {
  date: string;
  active_users: number;
  sessions: number;
}

export interface AIQuery {
  question: string;
  sql: string;
  data: any[];
  insights: string[];
  visualization: string;
  execution_time_ms: number;
  generated_at: string;
}

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  layout: any[];
  filters: Record<string, any>;
  project_id: string;
  created_at: string;
  updated_at: string;
}

// File: frontend/src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const token = this.getToken();

    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      
      if (response.status === 401) {
        this.clearToken();
        window.location.href = '/login';
        throw new Error('Unauthorized');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Request failed:', error);
      throw error;
    }
  }

  // Auth endpoints
  async login(email: string, password: string) {
    const response = await this.request<any>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    if (response.tokens?.access_token) {
      this.setToken(response.tokens.access_token);
    }
    
    return response;
  }

  async register(userData: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }) {
    const response = await this.request<any>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    
    if (response.tokens?.access_token) {
      this.setToken(response.tokens.access_token);
    }
    
    return response;
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearToken();
    }
  }

  async getProfile() {
    return this.request<{ user: User }>('/auth/profile');
  }

  // Analytics endpoints
  async getAnalyticsOverview(projectId: string, dateRange: string = '30d') {
    return this.request<{
      overview: AnalyticsOverview;
      top_events: TopEvent[];
      date_range: { start: string; end: string };
    }>(`/analytics/overview?project_id=${projectId}&date_range=${dateRange}`);
  }

  async getDailyActiveUsers(projectId: string, dateRange: string = '30d') {
    return this.request<{
      daily_active_users: DailyActiveUser[];
      date_range: { start: string; end: string };
    }>(`/analytics/users/daily-active?project_id=${projectId}&date_range=${dateRange}`);
  }

  async getFunnelAnalysis(projectId: string, events: string[], dateRange: string = '30d') {
    const eventsParam = events.join(',');
    return this.request<any>(`/analytics/funnel?project_id=${projectId}&events=${eventsParam}&date_range=${dateRange}`);
  }

  async getRealtimeMetrics(projectId: string) {
    return this.request<any>(`/analytics/realtime?project_id=${projectId}`);
  }

  async getTopPages(projectId: string, dateRange: string = '30d', page: number = 1, limit: number = 20) {
    return this.request<any>(`/analytics/pages?project_id=${projectId}&date_range=${dateRange}&page=${page}&limit=${limit}`);
  }

  // AI endpoints
  async queryAI(projectId: string, question: string, context?: any) {
    return this.request<AIQuery>(`/ai/query?project_id=${projectId}`, {
      method: 'POST',
      body: JSON.stringify({ question, context }),
    });
  }

  async getQuerySuggestions(projectId: string) {
    return this.request<{ suggestions: string[] }>(`/ai/suggestions?project_id=${projectId}`);
  }

  async getQueryHistory(projectId: string, limit: number = 20) {
    return this.request<{ history: any[] }>(`/ai/history?project_id=${projectId}&limit=${limit}`);
  }

  // Dashboard endpoints
  async getDashboards(projectId?: string) {
    const params = projectId ? `?project_id=${projectId}` : '';
    return this.request<{ dashboards: Dashboard[] }>(`/dashboard${params}`);
  }

  async createDashboard(data: Partial<Dashboard>) {
    return this.request<{ dashboard: Dashboard }>('/dashboard', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDashboard(id: string, data: Partial<Dashboard>) {
    return this.request<{ dashboard: Dashboard }>(`/dashboard/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDashboard(id: string) {
    return this.request(`/dashboard/${id}`, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient(API_BASE);

// File: frontend/src/lib/websocket.ts
import { io, Socket } from 'socket.io-client';

class WebSocketClient {
  private socket: Socket | null = null;
  private url: string;
  private listeners: Map<string, Function[]> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  connect(projectId?: string): void {
    if (this.socket?.connected) return;

    this.socket = io(this.url, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      
      if (projectId) {
        this.socket?.emit('join_project', projectId);
      }
      
      this.emit('connected', { connected: true });
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.emit('disconnected', { connected: false });
    });

    this.socket.on('new_event', (event) => {
      this.emit('new_event', event);
    });

    this.socket.on('metric_update', (data) => {
      this.emit('metric_update', data);
    });

    this.socket.on('dashboard_update', (data) => {
      this.emit('dashboard_update', data);
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.emit('error', error);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.listeners.clear();
  }

  joinProject(projectId: string): void {
    this.socket?.emit('join_project', projectId);
  }

  joinDashboard(dashboardId: string): void {
    this.socket?.emit('join_dashboard', dashboardId);
  }

  subscribeToEvents(filters: any): void {
    this.socket?.emit('subscribe_events', filters);
  }

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback?: Function): void {
    if (!callback) {
      this.listeners.delete(event);
      return;
    }

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(callback);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => callback(data));
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export const wsClient = new WebSocketClient(
  process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'
);

// File: frontend/src/stores/authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '../lib/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (userData: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await apiClient.login(email, password);
          set({ 
            user: response.user, 
            isAuthenticated: true, 
            isLoading: false 
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Login failed',
            isLoading: false 
          });
          throw error;
        }
      },

      register: async (userData) => {
        set({ isLoading: true, error: null });
        try {
          const response = await apiClient.register(userData);
          set({ 
            user: response.user, 
            isAuthenticated: true, 
            isLoading: false 
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Registration failed',
            isLoading: false 
          });
          throw error;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await apiClient.logout();
        } catch (error) {
          console.error('Logout error:', error);
        } finally {
          set({ 
            user: null, 
            isAuthenticated: false, 
            isLoading: false,
            error: null
          });
        }
      },

      loadUser: async () => {
        const token = apiClient.getToken();
        if (!token) return;

        set({ isLoading: true });
        try {
          const response = await apiClient.getProfile();
          set({ 
            user: response.user, 
            isAuthenticated: true, 
            isLoading: false 
          });
        } catch (error) {
          console.error('Load user error:', error);
          apiClient.clearToken();
          set({ 
            user: null, 
            isAuthenticated: false, 
            isLoading: false 
          });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user, 
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
);

// File: frontend/src/stores/analyticsStore.ts
import { create } from 'zustand';
import { apiClient } from '../lib/api';
import type { AnalyticsOverview, DailyActiveUser, TopEvent } from '../types';

interface AnalyticsState {
  // Data
  overview: AnalyticsOverview | null;
  topEvents: TopEvent[];
  dailyActiveUsers: DailyActiveUser[];
  realtimeMetrics: any;
  
  // UI State
  isLoading: boolean;
  error: string | null;
  selectedProject: string | null;
  dateRange: string;
  
  // Actions
  setSelectedProject: (projectId: string) => void;
  setDateRange: (range: string) => void;
  fetchOverview: () => Promise<void>;
  fetchDailyActiveUsers: () => Promise<void>;
  fetchRealtimeMetrics: () => Promise<void>;
  clearError: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  // Initial state
  overview: null,
  topEvents: [],
  dailyActiveUsers: [],
  realtimeMetrics: null,
  isLoading: false,
  error: null,
  selectedProject: null,
  dateRange: '30d',

  setSelectedProject: (projectId: string) => {
    set({ selectedProject: projectId });
    // Auto-fetch data when project changes
    const { fetchOverview, fetchDailyActiveUsers } = get();
    fetchOverview();
    fetchDailyActiveUsers();
  },

  setDateRange: (range: string) => {
    set({ dateRange: range });
    // Auto-fetch data when date range changes
    const { fetchOverview, fetchDailyActiveUsers } = get();
    fetchOverview();
    fetchDailyActiveUsers();
  },

  fetchOverview: async () => {
    const { selectedProject, dateRange } = get();
    if (!selectedProject) return;

    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.getAnalyticsOverview(selectedProject, dateRange);
      set({ 
        overview: response.overview,
        topEvents: response.top_events,
        isLoading: false 
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch overview',
        isLoading: false 
      });
    }
  },

  fetchDailyActiveUsers: async () => {
    const { selectedProject, dateRange } = get();
    if (!selectedProject) return;

    try {
      const response = await apiClient.getDailyActiveUsers(selectedProject, dateRange);
      set({ dailyActiveUsers: response.daily_active_users });
    } catch (error) {
      console.error('Failed to fetch daily active users:', error);
    }
  },

  fetchRealtimeMetrics: async () => {
    const { selectedProject } = get();
    if (!selectedProject) return;

    try {
      const response = await apiClient.getRealtimeMetrics(selectedProject);
      set({ realtimeMetrics: response });
    } catch (error) {
      console.error('Failed to fetch realtime metrics:', error);
    }
  },

  clearError: () => set({ error: null }),
}));

// File: frontend/src/components/Layout/Sidebar.tsx
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ChartBarIcon,
  CubeIcon,
  SparklesIcon,
  Cog6ToothIcon,
  HomeIcon,
  FunnelIcon,
  UsersIcon,
  DocumentChartBarIcon
} from '@heroicons/react/24/outline';

const navigation = [
  { name: 'Overview', href: '/', icon: HomeIcon },
  { name: 'Events', href: '/events', icon: ChartBarIcon },
  { name: 'Users', href: '/users', icon: UsersIcon },
  { name: 'Funnels', href: '/funnels', icon: FunnelIcon },
  { name: 'Dashboards', href: '/dashboards', icon: DocumentChartBarIcon },
  { name: 'AI Insights', href: '/ai', icon: SparklesIcon },
  { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
];

export function Sidebar() {
  const router = useRouter();

  return (
    <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
      <div className="flex-1 flex flex-col min-h-0 bg-gray-900">
        <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
          <div className="flex items-center flex-shrink-0 px-4">
            <CubeIcon className="h-8 w-8 text-primary-400" />
            <span className="ml-2 text-white text-lg font-semibold">
              AI Analytics
            </span>
          </div>
          <nav className="mt-8 flex-1 px-2 space-y-1">
            {navigation.map((item) => {
              const isActive = router.pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`${
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  } group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors`}
                >
                  <item.icon
                    className={`${
                      isActive ? 'text-gray-300' : 'text-gray-400 group-hover:text-gray-300'
                    } mr-3 flex-shrink-0 h-5 w-5`}
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}

// File: frontend/src/components/Layout/Header.tsx
import React, { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { 
  BellIcon, 
  UserCircleIcon,
  ChevronDownIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';
import { wsClient } from '../../lib/websocket';

export function Header() {
  const { user, logout } = useAuthStore();
  const [isOnline, setIsOnline] = React.useState(true);

  React.useEffect(() => {
    wsClient.on('connected', () => setIsOnline(true));
    wsClient.on('disconnected', () => setIsOnline(false));
    wsClient.on('error', () => setIsOnline(false));

    return () => {
      wsClient.off('connected');
      wsClient.off('disconnected');
      wsClient.off('error');
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    wsClient.disconnect();
  };

  return (
    <div className="md:pl-64 flex flex-col flex-1">
      <div className="sticky top-0 z-10 flex-shrink-0 flex h-16 bg-white shadow border-b border-gray-200">
        <div className="flex-1 px-4 flex justify-between items-center">
          <div className="flex-1 flex">
            <div className="w-full flex md:ml-0">
              <div className="flex items-center">
                <div className={`h-2 w-2 rounded-full mr-2 ${
                  isOnline ? 'bg-green-400' : 'bg-red-400'
                }`} />
                <span className="text-sm text-gray-500">
                  {isOnline ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="ml-4 flex items-center md:ml-6 space-x-4">
            {/* Notifications */}
            <button className="p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
              <BellIcon className="h-6 w-6" />
            </button>

            {/* Profile dropdown */}
            <Menu as="div" className="ml-3 relative">
              <div>
                <Menu.Button className="max-w-xs bg-white flex items-center text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                  <UserCircleIcon className="h-8 w-8 text-gray-400" />
                  <span className="ml-2 text-gray-700">{user?.first_name}</span>
                  <ChevronDownIcon className="ml-1 h-4 w-4 text-gray-400" />
                </Menu.Button>
              </div>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none">
                  <Menu.Item>
                    {({ active }) => (
                      <a
                        href="/profile"
                        className={`${
                          active ? 'bg-gray-100' : ''
                        } block px-4 py-2 text-sm text-gray-700`}
                      >
                        Your Profile
                      </a>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={handleLogout}
                        className={`${
                          active ? 'bg-gray-100' : ''
                        } block w-full text-left px-4 py-2 text-sm text-gray-700`}
                      >
                        <ArrowRightOnRectangleIcon className="inline h-4 w-4 mr-2" />
                        Sign out
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </Menu>
          </div>
        </div>
      </div>
    </div>
  );
}

// File: frontend/src/components/Layout/Layout.tsx
import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex overflow-hidden bg-gray-100">
      <Sidebar />
      <div className="flex flex-col w-0 flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 relative overflow-y-auto focus:outline-none">
          <div className="py-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// File: frontend/src/components/Charts/LineChart.tsx
import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface LineChartProps {
  data: any[];
  xKey: string;
  yKey: string;
  title?: string;
  color?: string;
  height?: number;
}

export function CustomLineChart({
  data,
  xKey,
  yKey,
  title,
  color = '#0ea5e9',
  height = 300
}: LineChartProps) {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      {title && (
        <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey={xKey}
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => {
              if (typeof value === 'string' && value.includes('-')) {
                return new Date(value).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                });
              }
              return value;
            }}
          />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            labelFormatter={(value) => {
              if (typeof value === 'string' && value.includes('-')) {
                return new Date(value).toLocaleDateString('en-US', { 
                  weekday: 'short',
                  month: 'short', 
                  day: 'numeric' 
                });
              }
              return value;
            }}
            formatter={(value: any) => [
              typeof value === 'number' ? value.toLocaleString() : value,
              yKey.replace('_', ' ').toUpperCase()
            ]}
          />
          <Line
            type="monotone"
            dataKey={yKey}
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, stroke: color, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// File: frontend/src/components/Charts/BarChart.tsx
import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface BarChartProps {
  data: any[];
  xKey: string;
  yKey: string;
  title?: string;
  color?: string;
  height?: number;
}

export function CustomBarChart({
  data,
  xKey,
  yKey,
  title,
  color = '#0ea5e9',
  height = 300
}: BarChartProps) {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      {title && (
        <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey={xKey}
            tick={{ fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: any) => [
              typeof value === 'number' ? value.toLocaleString() : value,
              yKey.replace('_', ' ').toUpperCase()
            ]}
          />
          <Bar dataKey={yKey} fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// File: frontend/src/components/Metrics/MetricCard.tsx
import React from 'react';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/solid';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
}

const colorClasses = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
};

export function MetricCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  color = 'blue'
}: MetricCardProps) {
  const formatValue = (val: string | number) => {
    if (typeof val === 'number') {
      return val.toLocaleString();
    }
    return val;
  };

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            {Icon && (
              <div className={`p-3 rounded-md ${colorClasses[color]}`}>
                <Icon className="h-6 w-6 text-white" />
              </div>
            )}
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">
                {title}
              </dt>
              <dd className="text-lg font-medium text-gray-900">
                {formatValue(value)}
              </dd>
            </dl>
          </div>
        </div>
        {change !== undefined && (
          <div className="mt-4">
            <div className="flex items-center">
              {change >= 0 ? (
                <ArrowUpIcon className="h-4 w-4 text-green-500" />
              ) : (
                <ArrowDownIcon className="h-4 w-4 text-red-500" />
              )}
              <span
                className={`text-sm font-medium ${
                  change >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {Math.abs(change)}%
              </span>
              <span className="text-sm text-gray-500 ml-2">
                {changeLabel || 'vs last period'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}