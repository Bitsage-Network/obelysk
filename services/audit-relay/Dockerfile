FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O- http://localhost:3002/health || exit 1
CMD ["node", "src/index.js"]
