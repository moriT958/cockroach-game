package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/moriT958/cockroach-game/internal/game"
	"github.com/moriT958/cockroach-game/internal/server"
	"github.com/moriT958/cockroach-game/internal/webui"
)

func main() {
	addr := flag.String("addr", ":8080", "Listen Adress")
	publicURL := flag.String("public-url", "", "スマホからアクセスする URL (省略時は LAN の IP から自動決定)")
	flag.Parse()

	_, port, err := net.SplitHostPort(*addr)
	if err != nil {
		log.Fatalf("Invalid -addr: %v", err)
	}
	base := *publicURL
	if base == "" {
		base = fmt.Sprintf("http://%s", net.JoinHostPort(lanIP(), port))
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	srv := server.New(game.New(), webui.FS(), base+"/play")
	go srv.Run(ctx)

	httpSrv := &http.Server{Addr: *addr, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		httpSrv.Shutdown(shutdownCtx)
	}()

	log.Printf("Screen (PC):         http://localhost:%s/", port)
	log.Printf("Controller (Phome):    %s/play", base)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// lanIP は同じ LAN のスマホから届きそうな自分の IPv4 アドレスを返す。
func lanIP() string {
	// UDP の Dial はパケットを送らず、デフォルト経路の送信元アドレスだけが分かる。
	if conn, err := net.Dial("udp4", "192.0.2.1:9"); err == nil {
		defer conn.Close()
		if a, ok := conn.LocalAddr().(*net.UDPAddr); ok && !a.IP.IsLoopback() {
			return a.IP.String()
		}
	}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && n.IP.IsPrivate() {
			return n.IP.String()
		}
	}
	return "localhost"
}
