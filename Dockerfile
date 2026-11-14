# webui をビルド (internal/webui/dist)
FROM node:26-alpine AS webui
WORKDIR /app/internal/webui

RUN npm install -g pnpm@12

COPY internal/webui/package.json internal/webui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY internal/webui/ ./
RUN pnpm build

# dist を埋め込んで Go バイナリをビルド
FROM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal/game ./internal/game
COPY internal/server ./internal/server
COPY internal/webui/embed.go ./internal/webui/embed.go
COPY --from=webui /app/internal/webui/dist ./internal/webui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cockroach-game ./cmd/server

# 実行
FROM gcr.io/distroless/static:nonroot AS runtime
COPY --from=build /out/cockroach-game /cockroach-game
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/cockroach-game"]
