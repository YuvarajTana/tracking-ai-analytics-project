// File: backend/src/routes/ai.ts
import { Router, Request, Response } from 'express';
import { AIQueryService } from '../services/aiQueryService';
import { aiQuerySchema } from '../utils/validation';
import { logger } from '../utils/logger';
import rateLimit from 'express-rate-limit';

const router = Router();
const aiQueryService = new AIQueryService();

// AI-specific rate limiting (stricter)
const aiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 AI queries per minute per user
  message: 'Too many AI queries, please wait before trying again.',
  keyGenerator: (req) => {
    return `ai_${req.user?.id || req.ip}`;
  }
});

router.use(aiRateLimit);

// Natural language to SQL query
router.post('/query', async (req: Request, res: Response) => {
  try {
    const { error, value } = aiQuerySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { question, context } = value;
    const projectId = req.query.project_id as string;

    if (!projectId) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    const startTime = Date.now();

    // Process the natural language query
    const result = await aiQueryService.processNaturalLanguageQuery(
      question,
      {
        ...context,
        project_id: projectId,
        user_id: req.user?.id
      }
    );

    const executionTime = Date.now() - startTime;

    // Log the AI query for analytics
    await aiQueryService.logAIQuery({
      user_id: req.user?.id,
      project_id: projectId,
      natural_language_query: question,
      generated_sql: result.sql,
      execution_time_ms: executionTime,
      result_count: result.data?.length || 0,
      error_message: result.error || null,
      context
    });

    if (result.error) {
      return res.status(400).json({
        error: 'Query execution failed',
        details: result.error,
        sql: result.sql
      });
    }

    res.json({
      question,
      sql: result.sql,
      data: result.data,
      insights: result.insights,
      visualization: result.visualization,
      execution_time_ms: executionTime,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('AI query error:', error);
    res.status(500).json({ error: 'AI query processing failed' });
  }
});

// Get query suggestions based on common patterns
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const suggestions = await aiQueryService.getQuerySuggestions(projectId);

    res.json({
      suggestions,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('AI suggestions error:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Get AI query history for user
router.get('/history', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.project_id as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const history = await aiQueryService.getQueryHistory(
      req.user?.id!,
      projectId,
      limit
    );

    res.json({
      history,
      count: history.length
    });

  } catch (error) {
    logger.error('AI history error:', error);
    res.status(500).json({ error: 'Failed to fetch query history' });
  }
});

// Explain a SQL query in natural language
router.post('/explain', async (req: Request, res: Response) => {
  try {
    const { sql } = req.body;

    if (!sql) {
      return res.status(400).json({ error: 'SQL query is required' });
    }

    const explanation = await aiQueryService.explainSQL(sql);

    res.json({
      sql,
      explanation,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    logger.error('SQL explanation error:', error);
    res.status(500).json({ error: 'Failed to explain SQL' });
  }
});

// Validate and optimize SQL query
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { sql } = req.body;

    if (!sql) {
      return res.status(400).json({ error: 'SQL query is required' });
    }

    const validation = await aiQueryService.validateSQL(sql);

    res.json({
      sql,
      is_valid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      optimized_sql: validation.optimizedSQL,
      estimated_execution_time: validation.estimatedExecutionTime
    });

  } catch (error) {
    logger.error('SQL validation error:', error);
    res.status(500).json({ error: 'Failed to validate SQL' });
  }
});

export { router as aiRoutes };

// File: backend/src/services/aiQueryService.ts
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { clickhouse } from '../config/database';
import { pgPool } from '../config/database';
import { redis } from '../config/database';
import { logger } from '../utils/logger';
import { sanitizeInput } from '../utils/helpers';

interface QueryContext {
  project_id: string;
  user_id?: string;
  date_range?: string;
  filters?: any;
  limit?: number;
}

interface AIQueryResult {
  sql: string;
  data?: any[];
  insights?: string[];
  visualization?: string;
  error?: string;
}

export class AIQueryService {
  private bedrockClient: BedrockRuntimeClient;
  private modelId: string;

  constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }
    });
    this.modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
  }

  async processNaturalLanguageQuery(question: string, context: QueryContext): Promise<AIQueryResult> {
    try {
      // Sanitize input
      const sanitizedQuestion = sanitizeInput(question);

      // Build context with schema information
      const enrichedContext = await this.buildContext(context);

      // Generate SQL using Claude
      const sql = await this.generateSQL(sanitizedQuestion, enrichedContext);

      if (!sql) {
        return { sql: '', error: 'Failed to generate SQL query' };
      }

      // Validate SQL
      const validation = await this.validateSQL(sql);
      if (!validation.isValid) {
        return { 
          sql, 
          error: `Invalid SQL: ${validation.errors.join(', ')}` 
        };
      }

      // Execute query
      const data = await this.executeQuery(sql, context.limit || 1000);

      // Generate insights
      const insights = await this.generateInsights(data, sanitizedQuestion);

      // Suggest visualization
      const visualization = this.suggestVisualization(data, sanitizedQuestion);

      return {
        sql,
        data,
        insights,
        visualization
      };

    } catch (error) {
      logger.error('AI query processing error:', error);
      return { 
        sql: '', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async buildContext(context: QueryContext): Promise<any> {
    return {
      ...context,
      schema: await this.getSchemaContext(),
      sampleQueries: this.getSampleQueries(),
      commonPatterns: await this.getCommonQueryPatterns(context.project_id)
    };
  }

  private async getSchemaContext(): Promise<any> {
    return {
      events_table: {
        name: 'events',
        columns: [
          { name: 'id', type: 'UUID', description: 'Unique event identifier' },
          { name: 'project_id', type: 'String', description: 'Project identifier' },
          { name: 'user_id', type: 'String', description: 'User identifier' },
          { name: 'session_id', type: 'String', description: 'Session identifier' },
          { name: 'event_name', type: 'String', description: 'Name of the event (e.g., page_view, button_click)' },
          { name: 'properties', type: 'Map(String, String)', description: 'Event properties as key-value pairs' },
          { name: 'timestamp', type: 'DateTime', description: 'When the event occurred' },
          { name: 'platform', type: 'Enum', description: 'Platform: web, android, ios' },
          { name: 'country', type: 'String', description: 'User country' },
          { name: 'city', type: 'String', description: 'User city' }
        ],
        indexes: ['timestamp', 'user_id', 'event_name'],
        partitioning: 'Partitioned by month (toYYYYMM(timestamp))'
      }
    };
  }

  private getSampleQueries(): string[] {
    return [
      "SELECT count() as total_events FROM events WHERE project_id = '{project_id}' AND timestamp >= now() - INTERVAL 30 DAY",
      "SELECT uniq(user_id) as daily_active_users, toDate(timestamp) as date FROM events WHERE project_id = '{project_id}' GROUP BY date ORDER BY date",
      "SELECT event_name, count() as event_count FROM events WHERE project_id = '{project_id}' GROUP BY event_name ORDER BY event_count DESC",
      "SELECT properties['page'] as page, count() as page_views FROM events WHERE project_id = '{project_id}' AND event_name = 'page_view' GROUP BY page ORDER BY page_views DESC"
    ];
  }

  private async getCommonQueryPatterns(projectId: string): Promise<string[]> {
    try {
      // Get most common event names for this project
      const result = await clickhouse.query({
        query: `
          SELECT event_name, count() as cnt
          FROM events
          WHERE project_id = {project_id:String}
            AND timestamp >= now() - INTERVAL 7 DAY
          GROUP BY event_name
          ORDER BY cnt DESC
          LIMIT 10
        `,
        query_params: { project_id: projectId },
        format: 'JSONEachRow'
      });

      const events = await result.json();
      return events.map((e: any) => e.event_name);

    } catch (error) {
      logger.error('Error getting common patterns:', error);
      return ['page_view', 'button_click', 'form_submit'];
    }
  }

  private async generateSQL(question: string, context: any): Promise<string> {
    const prompt = this.buildPrompt(question, context);

    try {
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        }),
        contentType: 'application/json'
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      // Extract SQL from Claude's response
      const sql = this.extractSQL(responseBody.content[0].text);
      return sql;

    } catch (error) {
      logger.error('Bedrock API error:', error);
      throw new Error('Failed to generate SQL with AI');
    }
  }

  private buildPrompt(question: string, context: any): string {
    return `You are an expert SQL analyst. Convert the following natural language question into a ClickHouse SQL query.

IMPORTANT RULES:
1. Always include WHERE project_id = '{project_id}' in your queries
2. Use proper ClickHouse syntax and functions
3. Return only the SQL query, no explanations
4. Use parameterized project_id placeholder: {project_id:String}
5. For date filters, use timestamp column with proper DateTime functions
6. Properties are stored as Map(String, String), access them like properties['key_name']
7. Always add ORDER BY and LIMIT clauses for performance

DATABASE SCHEMA:
${JSON.stringify(context.schema, null, 2)}

COMMON EVENT NAMES FOR THIS PROJECT:
${context.commonPatterns.join(', ')}

SAMPLE QUERIES:
${context.sampleQueries.join('\n')}

QUESTION: "${question}"

CONTEXT:
- Project ID: ${context.project_id}
- Date Range: ${context.date_range || '30d'}
- Additional Filters: ${JSON.stringify(context.filters || {})}

SQL QUERY:`;
  }

  private extractSQL(response: string): string {
    // Extract SQL from various possible formats
    const sqlPatterns = [
      /```sql\n([\s\S]*?)\n```/i,
      /```\n([\s\S]*?)\n```/i,
      /(SELECT[\s\S]*?;?)/i
    ];

    for (const pattern of sqlPatterns) {
      const match = response.match(pattern);
      if (match) {
        return match[1].trim().replace(/;$/, '');
      }
    }

    // If no pattern matches, return the response as-is (cleaned)
    return response.trim().replace(/;$/, '');
  }

  async validateSQL(sql: string): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    optimizedSQL?: string;
    estimatedExecutionTime?: number;
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Basic syntax validation
      if (!sql.toLowerCase().includes('select')) {
        errors.push('Query must be a SELECT statement');
      }

      if (!sql.includes('project_id')) {
        errors.push('Query must include project_id filter for security');
      }

      // Check for potentially dangerous operations
      const dangerousKeywords = ['drop', 'delete', 'update', 'insert', 'alter', 'create'];
      const lowerSQL = sql.toLowerCase();
      
      for (const keyword of dangerousKeywords) {
        if (lowerSQL.includes(keyword)) {
          errors.push(`Dangerous operation detected: ${keyword.toUpperCase()}`);
        }
      }

      // Performance warnings
      if (!lowerSQL.includes('limit')) {
        warnings.push('Consider adding LIMIT clause for better performance');
      }

      if (!lowerSQL.includes('timestamp >=') && !lowerSQL.includes('timestamp between')) {
        warnings.push('Consider adding timestamp filter for better performance');
      }

      // Try to explain the query (ClickHouse EXPLAIN)
      if (errors.length === 0) {
        try {
          await clickhouse.query({
            query: `EXPLAIN SYNTAX ${sql}`,
            format: 'JSONEachRow'
          });
        }