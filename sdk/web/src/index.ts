export interface AnalyticsConfig {
    apiKey: string;
    apiUrl?: string;
    userId?: string;
    debug?: boolean;
    batchSize?: number;
    flushInterval?: number;
    retryAttempts?: number;
    offlineEnabled?: boolean;
}
  
export interface EventProperties {
    [key: string]: string | number | boolean;
}
  
export interface TrackEventData {
    user_id?: string;
    event_name: string;
    properties?: EventProperties;
    timestamp?: Date;
    session_id?: string;
    platform?: 'web' | 'android' | 'ios';
}

interface QueuedEvent extends TrackEventData {
    id: string;
    retries: number;
}
  
  export class Analytics {
    private config: Required<AnalyticsConfig>;
    private userId: string | null = null;
    private sessionId: string;
    private eventQueue: QueuedEvent[] = [];
    private flushTimer: NodeJS.Timeout | null = null;
    private isOnline: boolean = navigator.onLine;
    private deviceInfo: any = {};
  
    constructor(config: AnalyticsConfig) {
      this.config = {
        apiUrl: 'http://localhost:3001/api/v1',
        debug: false,
        batchSize: 20,
        flushInterval: 10000, // 10 seconds
        retryAttempts: 3,
        offlineEnabled: true,
        ...config
      };
  
      this.sessionId = this.generateSessionId();
      this.userId = config.userId || null;
      
      this.initialize();
    }
  
    private initialize(): void {
      // Collect device information
      this.collectDeviceInfo();
  
      // Set up offline/online event listeners
      if (this.config.offlineEnabled) {
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
      }
  
      // Set up page unload event to flush remaining events
      window.addEventListener('beforeunload', () => this.flush(true));
  
      // Set up automatic page view tracking
      this.trackPageView();
  
      // Set up periodic flush
      this.startPeriodicFlush();
  
      // Load queued events from localStorage
      this.loadQueuedEvents();
  
      this.log('Analytics SDK initialized', this.config);
    }
  
    private collectDeviceInfo(): void {
      this.deviceInfo = {
        user_agent: navigator.userAgent,
        screen_resolution: `${screen.width}x${screen.height}`,
        language: navigator.language,
        platform: 'web',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        url: window.location.href,
        referrer: document.referrer
      };
    }
  
    private generateSessionId(): string {
      return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
  
    private generateEventId(): string {
      return 'event_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
  
    public identify(userId: string, properties?: EventProperties): void {
      this.userId = userId;
      
      this.track('user_identify', {
        ...properties,
        previous_user_id: this.userId
      });
  
      this.log('User identified', { userId, properties });
    }
  
    public track(eventName: string, properties?: EventProperties): void {
      const event: QueuedEvent = {
        id: this.generateEventId(),
        user_id: this.userId || 'anonymous_' + this.sessionId,
        event_name: eventName,
        properties: {
          ...this.deviceInfo,
          ...properties
        },
        timestamp: new Date(),
        session_id: this.sessionId,
        platform: 'web',
        retries: 0
      };
  
      this.eventQueue.push(event);
      this.log('Event tracked', event);
  
      // Flush if batch size reached
      if (this.eventQueue.length >= this.config.batchSize) {
        this.flush();
      }
  
      // Save to localStorage for offline support
      if (this.config.offlineEnabled) {
        this.saveQueuedEvents();
      }
    }
  
    public page(pageName?: string, properties?: EventProperties): void {
      this.track('page_view', {
        page: pageName || window.location.pathname,
        title: document.title,
        url: window.location.href,
        ...properties
      });
    }
  
    private trackPageView(): void {
      // Track initial page view
      this.page();
  
      // Track navigation for SPAs
      let currentUrl = window.location.href;
      
      // Override pushState and replaceState
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
  
      history.pushState = function(...args) {
        originalPushState.apply(history, args);
        setTimeout(() => {
          if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            // Update device info
            this.deviceInfo.url = window.location.href;
            this.page();
          }
        }, 0);
      }.bind(this);
  
      history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        setTimeout(() => {
          if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            this.deviceInfo.url = window.location.href;
            this.page();
          }
        }, 0);
      }.bind(this);
  
      // Handle back/forward navigation
      window.addEventListener('popstate', () => {
        setTimeout(() => {
          if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            this.deviceInfo.url = window.location.href;
            this.page();
          }
        }, 0);
      });
    }
  
    public flush(synchronous: boolean = false): Promise<void> {
      if (this.eventQueue.length === 0) {
        return Promise.resolve();
      }
  
      const eventsToSend = [...this.eventQueue];
      this.eventQueue = [];
  
      this.log('Flushing events', { count: eventsToSend.length, synchronous });
  
      const sendPromise = this.sendEvents(eventsToSend);
  
      if (synchronous) {
        // For beforeunload, we need to use sendBeacon or synchronous XHR
        this.sendEventsSync(eventsToSend);
      }
  
      return sendPromise;
    }
  
    private async sendEvents(events: QueuedEvent[]): Promise<void> {
      if (!this.isOnline && this.config.offlineEnabled) {
        this.log('Offline - events queued for later');
        return;
      }
  
      try {
        const response = await fetch(`${this.config.apiUrl}/events/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey
          },
          body: JSON.stringify({
            events: events.map(({ id, retries, ...event }) => event)
          })
        });
  
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
  
        this.log('Events sent successfully', { count: events.length });
        
        // Remove from localStorage on success
        if (this.config.offlineEnabled) {
          this.saveQueuedEvents();
        }
  
      } catch (error) {
        this.log('Failed to send events', error);
        
        // Retry logic
        const retriableEvents = events.filter(event => event.retries < this.config.retryAttempts);
        retriableEvents.forEach(event => event.retries++);
        
        this.eventQueue.unshift(...retriableEvents);
  
        // Save failed events for retry
        if (this.config.offlineEnabled) {
          this.saveQueuedEvents();
        }
  
        throw error;
      }
    }
  
    private sendEventsSync(events: QueuedEvent[]): void {
      const data = JSON.stringify({
        events: events.map(({ id, retries, ...event }) => event)
      });
  
      // Try sendBeacon first (preferred for beforeunload)
      if (navigator.sendBeacon) {
        const blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon(`${this.config.apiUrl}/events/batch`, blob);
      } else {
        // Fallback to synchronous XHR
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${this.config.apiUrl}/events/batch`, false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-API-Key', this.config.apiKey);
        xhr.send(data);
      }
    }
  
    private startPeriodicFlush(): void {
      this.flushTimer = setInterval(() => {
        if (this.eventQueue.length > 0) {
          this.flush();
        }
      }, this.config.flushInterval);
    }
  
    private handleOnline(): void {
      this.isOnline = true;
      this.log('Connection restored - flushing queued events');
      
      // Flush any queued events
      if (this.eventQueue.length > 0) {
        this.flush();
      }
    }
  
    private handleOffline(): void {
      this.isOnline = false;
      this.log('Connection lost - events will be queued');
    }
  
    private saveQueuedEvents(): void {
      try {
        localStorage.setItem('analytics_queue', JSON.stringify(this.eventQueue));
      } catch (error) {
        this.log('Failed to save events to localStorage', error);
      }
    }
  
    private loadQueuedEvents(): void {
      try {
        const saved = localStorage.getItem('analytics_queue');
        if (saved) {
          this.eventQueue = JSON.parse(saved);
          this.log('Loaded queued events from localStorage', { count: this.eventQueue.length });
          
          // Flush loaded events
          if (this.eventQueue.length > 0) {
            setTimeout(() => this.flush(), 1000);
          }
        }
      } catch (error) {
        this.log('Failed to load events from localStorage', error);
      }
    }
  
    public reset(): void {
      this.userId = null;
      this.sessionId = this.generateSessionId();
      this.eventQueue = [];
      
      if (this.config.offlineEnabled) {
        localStorage.removeItem('analytics_queue');
      }
  
      this.log('Analytics reset');
    }
  
    public setUserId(userId: string): void {
      this.userId = userId;
      this.log('User ID updated', { userId });
    }
  
    public getUserId(): string | null {
      return this.userId;
    }
  
    public getSessionId(): string {
      return this.sessionId;
    }
  
    public getQueueSize(): number {
      return this.eventQueue.length;
    }
  
    private log(message: string, data?: any): void {
      if (this.config.debug) {
        console.log(`[Analytics] ${message}`, data || '');
      }
    }
  
    public destroy(): void {
      // Clear timer
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
      }
  
      // Flush remaining events
      this.flush(true);
  
      // Remove event listeners
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      window.removeEventListener('beforeunload', () => this.flush(true));
  
      this.log('Analytics SDK destroyed');
    }

  }
  
// Auto-track common events
export class AutoTracker {
    private analytics: Analytics;
  
    constructor(analytics: Analytics) {
      this.analytics = analytics;
    }
  
    public trackClicks(selector: string = 'button, a, [data-track]'): void {
      document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        const element = target.closest(selector);
        
        if (element) {
          const trackingData = element.getAttribute('data-track');
          const elementId = element.id;
          const elementClass = element.className;
          const elementText = element.textContent?.trim().substring(0, 100);
  
          this.analytics.track('element_click', {
            element_type: element.tagName.toLowerCase(),
            element_id: elementId,
            element_class: elementClass,
            element_text: elementText,
            tracking_data: trackingData,
            page: window.location.pathname
          });
        }
      });
    }
  
    public trackFormSubmissions(selector: string = 'form'): void {
      document.addEventListener('submit', (event) => {
        const form = event.target as HTMLFormElement;
        
        if (form.matches(selector)) {
          const formId = form.id;
          const formClass = form.className;
          const formAction = form.action;
          const formMethod = form.method;
  
          this.analytics.track('form_submit', {
            form_id: formId,
            form_class: formClass,
            form_action: formAction,
            form_method: formMethod,
            page: window.location.pathname
          });
        }
      });
    }
  
    public trackScrollDepth(): void {
      let maxScrollDepth = 0;
      const trackingPoints = [25, 50, 75, 100];
      const trackedPoints = new Set<number>();
  
      const trackScroll = () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = Math.round((scrollTop / docHeight) * 100);
  
        if (scrollPercent > maxScrollDepth) {
          maxScrollDepth = scrollPercent;
  
          // Track milestone percentages
          trackingPoints.forEach(point => {
            if (scrollPercent >= point && !trackedPoints.has(point)) {
              trackedPoints.add(point);
              this.analytics.track('scroll_depth', {
                depth_percent: point,
                page: window.location.pathname,
                max_scroll: maxScrollDepth
              });
            }
          });
        }
      };
  
      let scrollTimeout: NodeJS.Timeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(trackScroll, 100);
      });
    }
  
    public trackTimeOnPage(): void {
      const startTime = Date.now();
      let isActive = true;
      let totalActiveTime = 0;
      let lastActiveTime = startTime;
  
      const trackVisibility = () => {
        if (document.hidden) {
          if (isActive) {
            totalActiveTime += Date.now() - lastActiveTime;
            isActive = false;
          }
        } else {
          if (!isActive) {
            lastActiveTime = Date.now();
            isActive = true;
          }
        }
      };
  
      document.addEventListener('visibilitychange', trackVisibility);
  
      // Track time on page when leaving
      window.addEventListener('beforeunload', () => {
        if (isActive) {
          totalActiveTime += Date.now() - lastActiveTime;
        }
  
        const totalTime = Math.round(totalActiveTime / 1000); // Convert to seconds
  
        if (totalTime > 5) { // Only track if user spent more than 5 seconds
          this.analytics.track('time_on_page', {
            time_seconds: totalTime,
            page: window.location.pathname,
            active_time_seconds: Math.round(totalActiveTime / 1000)
          });
        }
      });
    }
  }
  
  // Convenience factory function
  export function createAnalytics(config: AnalyticsConfig): {
    analytics: Analytics;
    autoTracker: AutoTracker;
  } {
    const analytics = new Analytics(config);
    const autoTracker = new AutoTracker(analytics);
  
    return { analytics, autoTracker };
  }