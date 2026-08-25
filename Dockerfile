FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY bin ./bin
COPY examples ./examples
COPY README.md LICENSE LICENSES.md ./
COPY third_party ./third_party
RUN chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3000 AGENT_CHESS_ALLOW_REMOTE=1
EXPOSE 3000
CMD ["node", "src/server.js"]
