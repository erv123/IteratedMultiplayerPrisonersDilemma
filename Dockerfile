FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies (use package-lock if present)
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

# Copy application files
COPY . .

# Production environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose default port
EXPOSE 3000

# Run the server via npm script
CMD ["npm", "run", "start"]
