FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb
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
