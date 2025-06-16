# AI Analytics Platform - Project Setup

# 1. Create main project directory
mkdir ai-analytics-platform
cd ai-analytics-platform

# 2. Initialize package.json for monorepo
npm init -y

# 3. Create project structure
mkdir -p {frontend,backend,sdk,mobile,database,docs}
mkdir -p backend/{src,tests,scripts}
mkdir -p backend/src/{controllers,services,models,middleware,routes,utils,config}
mkdir -p frontend/{src,public,components,pages,hooks,utils,types}
mkdir -p frontend/src/{components,pages,hooks,utils,types,lib,styles}
mkdir -p sdk/{web,android}
mkdir -p database/{migrations,seeds}

# 4. Create configuration files
touch .gitignore
touch .env.example
touch docker-compose.yml
touch README.md

# Frontend package.json
cat > frontend/package.json << 'EOF'
{
  "name": "ai-analytics-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "@headlessui/react": "^2.0.0",
    "@heroicons/react": "^2.1.0",
    "recharts": "^2.12.0",
    "socket.io-client": "^4.7.0",
    "zustand": "^4.5.0",
    "react-hook-form": "^7.51.0",
    "@hookform/resolvers": "^3.3.0",
    "zod": "^3.23.0",
    "date-fns": "^3.6.0",
    "lucide-react": "^0.376.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.0",
    "@tailwindcss/forms": "^0.5.0",
    "@tailwindcss/typography": "^0.5.0"
  }
}
EOF

# Backend package.json
cat > backend/package.json << 'EOF'
{
  "name": "ai-analytics-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "nodemon src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "migrate": "node scripts/migrate.js",
    "seed": "node scripts/seed.js"
  },
  "dependencies": {
    "express": "^4.19.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0",
    "compression": "^1.7.4",
    "dotenv": "^16.4.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "express-rate-limit": "^7.2.0",
    "express-validator": "^7.0.0",
    "pg": "^8.11.0",
    "redis": "^4.6.0",
    "socket.io": "^4.7.0",
    "@aws-sdk/client-bedrock-runtime": "^3.554.0",
    "@clickhouse/client": "^0.2.0",
    "uuid": "^9.0.0",
    "joi": "^17.12.0",
    "winston": "^3.13.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/morgan": "^1.9.0",
    "@types/compression": "^1.7.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcryptjs": "^2.4.0",
    "@types/pg": "^8.11.0",
    "@types/uuid": "^9.0.0",
    "@types/node": "^20.12.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0",
    "nodemon": "^3.1.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^7.8.0",
    "@typescript-eslint/parser": "^7.8.0"
  }
}
EOF

# Root package.json for monorepo management
cat > package.json << 'EOF'
{
  "name": "ai-analytics-platform",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "frontend",
    "backend",
    "sdk/*"
  ],
  "scripts": {
    "install:all": "npm install && npm install --prefix frontend && npm install --prefix backend",
    "dev": "concurrently \"npm run dev --prefix backend\" \"npm run dev --prefix frontend\"",
    "dev:frontend": "npm run dev --prefix frontend",
    "dev:backend": "npm run dev --prefix backend",
    "build": "npm run build --prefix backend && npm run build --prefix frontend",
    "start": "npm run start --prefix backend",
    "test": "npm run test --prefix backend",
    "lint": "npm run lint --prefix backend && npm run lint --prefix frontend",
    "setup": "npm run install:all && npm run migrate",
    "migrate": "npm run migrate --prefix backend"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
EOF

# Environment variables template
cat > .env.example << 'EOF'
# Application
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/analytics
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=analytics
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your-refresh-token-secret
REFRESH_TOKEN_EXPIRES_IN=7d

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EVENT_RATE_LIMIT_MAX=1000

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log
EOF

# GitIgnore
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Production builds
.next/
dist/
build/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# TypeScript
*.tsbuildinfo

# Database
*.sqlite
*.db

# Temporary folders
tmp/
temp/
EOF

# Docker Compose for development
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: analytics
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    ports:
      - "8123:8123"
      - "9000:9000"
    volumes:
      - clickhouse_data:/var/lib/clickhouse
      - ./database/clickhouse-init.sql:/docker-entrypoint-initdb.d/init.sql

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  clickhouse_data:
  redis_data:
EOF

# README.md
cat > README.md << 'EOF'
# AI Analytics Platform

A modern analytics platform with AI-powered insights, built for the company hackathon.

## Features

- 📊 Real-time event tracking and analytics
- 🤖 AI-powered text-to-SQL query generation
- 📱 Multi-platform SDKs (Web & Android)
- ⚡ Real-time dashboard updates
- 🔒 Enterprise-grade security
- 📈 Scalable architecture

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS, Recharts
- **Backend**: Node.js, Express.js, TypeScript
- **Databases**: PostgreSQL, ClickHouse, Redis
- **AI**: AWS Bedrock (Claude 3.5 Sonnet)
- **Real-time**: Socket.io
- **Infrastructure**: Docker, AWS

## Quick Start

1. **Clone and setup**:
   ```bash
   git clone <repo-url>
   cd ai-analytics-platform
   npm run setup
   ```

2. **Start databases**:
   ```bash
   docker-compose up -d
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configurations
   ```

4. **Run development servers**:
   ```bash
   npm run dev
   ```

5. **Access the application**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Database UI: http://localhost:8123/play (ClickHouse)

## Project Structure

```
ai-analytics-platform/
├── frontend/          # Next.js dashboard
├── backend/           # Express.js API server
├── sdk/              # Client SDKs
│   ├── web/          # JavaScript SDK
│   └── android/      # Android SDK
├── database/         # Database schemas and migrations
└── docs/            # Documentation
```

## Development

- `npm run dev` - Start both frontend and backend
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Lint code
- `npm run migrate` - Run database migrations

## API Documentation

API documentation is available at `/api/docs` when running the backend server.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License.
EOF

echo "Project structure created successfully!"
echo "Next steps:"
echo "1. Run: npm run install:all"
echo "2. Run: docker-compose up -d"
echo "3. Copy .env.example to .env and configure"
echo "4. Run: npm run dev"