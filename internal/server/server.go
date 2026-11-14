package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/moriT958/cockroach-game/internal/game"
)

const (
	tickRate      = 30
	statusEvery   = 3 // コントローラーへは 10Hz で送る
	writeTimeout  = 5 * time.Second
	maxInputBytes = 512
)

type client struct {
	send chan []byte
	kick chan struct{} // 同じプレイヤーが別の接続で入り直したら閉じる
}

func newClient() *client {
	return &client{send: make(chan []byte, 1), kick: make(chan struct{})}
}

// push は最新のメッセージだけを残す。遅い相手のために他を待たせない。
func (c *client) push(b []byte) {
	for {
		select {
		case c.send <- b:
			return
		default:
			select {
			case <-c.send:
			default:
			}
		}
	}
}

type Server struct {
	game    *game.Game
	joinURL string
	static  http.Handler
	assets  fs.FS

	mu      sync.Mutex
	screens map[*client]struct{}
	players map[int]*client
}

func New(g *game.Game, assets fs.FS, joinURL string) *Server {
	return &Server{
		game:    g,
		joinURL: joinURL,
		static:  http.FileServerFS(assets),
		assets:  assets,
		screens: map[*client]struct{}{},
		players: map[int]*client{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/info", s.handleInfo)
	mux.HandleFunc("GET /ws/screen", s.handleScreen)
	mux.HandleFunc("GET /ws/play", s.handlePlay)
	mux.HandleFunc("GET /", s.handleStatic)
	return mux
}

// Run は ctx が終わるまでゲームループを回す。
func (s *Server) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second / tickRate)
	defer ticker.Stop()
	last := time.Now()
	for n := 0; ; n++ {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			dt := min(now.Sub(last).Seconds(), 0.1)
			last = now
			s.game.Step(dt)
			s.broadcast(s.game.Snapshot(), n%statusEvery == 0)
		}
	}
}

type statusMsg struct {
	Type     string       `json:"type"`
	Phase    game.Phase   `json:"phase"`
	TimeLeft float64      `json:"timeLeft"`
	Rank     int          `json:"rank"`
	Total    int          `json:"total"`
	Me       *game.Player `json:"me"`
}

func (s *Server) broadcast(st game.State, withStatus bool) {
	state, _ := json.Marshal(struct {
		Type string `json:"type"`
		game.State
	}{"state", st})

	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.screens {
		c.push(state)
	}
	if !withStatus {
		return
	}
	for i := range st.Players {
		p := &st.Players[i]
		if c, ok := s.players[p.ID]; ok {
			b, _ := json.Marshal(statusMsg{"status", st.Phase, st.TimeLeft, st.Rank(p.ID), len(st.Players), p})
			c.push(b)
		}
	}
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"joinUrl": s.joinURL})
}

func (s *Server) handleScreen(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()

	c := newClient()
	s.mu.Lock()
	s.screens[c] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.screens, c)
		s.mu.Unlock()
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go writeLoop(ctx, cancel, conn, c)

	for {
		var msg struct {
			Type string `json:"type"`
		}
		if !readJSON(ctx, conn, &msg) {
			return
		}
		switch msg.Type {
		case "start":
			s.game.Start()
		case "reset":
			s.game.Reset()
		}
	}
}

func (s *Server) handlePlay(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(maxInputBytes)

	q := r.URL.Query()
	id, err := s.game.Join(q.Get("token"), q.Get("name"))
	if err != nil {
		conn.Close(websocket.StatusTryAgainLater, err.Error())
		return
	}

	c := newClient()
	s.mu.Lock()
	if old, ok := s.players[id]; ok {
		close(old.kick)
	}
	s.players[id] = c
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		mine := s.players[id] == c
		if mine {
			delete(s.players, id)
		}
		s.mu.Unlock()
		if mine {
			s.game.Leave(id)
		}
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go writeLoop(ctx, cancel, conn, c)

	for {
		var msg struct {
			Type string  `json:"type"`
			X    float64 `json:"x"`
			Y    float64 `json:"y"`
			Dash bool    `json:"dash"`
		}
		if !readJSON(ctx, conn, &msg) {
			return
		}
		if msg.Type == "input" {
			s.game.SetInput(id, msg.X, msg.Y, msg.Dash)
		}
	}
}

func writeLoop(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, c *client) {
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.kick:
			conn.Close(websocket.StatusPolicyViolation, "別の接続に切り替わりました")
			return
		case b := <-c.send:
			wctx, done := context.WithTimeout(ctx, writeTimeout)
			err := conn.Write(wctx, websocket.MessageText, b)
			done()
			if err != nil {
				return
			}
		}
	}
}

// readJSON は 1 メッセージ読む。接続が終わったら false。壊れた JSON は無視する。
func readJSON(ctx context.Context, conn *websocket.Conn, v any) bool {
	_, b, err := conn.Read(ctx)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(b, v); err != nil {
		log.Printf("ws: Invalid message: %v", err)
	}
	return true
}

// handleStatic はビルド済み webui を返す。ファイルが無いパスは SPA として index.html を返す。
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" {
		if info, err := fs.Stat(s.assets, name); err == nil && !info.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			s.static.ServeHTTP(w, r)
			return
		}
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, s.assets, "index.html")
}
