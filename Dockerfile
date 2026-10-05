FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
# Database, uploads and logs live here - mount a persistent volume.
VOLUME /app/data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
