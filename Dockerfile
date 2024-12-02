# Use an official Node.js LTS image with Alpine
FROM node:lts-alpine

# Set environment variables
ENV NODE_ENV=production

# Install necessary dependencies: bash, curl, MongoDB tools, and pnpm
RUN apk add --no-cache bash curl mongodb-tools && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

# Set the working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install production dependencies using pnpm
RUN pnpm install --prod

# Copy the rest of the application code
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
