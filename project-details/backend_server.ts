// File: backend/src/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';

import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { analyticsRoutes } from './routes/analytics';
import { aiRoutes } from './routes/ai';
import { dashboardRoutes } from './routes/dashboard';
import { errorHandler } from './middleware/errorHandler';
import { authenticateToken } from './middleware/auth';
import { logger } from './utils/logger';
import { RealtimeService } from './services/realtimeService';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));

// General middleware
app.use(compression());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Initialize real-time service
const realtimeService = new RealtimeService(io);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/events', eventRoutes(realtimeService));
app.use('/api/v1/analytics', authenticateToken, analyticsRoutes);
app.use('/api/v1/ai', authenticateToken, aiRoutes);
app.use('/api/v1/dashboard', authenticateToken, dashboardRoutes);

// API documentation
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'AI Analytics Platform API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/v1/auth/login': 'User login',
        'POST /api/v1/auth/register': 'User registration',
        'POST /api/v1/auth/refresh': 'Refresh access token',
        'POST /api/v1/auth/logout': 'User logout'
      },
      events: {
        'POST /api/v1/events': 'Track events',
        'POST /api/v1/events/batch': 'Batch track events'
      },
      analytics: {
        'GET /api/v1/analytics/overview': 'Get analytics overview',
        'GET /api/v1/analytics/events': 'Get events analytics',
        'GET /api/v1/analytics/users': 'Get user analytics',
        'GET /api/v1/analytics/funnel': 'Get funnel analysis'
      },
      ai: {
        'POST /api/v1/ai/query': 'Natural language to SQL query',
        'GET /api/v1/ai/suggestions': 'Get query suggestions'
      }
    }
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

server.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📊 Dashboard: http://localhost:${PORT}/api/docs`);
  logger.info(`🔗 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// File: backend/src/config/database.ts
import { Pool } from 'pg';
import { createClient } from '@clickhouse/client';
import { createClient as createRedisClient } from 'redis';
import { logger } from '../utils/logger';

// PostgreSQL connection
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ClickHouse connection
export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  database: process.env.CLICKHOUSE_DATABASE || 'analytics',
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 0,
  }
});

// Redis connection
export const redis = createRedisClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => logger.error('Redis Client Error', err));
redis.connect();

// Test connections
export async function testConnections() {
  try {
    // Test PostgreSQL
    const pgClient = await pgPool.connect();
    await pgClient.query('SELECT NOW()');
    pgClient.release();
    logger.info('✅ PostgreSQL connected');

    // Test ClickHouse
    await clickhouse.ping();
    logger.info('✅ ClickHouse connected');

    // Test Redis
    await redis.ping();
    logger.info('✅ Redis connected');

    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    return false;
  }
}

// File: backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pgPool } from '../config/database';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Verify user exists in database
    const result = await pgPool.query(
      'SELECT id, email, properties FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      role: result.rows[0].properties?.role
    };

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export const authenticateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    const result = await pgPool.query(`
      SELECT p.id as project_id, p.name as project_name, ak.permissions
      FROM api_keys ak
      JOIN projects p ON ak.project_id = p.id
      WHERE ak.key_hash = $1 AND ak.is_active = true AND ak.expires_at > NOW()
    `, [apiKey]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired API key' });
    }

    // Update last used timestamp
    await pgPool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1',
      [apiKey]
    );

    (req as any).project = {
      id: result.rows[0].project_id,
      name: result.rows[0].project_name,
      permissions: result.rows[0].permissions
    };

    next();
  } catch (error) {
    logger.error('API key auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// File: backend/src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Determine error type and respond accordingly
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.message
    });
  }

  if (error.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized access'
    });
  }

  if (error.name === 'DatabaseError') {
    return res.status(500).json({
      error: 'Database operation failed'
    });
  }

  // Default error response
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
};

// File: backend/src/utils/logger.ts
import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'ai-analytics-api' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// File: backend/src/services/realtimeService.ts
import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger';

export class RealtimeService {
  private io: SocketIOServer;
  private connectedClients: Map<string, any> = new Map();

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);
      this.connectedClients.set(socket.id, socket);

      socket.on('join_project', (projectId: string) => {
        socket.join(`project_${projectId}`);
        logger.info(`Client ${socket.id} joined project ${projectId}`);
      });

      socket.on('join_dashboard', (dashboardId: string) => {
        socket.join(`dashboard_${dashboardId}`);
        logger.info(`Client ${socket.id} joined dashboard ${dashboardId}`);
      });

      socket.on('subscribe_events', (filters: any) => {
        const room = `events_${JSON.stringify(filters)}`;
        socket.join(room);
        logger.info(`Client ${socket.id} subscribed to events with filters`);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });

      // Send connection confirmation
      socket.emit('connected', { 
        clientId: socket.id, 
        timestamp: new Date().toISOString() 
      });
    });
  }

  public broadcastEvent(projectId: string, event: any) {
    this.io.to(`project_${projectId}`).emit('new_event', {
      ...event,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastMetricUpdate(projectId: string, metric: string, value: any) {
    this.io.to(`project_${projectId}`).emit('metric_update', {
      metric,
      value,
      timestamp: new Date().toISOString()
    });
  }

  public broadcastDashboardUpdate(dashboardId: string, data: any) {
    this.io.to(`dashboard_${dashboardId}`).emit('dashboard_update', {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  public getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  public getClientsByProject(projectId: string): number {
    const room = this.io.sockets.adapter.rooms.get(`project_${projectId}`);
    return room ? room.size : 0;
  }
}

// File: backend/src/utils/validation.ts
import Joi from 'joi';

export const eventSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  event_name: Joi.string().min(1).max(100).required(),
  properties: Joi.object().pattern(Joi.string(), Joi.alternatives().try(
    Joi.string(),
    Joi.number(),
    Joi.boolean()
  )).default({}),
  timestamp: Joi.date().iso().default(() => new Date()),
  session_id: Joi.string().uuid().optional(),
  platform: Joi.string().valid('web', 'android', 'ios').default('web')
});

export const batchEventsSchema = Joi.object({
  events: Joi.array().items(eventSchema).min(1).max(100).required()
});

export const aiQuerySchema = Joi.object({
  question: Joi.string().min(5).max(500).required(),
  context: Joi.object({
    date_range: Joi.string().valid('1d', '7d', '30d', '90d').default('30d'),
    filters: Joi.object().default({}),
    limit: Joi.number().integer().min(1).max(10000).default(100)
  }).default({})
});

export const userRegistrationSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required()
});

export const userLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// File: backend/src/utils/helpers.ts
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const generateUUID = (): string => {
  return uuidv4();
};

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
};

export const comparePassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return await bcrypt.compare(password, hashedPassword);
};

export const generateApiKey = (prefix: string = 'ak'): string => {
  const randomBytes = crypto.randomBytes(32);
  return `${prefix}_${randomBytes.toString('hex')}`;
};

export const hashApiKey = (apiKey: string): string => {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
};

export const formatDateRange = (range: string): { start: Date; end: Date } => {
  const end = new Date();
  const start = new Date();

  switch (range) {
    case '1d':
      start.setDate(end.getDate() - 1);
      break;
    case '7d':
      start.setDate(end.getDate() - 7);
      break;
    case '30d':
      start.setDate(end.getDate() - 30);
      break;
    case '90d':
      start.setDate(end.getDate() - 90);
      break;
    default:
      start.setDate(end.getDate() - 30);
  }

  return { start, end };
};

export const sanitizeInput = (input: string): string => {
  return input.replace(/[<>'"&]/g, '');
};

export const paginate = (page: number = 1, limit: number = 20) => {
  const offset = (page - 1) * limit;
  return { limit, offset };
};

// File: backend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "tests"
  ]
}