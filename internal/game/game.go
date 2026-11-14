package game

import (
	"fmt"
	"math"
	"math/rand/v2"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

const (
	WorldW = 1600.0
	WorldH = 900.0

	RoundSeconds = 90.0
	MaxPlayers   = 12

	playerRadius = 24.0
	foodRadius   = 16.0
	walkSpeed    = 280.0
	dashSpeed    = 520.0
	dashDrain    = 0.9  // 1 秒あたりのスタミナ消費
	dashRegen    = 0.3  // 1 秒あたりのスタミナ回復
	dashMinStart = 0.15 // これ未満ではダッシュを開始できない

	maxFoods      = 40
	initialFoods  = 24
	spawnInterval = 0.35
	goneTimeout   = 20.0 // 切断後にプレイヤーを消すまでの秒数
	maxNameLen    = 12
)

type Phase string

const (
	PhaseLobby   Phase = "lobby"
	PhasePlaying Phase = "playing"
	PhaseResult  Phase = "result"
)

// FoodKind は餌の種類。Weight は出現比率。
type FoodKind struct {
	Kind   string
	Points int
	Weight int
}

var FoodKinds = []FoodKind{
	{"crumb", 1, 45},
	{"rice", 2, 25},
	{"chip", 3, 17},
	{"cookie", 5, 10},
	{"cake", 10, 3},
}

var colors = []string{
	"#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316",
	"#06b6d4", "#ec4899", "#84cc16", "#f5f5f4", "#14b8a6", "#8b5cf6",
}

type Player struct {
	ID        int     `json:"id"`
	Name      string  `json:"name"`
	Color     string  `json:"color"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Angle     float64 `json:"angle"`
	Score     int     `json:"score"`
	Stamina   float64 `json:"stamina"`
	Dashing   bool    `json:"dashing"`
	Moving    bool    `json:"moving"`
	Connected bool    `json:"connected"`

	token    string
	inX, inY float64
	inDash   bool
	goneFor  float64
}

type Food struct {
	ID   int     `json:"id"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Kind string  `json:"kind"`

	points int
}

// State は画面に送るスナップショット。
type State struct {
	Phase    Phase    `json:"phase"`
	TimeLeft float64  `json:"timeLeft"`
	Players  []Player `json:"players"`
	Foods    []Food   `json:"foods"`
}

type Game struct {
	mu         sync.Mutex
	phase      Phase
	timeLeft   float64
	players    map[int]*Player
	foods      []Food
	nextPlayer int
	nextFood   int
	spawnAcc   float64
	rng        *rand.Rand
}

func New() *Game {
	return &Game{
		phase:   PhaseLobby,
		players: map[int]*Player{},
		rng:     rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())),
	}
}

var ErrFull = fmt.Errorf("満員です (最大 %d 人)", MaxPlayers)

// Join はプレイヤーを参加させる。同じ token なら既存プレイヤーに再接続する。
func (g *Game) Join(token, name string) (int, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	name = cleanName(name)
	for _, p := range g.players {
		if token != "" && p.token == token {
			p.Connected = true
			p.goneFor = 0
			if name != "" {
				p.Name = name
			}
			return p.ID, nil
		}
	}
	if len(g.players) >= MaxPlayers {
		return 0, ErrFull
	}
	g.nextPlayer++
	if name == "" {
		name = fmt.Sprintf("ゴキ%d号", g.nextPlayer)
	}
	p := &Player{
		ID:        g.nextPlayer,
		Name:      name,
		Color:     g.freeColor(),
		Stamina:   1,
		Connected: true,
		token:     token,
	}
	g.place(p)
	g.players[p.ID] = p
	return p.ID, nil
}

// Leave は切断を記録する。再接続に備えてしばらくは残す。
func (g *Game) Leave(id int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if p, ok := g.players[id]; ok {
		p.Connected = false
		p.inX, p.inY, p.inDash = 0, 0, false
	}
}

// SetInput はスティック入力 (-1..1) とダッシュボタンを設定する。
func (g *Game) SetInput(id int, x, y float64, dash bool) {
	if math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
		return
	}
	if l := math.Hypot(x, y); l > 1 {
		x, y = x/l, y/l
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if p, ok := g.players[id]; ok && p.Connected {
		p.inX, p.inY, p.inDash = x, y, dash
	}
}

// Start はラウンドを開始する。プレイ中やプレイヤー不在のときは何もしない。
func (g *Game) Start() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase == PhasePlaying || len(g.players) == 0 {
		return false
	}
	g.phase = PhasePlaying
	g.timeLeft = RoundSeconds
	g.foods = g.foods[:0]
	g.spawnAcc = 0
	for _, p := range g.players {
		p.Score = 0
		p.Stamina = 1
		p.Dashing = false
		g.place(p)
	}
	for range initialFoods {
		g.spawnFood()
	}
	return true
}

// Reset はロビーに戻す。
func (g *Game) Reset() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.phase = PhaseLobby
	g.timeLeft = 0
	g.foods = g.foods[:0]
	for id, p := range g.players {
		if !p.Connected {
			delete(g.players, id)
			continue
		}
		p.Score = 0
		p.Stamina = 1
	}
}

// Step は dt 秒だけゲームを進める。
func (g *Game) Step(dt float64) {
	g.mu.Lock()
	defer g.mu.Unlock()

	for id, p := range g.players {
		if !p.Connected {
			p.goneFor += dt
			if p.goneFor > goneTimeout {
				delete(g.players, id)
				continue
			}
		}
		// 結果発表中は動けない。ロビーでは操作の練習ができる。
		if g.phase != PhaseResult {
			g.move(p, dt)
		} else {
			p.Moving, p.Dashing = false, false
		}
	}

	if g.phase != PhasePlaying {
		return
	}

	// 同じ餌に複数が重なったときは近い方が食べる。
	kept := g.foods[:0]
	for _, f := range g.foods {
		var eater *Player
		best := playerRadius + foodRadius
		for _, p := range g.players {
			if d := math.Hypot(p.X-f.X, p.Y-f.Y); d < best {
				best, eater = d, p
			}
		}
		if eater != nil {
			eater.Score += f.points
		} else {
			kept = append(kept, f)
		}
	}
	g.foods = kept

	g.spawnAcc += dt
	for g.spawnAcc >= spawnInterval {
		g.spawnAcc -= spawnInterval
		if len(g.foods) < maxFoods {
			g.spawnFood()
		}
	}

	g.timeLeft -= dt
	if g.timeLeft <= 0 {
		g.timeLeft = 0
		g.phase = PhaseResult
	}
}

func (g *Game) move(p *Player, dt float64) {
	mag := math.Hypot(p.inX, p.inY)
	p.Moving = mag > 0.05

	if p.Dashing {
		p.Dashing = p.inDash && p.Moving && p.Stamina > 0
	} else {
		p.Dashing = p.inDash && p.Moving && p.Stamina >= dashMinStart
	}
	if p.Dashing {
		p.Stamina = math.Max(0, p.Stamina-dashDrain*dt)
	} else {
		p.Stamina = math.Min(1, p.Stamina+dashRegen*dt)
	}
	if !p.Moving {
		return
	}

	// ダッシュ中は倒し具合に関係なく全速力。
	speed := walkSpeed * math.Min(mag, 1)
	if p.Dashing {
		speed = dashSpeed
	}
	p.X += p.inX / mag * speed * dt
	p.Y += p.inY / mag * speed * dt
	p.X = clamp(p.X, playerRadius, WorldW-playerRadius)
	p.Y = clamp(p.Y, playerRadius, WorldH-playerRadius)
	p.Angle = math.Atan2(p.inY, p.inX)
}

// Snapshot は現在の状態のコピーを返す。プレイヤーは ID 順。
func (g *Game) Snapshot() State {
	g.mu.Lock()
	defer g.mu.Unlock()
	s := State{
		Phase:    g.phase,
		TimeLeft: g.timeLeft,
		Players:  make([]Player, 0, len(g.players)),
		Foods:    append([]Food{}, g.foods...),
	}
	for _, p := range g.players {
		s.Players = append(s.Players, *p)
	}
	sort.Slice(s.Players, func(i, j int) bool { return s.Players[i].ID < s.Players[j].ID })
	return s
}

// Rank は得点順位 (1 始まり、同点は同順位) を返す。
func (s State) Rank(id int) int {
	var me *Player
	for i := range s.Players {
		if s.Players[i].ID == id {
			me = &s.Players[i]
		}
	}
	if me == nil {
		return 0
	}
	rank := 1
	for _, p := range s.Players {
		if p.Score > me.Score {
			rank++
		}
	}
	return rank
}

func (g *Game) place(p *Player) {
	p.X = playerRadius + g.rng.Float64()*(WorldW-2*playerRadius)
	p.Y = playerRadius + g.rng.Float64()*(WorldH-2*playerRadius)
	p.Angle = g.rng.Float64()*2*math.Pi - math.Pi
}

func (g *Game) spawnFood() {
	total := 0
	for _, k := range FoodKinds {
		total += k.Weight
	}
	n := g.rng.IntN(total)
	kind := FoodKinds[0]
	for _, k := range FoodKinds {
		if n < k.Weight {
			kind = k
			break
		}
		n -= k.Weight
	}
	g.nextFood++
	const margin = 40.0
	g.foods = append(g.foods, Food{
		ID:     g.nextFood,
		X:      margin + g.rng.Float64()*(WorldW-2*margin),
		Y:      margin + g.rng.Float64()*(WorldH-2*margin),
		Kind:   kind.Kind,
		points: kind.Points,
	})
}

func (g *Game) freeColor() string {
	used := map[string]bool{}
	for _, p := range g.players {
		used[p.Color] = true
	}
	for _, c := range colors {
		if !used[c] {
			return c
		}
	}
	return colors[0]
}

func cleanName(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > maxNameLen {
		s = string([]rune(s)[:maxNameLen])
	}
	return s
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
