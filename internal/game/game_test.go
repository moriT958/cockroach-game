package game

import "testing"

func TestRoundFlow(t *testing.T) {
	g := New()
	if g.Start() {
		t.Fatal("プレイヤー不在で開始できてはいけない")
	}
	id, err := g.Join("tok", "  たろう  ")
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := g.Join("tok", ""); again != id {
		t.Fatalf("同じ token は再接続になるはず: %d != %d", again, id)
	}
	if !g.Start() {
		t.Fatal("開始できない")
	}
	s := g.Snapshot()
	if s.Phase != PhasePlaying || len(s.Foods) != initialFoods || s.Players[0].Name != "たろう" {
		t.Fatalf("開始直後の状態が不正: %+v", s)
	}

	// 餌の真上に置けば食べて得点が入る。
	f := g.foods[0]
	g.players[id].X, g.players[id].Y = f.X, f.Y
	g.Step(1.0 / 30)
	s = g.Snapshot()
	if s.Players[0].Score < f.points {
		t.Fatalf("得点が入っていない: %d", s.Players[0].Score)
	}
	for _, x := range s.Foods {
		if x.ID == f.ID {
			t.Fatal("食べた餌が残っている")
		}
	}

	for range int(RoundSeconds*30) + 5 {
		g.Step(1.0 / 30)
	}
	if s = g.Snapshot(); s.Phase != PhaseResult || len(s.Foods) > maxFoods {
		t.Fatalf("時間切れで結果発表になるはず: %s foods=%d", s.Phase, len(s.Foods))
	}
	if s.Rank(id) != 1 {
		t.Fatalf("rank = %d", s.Rank(id))
	}
}

func TestMoveDashAndBounds(t *testing.T) {
	g := New()
	id, _ := g.Join("a", "a")
	p := g.players[id]
	p.X, p.Y = 100, 100

	g.SetInput(id, 1, 0, false)
	g.Step(1)
	if p.X != 100+walkSpeed {
		t.Fatalf("歩行: x=%v", p.X)
	}

	p.X = 100
	g.SetInput(id, 5, 0, true) // 範囲外の入力は正規化される
	g.Step(0.5)
	if p.X != 100+dashSpeed*0.5 || !p.Dashing || p.Stamina >= 1 {
		t.Fatalf("ダッシュ: x=%v dashing=%v stamina=%v", p.X, p.Dashing, p.Stamina)
	}
	for range 100 {
		g.Step(0.1)
	}
	if p.X != WorldW-playerRadius {
		t.Fatalf("壁で止まるはず: x=%v", p.X)
	}
	if p.Stamina > dashMinStart+dashRegen*0.1+1e-9 {
		t.Fatalf("押しっぱなしではスタミナが回復しきらないはず: %v", p.Stamina)
	}
}

func TestDisconnectTimeoutAndFull(t *testing.T) {
	g := New()
	for i := range MaxPlayers {
		if _, err := g.Join(string(rune('a'+i)), ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := g.Join("zz", ""); err != ErrFull {
		t.Fatalf("満員エラーになるはず: %v", err)
	}
	g.Leave(1)
	g.Step(goneTimeout + 1)
	if n := len(g.Snapshot().Players); n != MaxPlayers-1 {
		t.Fatalf("切断したプレイヤーが消えていない: %d", n)
	}
}
