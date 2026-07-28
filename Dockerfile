FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
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
