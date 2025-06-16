// File: backend/src/routes/auth.ts
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pgPool } from '../config/database';
import { redis } from '../config/database';
import { 
  hashPassword, 
  comparePassword, 
  generateUUID 
} from '../utils/helpers';
import { 
  userRegistrationSchema, 
  userLoginSchema 
} from '../utils/validation';
import { logger } from '../utils/logger';

const router = Router();

// Register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { error, value } = userRegistrationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password, first_name, last_name } = value;

    // Check if user already exists
    const existingUser = await pgPool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const userId = generateUUID();

    const result = await pgPool.query(`
      INSERT INTO users (id, email, first_name, last_name, properties)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, first_name, last_name, created_at
    `, [userId, email, first_name, last_name, { password_hash: hashedPassword }]);

    const user = result.rows[0];

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.REFRESH_TOKEN_SECRET!,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
    );

    // Store refresh token
    await pgPool.query(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `, [user.id, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);

    logger.info(`User registered: ${email}`);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name
      },
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900 // 15 minutes
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { error, value } = userLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;

    // Find user with password
    const result = await pgPool.query(`
      SELECT id, email, first_name, last_name, properties, last_seen
      FROM users 
      WHERE email = $1 AND is_active = true
    `, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const storedPasswordHash = user.properties?.password_hash;

    if (!storedPasswordHash || !await comparePassword(password, storedPasswordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last seen
    await pgPool.query(
      'UPDATE users SET last_seen = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.REFRESH_TOKEN_SECRET!,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
    );

    // Store refresh token
    await pgPool.query(`
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `, [user.id, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);

    logger.info(`User logged in: ${email}`);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        last_seen: user.last_seen
      },
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh access token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    // Verify refresh token
    const decoded = jwt.verify(refresh_token, process.env.REFRESH_TOKEN_SECRET!) as any;

    // Check if refresh token exists and is valid
    const tokenResult = await pgPool.query(`
      SELECT rt.id, u.id as user_id, u.email
      FROM refresh_tokens rt
      JOIN users u ON rt.user_id = u.id
      WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND rt.revoked_at IS NULL
    `, [refresh_token]);

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const { user_id, email } = tokenResult.rows[0];

    // Generate new access token
    const accessToken = jwt.sign(
      { userId: user_id, email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    res.json({
      access_token: accessToken,
      expires_in: 900
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// Logout user
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (refresh_token) {
      // Revoke refresh token
      await pgPool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [refresh_token]
      );
    }

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get user profile
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    const result = await pgPool.query(`
      SELECT id, email, first_name, last_name, first_seen, last_seen, created_at
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });

  } catch (error) {
    logger.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export { router as authRoutes };

// File: backend/src/routes/events.ts
import { Router, Request, Response } from 'express';
import { clickhouse } from '../config/database';
import { redis } from '../config/database';
import { authenticateApiKey } from '../middleware/auth';
import { eventSchema, batchEventsSchema } from '../utils/validation';
import { logger } from '../utils/logger';
import { RealtimeService } from '../services/realtimeService';
import rateLimit from 'express-rate-limit';

export function eventRoutes(realtimeService: RealtimeService) {
  const router = Router();

  // Event-specific rate limiting
  const eventRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: parseInt(process.env.EVENT_RATE_LIMIT_MAX || '1000'), // 1000 events per minute
    message: 'Too many events, please slow down.',
    keyGenerator: (req) => {
      const apiKey = req.headers['x-api-key'] as string;
      return `events_${apiKey}`;
    }
  });

  // Middleware
  router.use(authenticateApiKey);
  router.use(eventRateLimit);

  // Track single event
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { error, value } = eventSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const event = {
        ...value,
        project_id: (req as any).project.id,
        ip: req.ip,
        user_agent: req.get('User-Agent') || '',
        timestamp: new Date(value.timestamp).toISOString()
      };

      // Insert into ClickHouse
      await clickhouse.insert({
        table: 'events',
        values: [event],
        format: 'JSONEachRow'
      });

      // Cache recent events in Redis for real-time dashboard
      const cacheKey = `recent_events:${event.project_id}`;
      await redis.lpush(cacheKey, JSON.stringify(event));
      await redis.ltrim(cacheKey, 0, 99); // Keep last 100 events
      await redis.expire(cacheKey, 3600); // 1 hour expiry

      // Broadcast to real-time clients
      realtimeService.broadcastEvent(event.project_id, event);

      logger.info(`Event tracked: ${event.event_name} for project ${event.project_id}`);

      res.status(201).json({
        message: 'Event tracked successfully',
        event_id: event.id || 'generated',
        timestamp: event.timestamp
      });

    } catch (error) {
      logger.error('Event tracking error:', error);
      res.status(500).json({ error: 'Failed to track event' });
    }
  });

  // Track batch events
  router.post('/batch', async (req: Request, res: Response) => {
    try {
      const { error, value } = batchEventsSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const projectId = (req as any).project.id;
      const events = value.events.map((event: any) => ({
        ...event,
        project_id: projectId,
        ip: req.ip,
        user_agent: req.get('User-Agent') || '',
        timestamp: new Date(event.timestamp).toISOString()
      }));

      // Batch insert into ClickHouse
      await clickhouse.insert({
        table: 'events',
        values: events,
        format: 'JSONEachRow'
      });

      // Cache recent events
      const cacheKey = `recent_events:${projectId}`;
      const pipeline = redis.multi();
      
      events.forEach(event => {
        pipeline.lpush(cacheKey, JSON.stringify(event));
      });
      
      pipeline.ltrim(cacheKey, 0, 99);
      pipeline.expire(cacheKey, 3600);
      await pipeline.exec();

      // Broadcast each event
      events.forEach(event => {
        realtimeService.broadcastEvent(projectId, event);
      });

      logger.info(`Batch events tracked: ${events.length} events for project ${projectId}`);

      res.status(201).json({
        message: 'Batch events tracked successfully',
        events_count: events.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Batch event tracking error:', error);
      res.status(500).json({ error: 'Failed to track batch events' });
    }
  });

  // Get recent events (for debugging/monitoring)
  router.get('/recent', async (req: Request, res: Response) => {
    try {
      const projectId = (req as any).project.id;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);

      // Try Redis cache first
      const cacheKey = `recent_events:${projectId}`;
      const cachedEvents = await redis.lrange(cacheKey, 0, limit - 1);

      if (cachedEvents.length > 0) {
        const events = cachedEvents.map(event => JSON.parse(event));
        return res.json({
          events,
          source: 'cache',
          count: events.length
        });
      }

      // Fallback to ClickHouse
      const result = await clickhouse.query({
        query: `
          SELECT *
          FROM events
          WHERE project_id = {project_id:String}
          ORDER BY timestamp DESC
          LIMIT {limit:UInt32}
        `,
        query_params: {
          project_id: projectId,
          limit
        },
        format: 'JSONEachRow'
      });

      const events = await result.json();

      res.json({
        events,
        source: 'database',
        count: events.length
      });

    } catch (error) {
      logger.error('Recent events fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch recent events' });
    }
  });

  // Event validation endpoint
  router.post('/validate', (req: Request, res: Response) => {
    const { error, value } = eventSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        valid: false,
        error: error.details[0].message,
        field: error.details[0].path.join('.')
      });
    }

    res.json({
      valid: true,
      sanitized_event: value
    });
  });

  // Get event schema
  router.get('/schema', (req: Request, res: Response) => {
    res.json({
      schema: {
        user_id: { type: 'string', format: 'uuid', required: true },
        event_name: { type: 'string', minLength: 1, maxLength: 100, required: true },
        properties: { type: 'object', required: false, default: {} },
        timestamp: { type: 'string', format: 'date-time', required: false },
        session_id: { type: 'string', format: 'uuid', required: false },
        platform: { type: 'string', enum: ['web', 'android', 'ios'], default: 'web' }
      },
      examples: [
        {
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          event_name: 'page_view',
          properties: {
            page: '/dashboard',
            referrer: 'google.com'
          },
          platform: 'web'
        },
        {
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          event_name: 'button_click',
          properties: {
            button_id: 'cta_button',
            page: '/pricing'
          }
        }
      ]
    });
  });

  return router;
}

// File: backend/src/routes/analytics.ts
import { Router, Request, Response } from 'express';
import { clickhouse } from '../config/database';
import { redis } from '../config/database';
import { formatDateRange, paginate } from '../utils/helpers';
import { logger } from '../utils/logger';

const router = Router();

// Analytics overview
router.get('/overview', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const dateRange = req.query.date_range as string || '30d';
    const { start, end } = formatDateRange(dateRange);

    // Cache key for this query
    const cacheKey = `analytics:overview:${projectId}:${dateRange}`;
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({
        ...JSON.parse(cached),
        from_cache: true
      });
    }

    // Query ClickHouse for overview metrics
    const result = await clickhouse.query({
      query: `
        SELECT
          count() as total_events,
          uniq(user_id) as unique_users,
          uniq(session_id) as sessions,
          countIf(event_name = 'page_view') as page_views,
          round(avg(arrayExists(x -> x = 'page_view', groupArray(event_name))), 2) as avg_events_per_session
        FROM events
        WHERE project_id = {project_id:String}
          AND timestamp >= {start_date:DateTime}
          AND timestamp <= {end_date:DateTime}
      `,
      query_params: {
        project_id: projectId,
        start_date: start.toISOString(),
        end_date: end.toISOString()
      },
      format: 'JSONEachRow'
    });

    const overview = await result.json();
    const data = overview[0] || {};

    // Get top events
    const topEventsResult = await clickhouse.query({
      query: `
        SELECT
          event_name,
          count() as event_count,
          uniq(user_id) as unique_users
        FROM events
        WHERE project_id = {project_id:String}
          AND timestamp >= {start_date:DateTime}
          AND timestamp <= {end_date:DateTime}
        GROUP BY event_name
        ORDER BY event_count DESC
        LIMIT 10
      `,
      query_params: {
        project_id: projectId,
        start_date: start.toISOString(),
        end_date: end.toISOString()
      },
      format: 'JSONEachRow'
    });

    const topEvents = await topEventsResult.json();

    const response = {
      overview: data,
      top_events: topEvents,
      date_range: { start, end },
      generated_at: new Date().toISOString()
    };

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// Daily active users
router.get('/users/daily-active', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const dateRange = req.query.date_range as string || '30d';
    const { start, end } = formatDateRange(dateRange);

    const result = await clickhouse.query({
      query: `
        SELECT
          toDate(timestamp) as date,
          uniq(user_id) as active_users,
          uniq(session_id) as sessions
        FROM events
        WHERE project_id = {project_id:String}
          AND timestamp >= {start_date:DateTime}
          AND timestamp <= {end_date:DateTime}
        GROUP BY date
        ORDER BY date
      `,
      query_params: {
        project_id: projectId,
        start_date: start.toISOString(),
        end_date: end.toISOString()
      },
      format: 'JSONEachRow'
    });

    const data = await result.json();

    res.json({
      daily_active_users: data,
      date_range: { start, end }
    });

  } catch (error) {
    logger.error('Daily active users error:', error);
    res.status(500).json({ error: 'Failed to fetch daily active users' });
  }
});

// Funnel analysis
router.get('/funnel', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const events = (req.query.events as string)?.split(',') || [];
    const dateRange = req.query.date_range as string || '30d';
    const { start, end } = formatDateRange(dateRange);

    if (events.length < 2) {
      return res.status(400).json({ error: 'At least 2 events required for funnel analysis' });
    }

    // Build funnel query dynamically
    const funnelSteps = events.map((event, index) => `
      countIf(event_name = '${event}') as step_${index + 1}_count,
      uniqIf(user_id, event_name = '${event}') as step_${index + 1}_users
    `).join(',');

    const result = await clickhouse.query({
      query: `
        SELECT ${funnelSteps}
        FROM events
        WHERE project_id = {project_id:String}
          AND timestamp >= {start_date:DateTime}
          AND timestamp <= {end_date:DateTime}
          AND event_name IN (${events.map(e => `'${e}'`).join(',')})
      `,
      query_params: {
        project_id: projectId,
        start_date: start.toISOString(),
        end_date: end.toISOString()
      },
      format: 'JSONEachRow'
    });

    const rawData = await result.json()[0] || {};
    
    // Format funnel data
    const funnelData = events.map((event, index) => {
      const stepUsers = rawData[`step_${index + 1}_users`] || 0;
      const previousStepUsers = index > 0 ? rawData[`step_${index}_users`] : stepUsers;
      const conversionRate = previousStepUsers > 0 ? (stepUsers / previousStepUsers) * 100 : 0;

      return {
        step: index + 1,
        event_name: event,
        users: stepUsers,
        conversion_rate: Math.round(conversionRate * 100) / 100
      };
    });

    res.json({
      funnel: funnelData,
      date_range: { start, end },
      events_analyzed: events
    });

  } catch (error) {
    logger.error('Funnel analysis error:', error);
    res.status(500).json({ error: 'Failed to perform funnel analysis' });
  }
});

// User retention analysis
router.get('/retention', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const period = req.query.period as string || 'daily'; // daily, weekly, monthly

    let dateFormat = 'toDate(timestamp)';
    let intervalDays = 1;

    if (period === 'weekly') {
      dateFormat = 'toMonday(timestamp)';
      intervalDays = 7;
    } else if (period === 'monthly') {
      dateFormat = 'toStartOfMonth(timestamp)';
      intervalDays = 30;
    }

    const result = await clickhouse.query({
      query: `
        WITH user_first_seen AS (
          SELECT 
            user_id,
            min(${dateFormat}) as first_seen_date
          FROM events
          WHERE project_id = {project_id:String}
            AND timestamp >= now() - INTERVAL 90 DAY
          GROUP BY user_id
        ),
        user_activity AS (
          SELECT 
            user_id,
            ${dateFormat} as activity_date
          FROM events
          WHERE project_id = {project_id:String}
            AND timestamp >= now() - INTERVAL 90 DAY
          GROUP BY user_id, activity_date
        )
        SELECT
          first_seen_date,
          count(DISTINCT ufs.user_id) as cohort_size,
          count(DISTINCT CASE WHEN dateDiff('day', first_seen_date, activity_date) = {interval:Int32} THEN ua.user_id END) as retained_users,
          round(retained_users / cohort_size * 100, 2) as retention_rate
        FROM user_first_seen ufs
        LEFT JOIN user_activity ua ON ufs.user_id = ua.user_id
        GROUP BY first_seen_date
        ORDER BY first_seen_date DESC
        LIMIT 20
      `,
      query_params: {
        project_id: projectId,
        interval: intervalDays
      },
      format: 'JSONEachRow'
    });

    const data = await result.json();

    res.json({
      retention_analysis: data,
      period,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Retention analysis error:', error);
    res.status(500).json({ error: 'Failed to perform retention analysis' });
  }
});

// Top pages/screens
router.get('/pages', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const dateRange = req.query.date_range as string || '30d';
    const { start, end } = formatDateRange(dateRange);
    const { limit, offset } = paginate(
      parseInt(req.query.page as string),
      parseInt(req.query.limit as string)
    );

    const result = await clickhouse.query({
      query: `
        SELECT
          properties['page'] as page,
          count() as page_views,
          uniq(user_id) as unique_visitors,
          uniq(session_id) as sessions,
          round(avg(toFloat64OrNull(properties['load_time'])), 2) as avg_load_time
        FROM events
        WHERE project_id = {project_id:String}
          AND event_name = 'page_view'
          AND timestamp >= {start_date:DateTime}
          AND timestamp <= {end_date:DateTime}
          AND properties['page'] != ''
        GROUP BY page
        ORDER BY page_views DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        project_id: projectId,
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        limit,
        offset
      },
      format: 'JSONEachRow'
    });

    const data = await result.json();

    res.json({
      pages: data,
      pagination: {
        limit,
        offset,
        has_more: data.length === limit
      },
      date_range: { start, end }
    });

  } catch (error) {
    logger.error('Pages analysis error:', error);
    res.status(500).json({ error: 'Failed to fetch pages analytics' });
  }
});

// Real-time metrics
router.get('/realtime', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;

    // Get metrics from last 5 minutes
    const result = await clickhouse.query({
      query: `
        SELECT
          count() as events_last_5min,
          uniq(user_id) as active_users_last_5min,
          uniq(session_id) as active_sessions_last_5min,
          topK(5)(event_name) as top_events_last_5min
        FROM events
        WHERE project_id = {project_id:String}
          AND timestamp >= now() - INTERVAL 5 MINUTE
      `,
      query_params: {
        project_id: projectId
      },
      format: 'JSONEachRow'
    });

    const data = await result.json()[0] || {};

    // Get recent events from Redis cache
    const cacheKey = `recent_events:${projectId}`;
    const recentEvents = await redis.lrange(cacheKey, 0, 9);
    const parsedEvents = recentEvents.map(event => JSON.parse(event));

    res.json({
      realtime_metrics: data,
      recent_events: parsedEvents,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Realtime metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch realtime metrics' });
  }
});

export { router as analyticsRoutes };